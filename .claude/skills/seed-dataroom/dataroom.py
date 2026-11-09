#!/usr/bin/env python3
"""Data Room Builder for seed-dataroom. Standard library only, no network.

It lays out the data room investors expect, checks what is in it against a
checklist, flags what is missing or stale, writes an index, and says what to
share before a term sheet and what only after one.

    python3 dataroom.py init                          # seed/dataroom/01 Company ... 09 Customers
    python3 dataroom.py check --today 2026-10-26      # present / missing / stale, by folder
    python3 dataroom.py check --stage before          # only what investors see before a term sheet
    python3 dataroom.py index --today 2026-10-26      # writes seed/dataroom/INDEX.md
    python3 dataroom.py share-list --stage before     # what to send now, and what waits
    ... --json for machine output, --dir to use another seed folder

The folders: 01 Company, 02 Pitch deck, 03 Financials, 04 Market, 05 Product,
06 Team, 07 Legal, 08 Cap table, 09 Customers. A checklist item counts as
present when a file in its folder has one of its keywords in the name. A
file's date is the date in its name (2026-10-01 or 2026-10) if it has one,
else the day it was last modified (in UTC, so the computer's time zone never
changes the answer). An item is stale when that date is older than its
limit (the cap table 30 days, financials 45, the deck 90, and so on).

It never opens, uploads or shares a file. Files that should not be in a data
room at all (passwords, keys, ID documents, raw customer lists) are flagged.

Exit codes: init 0. check 0 = everything for that stage is present and
fresh, 1 = something is missing or stale, or an error. index and share-list 0,
1 on an error.
"""

import argparse
import datetime
import json
import os
import re
import sys

FOLDERS = ("01 Company", "02 Pitch deck", "03 Financials", "04 Market", "05 Product", "06 Team", "07 Legal",
           "08 Cap table", "09 Customers")
# (folder, key, what it is, share stage, keywords in the file name, days before it is stale or None)
CHECKLIST = [
    ("01 Company", "one_pager", "One-pager / executive summary", "before",
     ("one-pager", "one pager", "onepager", "executive summary", "exec summary", "summary"), 90),
    ("01 Company", "business_plan", "Business plan", "before", ("business plan", "plan"), 90),
    ("02 Pitch deck", "deck", "Pitch deck (PDF)", "before", ("deck", "pitch"), 90),
    ("03 Financials", "model", "Financial model (36 months)", "before",
     ("model", "forecast", "projection"), 60),
    ("03 Financials", "use_of_funds", "Use of funds", "before", ("use of funds", "use-of-funds", "budget"), 90),
    ("03 Financials", "historicals", "Historical financials (P&L, balance sheet)", "after",
     ("p&l", "pnl", "profit", "income statement", "balance sheet", "historical", "actuals"), 45),
    ("03 Financials", "bank", "Bank statements (last 3 months)", "after", ("bank", "statement"), 45),
    ("04 Market", "market_size", "Market sizing (TAM / SAM / SOM)", "before", ("market", "tam", "sizing"), 180),
    ("04 Market", "competition", "Competitor analysis", "before", ("compet", "landscape"), 90),
    ("05 Product", "demo", "Product demo (video, link or screenshots)", "before",
     ("demo", "screenshot", "video", "walkthrough"), 90),
    ("05 Product", "metrics", "Traction and KPIs", "before", ("metric", "kpi", "traction", "dashboard"), 45),
    ("05 Product", "roadmap", "Product roadmap", "before", ("roadmap",), 120),
    ("06 Team", "bios", "Founder and team bios", "before", ("bio", "team", "founder"), 365),
    ("06 Team", "hiring", "Org chart and hiring plan", "after", ("org", "hiring"), 180),
    ("06 Team", "ip_assignments", "Employee and contractor IP assignments (PIIA / CIIAA)", "after",
     ("piia", "ciiaa", "ip assignment", "invention", "employment", "contractor", "offer letter"), None),
    ("07 Legal", "incorporation", "Certificate of incorporation and bylaws", "after",
     ("incorporation", "charter", "bylaws", "articles"), None),
    ("07 Legal", "board_consents", "Board consents and minutes", "after", ("consent", "minutes", "board"), None),
    ("07 Legal", "ip", "IP: trademarks, patents, domains", "after", ("trademark", "patent", "domain", " ip"), None),
    ("07 Legal", "contracts", "Material contracts", "after", ("contract", "agreement", "msa", "lease"), None),
    ("08 Cap table", "cap_table", "Cap table (fully diluted)", "after",
     ("cap table", "captable", "cap-table", "capitalization"), 30),
    ("08 Cap table", "safes", "SAFEs and convertible notes already signed", "after",
     ("safe", "convertible", "note"), None),
    ("08 Cap table", "option_plan", "Equity incentive plan and option grants", "after",
     ("option", "equity incentive", "esop", "stock plan", "grant"), None),
    ("09 Customers", "testimonials", "Testimonials and reviews", "before",
     ("testimonial", "review", "case study", "quote"), 180),
    ("09 Customers", "references", "Customer references (with their OK to be called)", "after",
     ("reference",), 180),
    ("09 Customers", "pipeline", "Waitlist, pilots and LOIs (counts, not personal data)", "after",
     ("waitlist", "pilot", "loi", "letter of intent", "customer"), 90),
]
NEVER = [(r"password|passcode|credential|login", "a password or login"),
         (r"\.env$|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|secret|api[ _-]?key|token", "a key or secret"),
         (r"passport|driver'?s? licen[cs]e|\bssn\b|social security|national id|id card", "a personal ID document"),
         (r"customer (list|emails|export)|user export|email list|contacts export", "raw customer personal data")]
SKIP = ("INDEX.md",)
SHARE_NOTE = {"before": "Share when an investor asks after a first meeting. A view-only link, one per investor, "
                        "so you can see who opened what.",
              "after": "Share after a signed term sheet, for confirmatory diligence, ideally under an NDA. These hold "
                       "personal data, contracts and the full cap table."}


class RoomError(Exception):
    pass


def parse_day(text, what="--today"):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(text or "").strip())
    if not m:
        raise RoomError("%s wants a date like 2026-10-26, got %r" % (what, text))
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        raise RoomError("%s: %s is not a real date" % (what, text))


def get_today(a):
    return parse_day(a.today) if getattr(a, "today", None) else datetime.date.today()


def room_dir(a):
    return os.path.join(a.dir, "dataroom")


def norm(name):
    s = os.path.splitext(name)[0].lower()
    return " " + re.sub(r"[_\s]+", " ", s) + " "


def name_date(name):
    """A date written in the file name: 2026-10-01, 2026_10_01, 20261001 or 2026-10 (the first of the month)."""
    m = re.search(r"(20\d\d)[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?!\d)", name)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    m = re.search(r"(20\d\d)[-_.](0[1-9]|1[0-2])(?![\d])", name)
    if m:
        return datetime.date(int(m.group(1)), int(m.group(2)), 1)
    return None


def file_date(path):
    d = name_date(os.path.basename(path))
    if d:
        return d, "name"
    ts = os.stat(path).st_mtime
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).date(), "modified"


def walk(root):
    """Every file in the room: [(folder or "", relative path, absolute path)], hidden files skipped."""
    out = []
    for base, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for f in sorted(files):
            if f.startswith(".") or (base == root and f in SKIP):
                continue
            full = os.path.join(base, f)
            rel = os.path.relpath(full, root)
            top = rel.split(os.sep)[0] if os.sep in rel else ""
            out.append((top, rel, full))
    return out


def never_reason(name):
    low = name.lower()
    for pat, what in NEVER:
        if re.search(pat, low):
            return what
    return None


def survey(a, today):
    root = room_dir(a)
    if not os.path.isdir(root):
        raise RoomError("no data room at %s: run dataroom.py init first" % root)
    files = walk(root)
    items = []
    used = set()
    for folder, key, label, stage, words, limit in CHECKLIST:
        hits = []
        for top, rel, full in files:
            if top != folder or never_reason(rel):
                continue
            n = norm(os.path.basename(rel))
            if any(w in n for w in words):
                d, how = file_date(full)
                hits.append({"file": rel, "date": d.isoformat(), "dated_by": how, "age_days": (today - d).days})
                used.add(rel)
        state = "missing"
        if hits:
            newest = min(hits, key=lambda h: h["age_days"])
            state = "stale" if limit is not None and newest["age_days"] > limit else "present"
        items.append({"folder": folder, "key": key, "label": label, "stage": stage, "max_age_days": limit,
                      "state": state, "files": hits})
    extra, loose, flagged = [], [], []
    for top, rel, full in files:
        why = never_reason(rel)
        if why:
            flagged.append({"file": rel, "why": why})
        elif not top or top not in FOLDERS:
            loose.append(rel)
        elif rel not in used:
            d, how = file_date(full)
            extra.append({"file": rel, "date": d.isoformat(), "folder": top})
    empty = [f for f in FOLDERS if not os.path.isdir(os.path.join(root, f))
             or not any(top == f for top, _, _ in files)]
    return {"root": root, "today": today.isoformat(), "items": items, "other": extra, "loose": loose,
            "flagged": flagged, "empty_folders": empty, "files": len(files)}


def startup_name(a):
    path = os.path.join(a.dir, "config.json")
    try:
        with open(path, encoding="utf-8") as fh:
            return (json.load(fh).get("startup") or {}).get("name") or "Your startup"
    except (OSError, ValueError):
        return "Your startup"


def cmd_init(a):
    root = room_dir(a)
    made = []
    for f in FOLDERS:
        p = os.path.join(root, f)
        if not os.path.isdir(p):
            os.makedirs(p)
            made.append(f)
    print("Data room: %s (%s)." % (root, "created %d folder%s" % (len(made), "" if len(made) == 1 else "s")
                                   if made else "every folder was already there; nothing changed"))
    for f in FOLDERS:
        want = [label for folder, _, label, stage, _, _ in CHECKLIST if folder == f]
        print("  %-14s %s" % (f, "; ".join(want)))
    print("From this pack: seed-deck's seed/deck.html (print it to PDF) goes in 02 Pitch deck, seed-plan's "
          "seed/plan.md in 01 Company, seed-model's export in 03 Financials, seed-market and seed-scout in 04 Market.")
    print("Then: dataroom.py check.")
    return 0


def cmd_check(a):
    today = get_today(a)
    s = survey(a, today)
    stages = ("before", "after") if a.stage == "all" else (a.stage,)
    items = [i for i in s["items"] if i["stage"] in stages]
    bad = [i for i in items if i["state"] != "present"]
    if a.json:
        print(json.dumps(dict(s, items=items, ok=not bad and not s["flagged"]), indent=2))
        return 0 if not bad and not s["flagged"] else 1
    present = sum(1 for i in items if i["state"] == "present")
    print("%s data room, %s: %d of %d items present%s." % (
        startup_name(a), today.isoformat(), present, len(items),
        "" if a.stage == "all" else " (%s a term sheet)" % a.stage))
    for f in FOLDERS:
        rows = [i for i in items if i["folder"] == f]
        if not rows:
            continue
        print(f)
        for i in rows:
            mark = {"present": "ok     ", "missing": "MISSING", "stale": "STALE  "}[i["state"]]
            detail = ""
            if i["files"]:
                newest = min(i["files"], key=lambda h: h["age_days"])
                detail = "  %s (%s, %d day%s old%s)" % (
                    newest["file"].split(os.sep, 1)[-1], newest["date"], newest["age_days"],
                    "" if newest["age_days"] == 1 else "s",
                    ", limit %d" % i["max_age_days"] if i["state"] == "stale" else "")
            print("  %s %s [%s]%s" % (mark, i["label"], i["stage"], detail))
    for o in s["other"]:
        print("  other: %s (not on the checklist; index describes it as 'other')" % o["file"])
    for f in s["loose"]:
        print("  LOOSE: %s is outside the nine folders: move it into one" % f)
    for f in s["flagged"]:
        print("  DO NOT SHARE: %s looks like %s. Take it out of the data room." % (f["file"], f["why"]))
    if bad:
        print("%d to fix: %s." % (len(bad), "; ".join("%s %s" % (i["label"], i["state"]) for i in bad)))
    else:
        print("Everything on the list for this stage is there and fresh.")
    return 0 if not bad and not s["flagged"] else 1


def human_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return ("%d %s" % (n, unit)) if unit == "B" else ("%.1f %s" % (n, unit))
        n /= 1024.0


def describe(s):
    """{relative path: (what it is, stage)} for every file the checklist knows."""
    out = {}
    for i in s["items"]:
        for h in i["files"]:
            out.setdefault(h["file"], (i["label"], i["stage"]))
    return out


def cmd_index(a):
    today = get_today(a)
    s = survey(a, today)
    known = describe(s)
    root = s["root"]
    lines = ["# %s data room" % startup_name(a), "",
             "Index written %s by seed-dataroom. %d files. \"Share\" says when: **before** = after a first "
             "meeting, on request; **after** = after a signed term sheet, for diligence." % (today.isoformat(),
                                                                                             s["files"] - len(s["flagged"])),
             ""]
    for f in FOLDERS:
        lines += ["## %s" % f, ""]
        rows = []
        for top, rel, full in walk(root):
            if top != f or never_reason(rel):
                continue
            what, stage = known.get(rel, ("Other", "ask first"))
            d, how = file_date(full)
            rows.append("| %s | %s | %s | %s | %s |" % (rel.split(os.sep, 1)[1].replace("|", "/"), what,
                                                          d.isoformat(), human_size(os.path.getsize(full)), stage))
        if rows:
            lines += ["| File | What it is | Dated | Size | Share |", "| --- | --- | --- | --- | --- |"] + rows
        else:
            lines.append("Empty.")
        missing = [i["label"] for i in s["items"] if i["folder"] == f and i["state"] == "missing"]
        stale = [i["label"] for i in s["items"] if i["folder"] == f and i["state"] == "stale"]
        if missing:
            lines += ["", "Missing: " + "; ".join(missing) + "."]
        if stale:
            lines += ["", "Out of date: " + "; ".join(stale) + "."]
        lines.append("")
    if s["loose"]:
        lines += ["## Not in a folder", ""] + ["- %s" % x for x in s["loose"]] + [""]
    if s["flagged"]:
        lines += ["Left out of this index on purpose: %d file%s that should not be in a data room." % (
            len(s["flagged"]), "" if len(s["flagged"]) == 1 else "s"), ""]
    path = os.path.join(root, "INDEX.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines).rstrip() + "\n")
    print("Wrote %s: %d files in %d folders, %d checklist items missing, %d out of date." % (
        path, s["files"] - len(s["flagged"]), len(FOLDERS), sum(1 for i in s["items"] if i["state"] == "missing"),
        sum(1 for i in s["items"] if i["state"] == "stale")))
    for f in s["flagged"]:
        print("  DO NOT SHARE: %s looks like %s; it is not in the index." % (f["file"], f["why"]))
    return 0


def cmd_share(a):
    today = get_today(a)
    s = survey(a, today)
    stages = ("before", "after") if a.stage == "all" else (a.stage,)
    out = {}
    for st in stages:
        rows = [i for i in s["items"] if i["stage"] == st]
        out[st] = {"note": SHARE_NOTE[st],
                   "share": [{"label": i["label"], "files": [h["file"] for h in i["files"]], "state": i["state"]}
                             for i in rows if i["files"]],
                   "missing": [i["label"] for i in rows if not i["files"]]}
    out["never"] = ["passwords, keys and logins", "personal ID documents", "customers' personal data (share counts, "
                    "not names and emails)", "other investors' private terms or side letters, unless they agree",
                    "anything you are not allowed to share under a contract"]
    if a.json:
        print(json.dumps(out, indent=2))
        return 0
    titles = {"before": "BEFORE a term sheet", "after": "AFTER a signed term sheet"}
    for st in stages:
        print("%s: %s" % (titles[st], out[st]["note"]))
        for r in out[st]["share"]:
            print("  %s%s" % (r["label"], " (STALE: refresh it first)" if r["state"] == "stale" else ""))
            for f in r["files"]:
                print("      %s" % f)
        for m in out[st]["missing"]:
            print("  missing: %s" % m)
    print("Never in the room: " + "; ".join(out["never"]) + ".")
    for f in s["flagged"]:
        print("  DO NOT SHARE: %s looks like %s." % (f["file"], f["why"]))
    print("This tool shares nothing. The user decides who gets the link, and when.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Data Room Builder: the folders, the checklist, the index and the "
                                             "share list. It never shares anything.")
    sub = ap.add_subparsers(dest="cmd")

    def base(p):
        p.add_argument("--dir", default="seed", help="the seed folder (default ./seed); the room is <dir>/dataroom")
        p.add_argument("--today", help="YYYY-MM-DD (default: today on this computer)")
        return p

    base(sub.add_parser("init", help="create the nine folders"))
    p = base(sub.add_parser("check", help="present / missing / stale against the checklist"))
    p.add_argument("--stage", choices=["before", "after", "all"], default="all")
    p.add_argument("--json", action="store_true")
    base(sub.add_parser("index", help="write seed/dataroom/INDEX.md"))
    p = base(sub.add_parser("share-list", help="what to share before and after a term sheet"))
    p.add_argument("--stage", choices=["before", "after", "all"], default="all")
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"init": cmd_init, "check": cmd_check, "index": cmd_index, "share-list": cmd_share}[a.cmd](a)
    except RoomError as e:
        print("dataroom.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
