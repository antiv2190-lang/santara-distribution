#!/usr/bin/env python3
"""Investor Updates for seed-updates: the monthly update that keeps investors warm.
Standard library only, no network. Deterministic: the same metrics give the same update.

    python3 update.py init                                  # metrics.example.json -> seed/metrics.json
    python3 update.py add --month 2026-12 --set revenue=7875 --set walks=2100 --cash 160000
    python3 update.py add --month 2026-12 --highlight "..." --lowlight "..." --ask "..."
    python3 update.py write --month 2026-11                 # -> seed/updates/2026-11.md
    python3 update.py write --month 2026-11 --to prospects  # -> seed/updates/2026-11-prospects.md
    python3 update.py write --stdout                        # the latest month, printed, nothing written

The update, in the order investors read it:
  TL;DR       your own line ("tldr" in the month), or the headline metrics with their growth
              and the runway
  The numbers every metric this month, last month and the change: month over month growth
              for money and counts, percentage points (pts) for percent metrics
  Highlights, Lowlights, Asks   from the month's entry. A month with no lowlights is flagged:
              investors trust updates that say what went wrong.
  Runway      net burn = last month's cash + money_in - this month's cash. Runway = this month's
              cash / the average net burn of the last 3 months (fewer if that is all there is).
              Cash lasts to about this month + runway, rounded up to a whole month.

--to prospects is the short version for warm investors who said "not now": the headline
metrics and the top two highlights, the raise from seed/config.json, and an opt-out line. It
leaves out cash, burn, runway, lowlights and asks on purpose (they are for your investors).
It starts "Hi {first_name}," for you to fill in per investor before anything is sent.

Nothing here sends email. Sending goes through your own Gmail, after your yes (see SKILL.md).
Exit codes: 0 done, 1 refused (a file already there), 2 bad input (no such month, a bad value).
"""

import argparse
import json
import os
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
EXAMPLE = os.path.join(HERE, "metrics.example.json")
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
               "November", "December"]
UNITS = ("usd", "count", "pct")
BURN_MONTHS = 3
OPT_OUT = "Not a fit any more? Reply 'no' and I won't send these again."
MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")


class UpdateError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- numbers and months

def D(x, what="a number"):
    if isinstance(x, bool) or x is None:
        raise UpdateError("%s is not a number: %r" % (what, x))
    try:
        if isinstance(x, float):
            return Decimal(repr(x))
        return Decimal(str(x).strip().lstrip("$").replace(",", "").rstrip("%"))
    except (InvalidOperation, ValueError):
        raise UpdateError("%s is not a number: %r" % (what, x))


def rnd(x, dp):
    return D(x).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)


def trim(q):
    s = format(q, "f")
    return s.rstrip("0").rstrip(".") if "." in s else s


def fnum(x):
    d = D(x)
    return int(d) if d == d.to_integral_value() else float(d)


def money(x):
    d = D(x)
    q = rnd(d, 0 if d == d.to_integral_value() else 2)
    return "%s$%s" % ("-" if q < 0 else "", format(abs(q), ",f"))


def short_money(x):
    d = D(x)
    if abs(d) >= Decimal("1e6"):
        return "$%sM" % trim(rnd(d / Decimal("1e6"), 2 if abs(d) < Decimal("1e7") else 1))
    return money(d)


def parse_month(text, what="--month"):
    m = MONTH_RE.match(str(text or ""))
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise UpdateError("%s wants YYYY-MM, like 2026-11 (got %r)" % (what, text))
    return int(m.group(1)), int(m.group(2))


def month_name(ym):
    y, m = parse_month(ym, "month")
    return "%s %d" % (MONTH_NAMES[m - 1], y)


def short_month(ym):
    y, m = parse_month(ym, "month")
    return "%s %d" % (MONTH_NAMES[m - 1][:3], y)


def add_months(ym, k):
    y, m = parse_month(ym, "month")
    idx = y * 12 + (m - 1) + k
    return "%04d-%02d" % (idx // 12, idx % 12 + 1)


def prev_month(ym):
    return add_months(ym, -1)


def show(value, unit):
    if unit == "usd":
        return money(value)
    if unit == "pct":
        return trim(rnd(value, 2)) + "%"
    d = D(value)
    return "{:,}".format(int(d)) if d == d.to_integral_value() else format(d, ",f")


def change(cur, last, unit):
    """(text, direction) for this month against last month."""
    if last is None:
        return "new this month", 0
    c, l = D(cur), D(last)
    if unit == "pct":
        diff = rnd(c - l, 2)
        if diff == 0:
            return "flat", 0
        return "%s %s pts" % ("up" if diff > 0 else "down", trim(abs(diff))), (1 if diff > 0 else -1)
    if l == 0:
        return ("flat", 0) if c == 0 else ("new this month", 0)
    g = rnd((c - l) / abs(l) * 100, 1)
    if g == 0:
        return "flat", 0
    return "%s %s%%" % ("up" if g > 0 else "down", trim(abs(g))), (1 if g > 0 else -1)


def mom(cur, last, unit):
    """+23.9%, -0.4 pts: the short form for the TL;DR."""
    text, sign = change(cur, last, unit)
    if text.startswith(("up ", "down ")):
        return ("+" if sign > 0 else "-") + text.split(" ", 1)[1]
    return text


# ---------------------------------------------------------------- the metrics file

def read_json(path, what, required=True):
    if not os.path.exists(path):
        if required:
            raise UpdateError("no %s at %s" % (what, path))
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise UpdateError("%s is not valid JSON: %s" % (path, e))


def write_json(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")


def validate(doc):
    if not isinstance(doc, dict):
        raise UpdateError("metrics.json must be a JSON object")
    errs = []
    metrics = doc.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        errs.append("metrics is missing: a list of {key, label, unit}")
        metrics = []
    keys = []
    for i, m in enumerate(metrics):
        if not isinstance(m, dict) or not m.get("key"):
            errs.append("metrics[%d] needs a key" % i)
            continue
        if m.get("unit", "count") not in UNITS:
            errs.append("metrics[%d].unit is usd, count or pct (got %r)" % (i, m.get("unit")))
        keys.append(m["key"])
    seen = set()
    for i, e in enumerate(doc.get("months") or []):
        if not isinstance(e, dict):
            errs.append("months[%d] must be an object" % i)
            continue
        try:
            parse_month(e.get("month"), "months[%d].month" % i)
        except UpdateError as x:
            errs.append(str(x))
            continue
        if e["month"] in seen:
            errs.append("months has %s twice" % e["month"])
        seen.add(e["month"])
        for k, v in (e.get("values") or {}).items():
            if k not in keys:
                errs.append("%s: %r is not one of the metrics (%s)" % (e["month"], k, ", ".join(keys)))
            try:
                D(v, "%s %s" % (e["month"], k))
            except UpdateError as x:
                errs.append(str(x))
        for k in ("cash", "money_in", "net_burn"):
            if e.get(k) is not None:
                try:
                    D(e[k], "%s %s" % (e["month"], k))
                except UpdateError as x:
                    errs.append(str(x))
    if errs:
        raise UpdateError("metrics.json needs fixing:\n  - " + "\n  - ".join(errs))
    return doc


def months_by_key(doc):
    return {e["month"]: e for e in doc.get("months") or []}


def burn_of(doc, ym):
    """Net burn in month ym (positive = cash went out), or None when it cannot be known."""
    by = months_by_key(doc)
    e = by.get(ym)
    if not e:
        return None
    if e.get("net_burn") is not None:
        return D(e["net_burn"])
    last = by.get(prev_month(ym))
    if e.get("cash") is None or not last or last.get("cash") is None:
        return None
    return D(last["cash"]) + D(e.get("money_in") or 0) - D(e["cash"])


def runway(doc, ym):
    """{cash, burn, avg_burn, months_used, runway, until} for month ym."""
    e = months_by_key(doc).get(ym) or {}
    out = {"cash": D(e["cash"]) if e.get("cash") is not None else None, "burn": burn_of(doc, ym),
           "avg_burn": None, "months_used": 0, "runway": None, "until": None}
    burns = []
    for k in range(BURN_MONTHS):
        b = burn_of(doc, add_months(ym, -k))
        if b is None:
            break
        burns.append(b)
    if burns:
        out["avg_burn"] = sum(burns, Decimal(0)) / len(burns)
        out["months_used"] = len(burns)
    if out["cash"] is not None and out["avg_burn"] is not None and out["avg_burn"] > 0:
        r = out["cash"] / out["avg_burn"]
        out["runway"] = rnd(r, 1)
        out["until"] = add_months(ym, int(r.to_integral_value(rounding=ROUND_CEILING)))
    return out


# ---------------------------------------------------------------- the update

def metric_rows(doc, ym):
    by = months_by_key(doc)
    cur = (by.get(ym) or {}).get("values") or {}
    last = (by.get(prev_month(ym)) or {}).get("values") or {}
    rows = []
    for m in doc["metrics"]:
        k = m["key"]
        if cur.get(k) is None:
            continue
        unit = m.get("unit", "count")
        text, sign = change(cur[k], last.get(k), unit)
        rows.append({"key": k, "label": m.get("label") or k, "unit": unit, "value": cur[k], "last": last.get(k),
                     "change": text, "mom": mom(cur[k], last.get(k), unit), "sign": sign,
                     "better": m.get("better", "up")})
    return rows


def headline(doc, rows):
    keys = doc.get("headline") or [r["key"] for r in rows[:3]]
    by = {r["key"]: r for r in rows}
    return [by[k] for k in keys if k in by]


def tldr_line(doc, ym, rows, rw, with_runway=True):
    parts = []
    for i, r in enumerate(headline(doc, rows)):
        label = r["label"] if i == 0 else r["label"][:1].lower() + r["label"][1:]
        mo = r["mom"]
        if mo.startswith(("+", "-")):
            mo += " MoM" if i == 0 else ""
        parts.append("%s %s (%s)" % (label, show(r["value"], r["unit"]), mo))
    line = ", ".join(parts) + "." if parts else ""
    if with_runway and rw["runway"] is not None:
        line += " Runway %s months." % trim(rw["runway"])
    return line.strip()


def company_and_founder(doc, cfg):
    st = (cfg or {}).get("startup") or {}
    fo = (cfg or {}).get("founder") or {}
    return (st.get("name") or doc.get("company") or "Our company"), (fo.get("name") or "")


def investor_update(doc, ym, cfg=None):
    """(markdown, warnings)."""
    e = months_by_key(doc).get(ym)
    if not e:
        raise UpdateError("no %s in metrics.json (it has %s): add it with update.py add --month %s" % (
            ym, ", ".join(sorted(months_by_key(doc))) or "no months", ym))
    rows = metric_rows(doc, ym)
    if not rows:
        raise UpdateError("%s has no values: add them with update.py add --month %s --set key=value" % (ym, ym))
    rw = runway(doc, ym)
    company, founder = company_and_founder(doc, cfg)
    warnings = []
    L = ["Subject: %s investor update: %s" % (company, month_name(ym)), "", "Hi everyone,", ""]
    L += ["**TL;DR:** %s" % (e.get("tldr") or tldr_line(doc, ym, rows, rw)), ""]
    L += ["**The numbers (%s)**" % month_name(ym), ""]
    for r in rows:
        if r["last"] is None:
            L.append("- %s: %s, new this month" % (r["label"], show(r["value"], r["unit"])))
        elif r["change"] == "flat":
            L.append("- %s: %s, flat on %s" % (r["label"], show(r["value"], r["unit"]), short_month(prev_month(ym))))
        else:
            L.append("- %s: %s, %s from %s" % (r["label"], show(r["value"], r["unit"]), r["change"],
                                              show(r["last"], r["unit"])))
    L.append("")
    for key, title, numbered in (("highlights", "Highlights", False), ("lowlights", "Lowlights", False),
                                 ("asks", "Asks", True)):
        items = [str(x).strip() for x in e.get(key) or [] if str(x).strip()]
        L += ["**%s**" % title, ""]
        if items:
            L += [("%d. %s" % (i, x)) if numbered else ("- %s" % x) for i, x in enumerate(items, start=1)]
        else:
            L.append("- None this month.")
            warnings.append({"highlights": "No highlights for %s: what went well?",
                             "lowlights": "No lowlights for %s: investors trust updates that say what went wrong.",
                             "asks": "No asks for %s: investors want to help, give them something specific."}[key]
                            % ym)
        L.append("")
    L += ["**Runway**", ""]
    if rw["cash"] is None:
        L.append("Cash at month end was not recorded.")
        warnings.append("No cash for %s: add it with update.py add --month %s --cash N." % (ym, ym))
    else:
        line = "Cash at the end of %s: %s." % (MONTH_NAMES[parse_month(ym)[1] - 1], money(rw["cash"]))
        if rw["burn"] is not None:
            line += " Net burn this month: %s." % money(rw["burn"]) if rw["burn"] > 0 else \
                " Cash grew %s this month." % money(-rw["burn"])
        if rw["runway"] is not None:
            line += " Average net burn over the last %s: %s a month, so the cash lasts about %s months, to around %s." % (
                "month" if rw["months_used"] == 1 else "%d months" % rw["months_used"], money(rnd(rw["avg_burn"], 0)),
                trim(rw["runway"]), short_month(rw["until"]))
        elif rw["avg_burn"] is not None:
            line += " No net burn on average over the last %s: the cash is not running down." % (
                "month" if rw["months_used"] == 1 else "%d months" % rw["months_used"])
        else:
            line += " Burn needs last month's cash too, so there is no runway figure yet."
        L.append(line)
    L.append("")
    L += ["Thank you for the help,", founder or "{your_name}", "Founder, %s" % company, ""]
    if not founder:
        warnings.append("No founder name in seed/config.json: the sign-off says {your_name}.")
    return "\n".join(L), warnings


def prospect_update(doc, ym, cfg=None):
    e = months_by_key(doc).get(ym)
    if not e:
        raise UpdateError("no %s in metrics.json: add it with update.py add --month %s" % (ym, ym))
    rows = metric_rows(doc, ym)
    if not rows:
        raise UpdateError("%s has no values: add them with update.py add --month %s --set key=value" % (ym, ym))
    company, founder = company_and_founder(doc, cfg)
    st = (cfg or {}).get("startup") or {}
    warnings = []
    L = ["Subject: %s: %s update" % (company, month_name(ym)), "", "Hi {first_name},", "",
         "You asked me to keep you posted, so here is where %s is." % company, "",
         "**%s:** %s" % (month_name(ym), tldr_line(doc, ym, rows, None, with_runway=False)), ""]
    tops = [str(x).strip() for x in e.get("highlights") or [] if str(x).strip()][:2]
    if tops:
        L += ["- %s" % x for x in tops]
        L.append("")
    else:
        warnings.append("No highlights for %s: the prospect update has only the numbers." % ym)
    if st.get("raise"):
        terms = " ".join(x for x in (short_money(st["raise"]), st.get("stage") or "seed") if x)
        inst = " (%s)" % st["instrument"] if st.get("instrument") else ""
        L.append("We are raising a %s%s. If the timing is better now, would a 20-minute call be useful?" % (terms, inst))
    else:
        L.append("We are raising our seed round. If the timing is better now, would a 20-minute call be useful?")
        warnings.append("No raise in seed/config.json: the update says 'our seed round'.")
    L += ["", OPT_OUT, "", founder or "{your_name}", "Founder, %s" % company, ""]
    if not founder:
        warnings.append("No founder name in seed/config.json: the sign-off says {your_name}.")
    warnings.append("Replace {first_name} for each investor before it goes out.")
    return "\n".join(L), warnings


# ---------------------------------------------------------------- commands

def metrics_path(a):
    return os.path.join(a.dir, "metrics.json")


def load(a):
    return validate(read_json(metrics_path(a), "metrics (run update.py init first)"))


def cmd_init(a):
    dest = metrics_path(a)
    if os.path.exists(dest) and not a.force:
        print("update.py: %s already exists. Add months with update.py add, or --force to start again from the "
              "example." % dest, file=sys.stderr)
        return 1
    write_json(dest, read_json(EXAMPLE, "example metrics"))
    print("Wrote %s (the Leashly example: replace the metrics and months with yours)." % dest)
    print("Next: each month, update.py add --month YYYY-MM --set key=value --cash N, then update.py write.")
    return 0


def cmd_add(a):
    path = metrics_path(a)
    doc = load(a)
    parse_month(a.month)
    keys = {m["key"]: m for m in doc["metrics"]}
    values = {}
    for item in a.set or []:
        if "=" not in item:
            raise UpdateError("--set wants key=value, like revenue=7875 (got %r)" % item)
        k, v = item.split("=", 1)
        k = k.strip()
        if k not in keys:
            raise UpdateError("%r is not one of your metrics (%s). Add it to metrics in %s first." % (
                k, ", ".join(keys), path))
        values[k] = fnum(D(v, "--set %s" % k))
    by = months_by_key(doc)
    e = by.get(a.month)
    if e is None:
        e = {"month": a.month, "values": {}}
        doc.setdefault("months", []).append(e)
    e.setdefault("values", {}).update(values)
    for k, v in (("cash", a.cash), ("money_in", a.money_in), ("net_burn", a.net_burn)):
        if v is not None:
            e[k] = fnum(D(v, "--" + k.replace("_", "-")))
    for k, items in (("highlights", a.highlight), ("lowlights", a.lowlight), ("asks", a.ask)):
        if items:
            e[k] = (e.get(k) or []) + [x.strip() for x in items if x.strip()]
    if a.tldr:
        e["tldr"] = a.tldr.strip()
    doc["months"] = sorted(doc["months"], key=lambda x: x["month"])
    validate(doc)
    write_json(path, doc)
    print("Saved %s in %s: %d value%s, cash %s." % (
        a.month, path, len(e["values"]), "" if len(e["values"]) == 1 else "s",
        money(e["cash"]) if e.get("cash") is not None else "not set"))
    missing = [k for k in keys if k not in e["values"]]
    if missing:
        print("Not set yet for %s: %s." % (a.month, ", ".join(missing)))
    return 0


def cmd_write(a):
    doc = load(a)
    ym = a.month
    if not ym:
        if not doc.get("months"):
            raise UpdateError("metrics.json has no months yet: update.py add --month YYYY-MM ...")
        ym = sorted(months_by_key(doc))[-1]
    parse_month(ym)
    cfg = read_json(os.path.join(a.dir, "config.json"), "config", required=False)
    if a.to == "prospects":
        text, warnings = prospect_update(doc, ym, cfg)
        out = os.path.join(a.dir, "updates", "%s-prospects.md" % ym)
    else:
        text, warnings = investor_update(doc, ym, cfg)
        out = os.path.join(a.dir, "updates", "%s.md" % ym)
    if a.stdout:
        sys.stdout.write(text)
    else:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("Wrote %s (%s update for %s)." % (out, "prospect" if a.to == "prospects" else "investor", month_name(ym)))
    for w in warnings:
        print("Note: %s" % w, file=sys.stderr if a.stdout else sys.stdout)
    if not a.stdout:
        print("Nothing was sent. Read it with the founder, then send it from their own Gmail after a yes.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Investor Updates (seed-updates): the monthly investor update.")
    ap.add_argument("--dir", default="seed", help="the seed/ folder (default ./seed)")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("init", help="copy metrics.example.json into seed/metrics.json")
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("add", help="record a month's numbers and notes in seed/metrics.json")
    p.add_argument("--month", required=True, help="YYYY-MM")
    p.add_argument("--set", action="append", metavar="KEY=VALUE", help="a metric's value (repeat it)")
    p.add_argument("--cash", help="cash in the bank at month end")
    p.add_argument("--money-in", help="new funding that arrived this month (not burn)")
    p.add_argument("--net-burn", help="override the computed net burn for this month")
    p.add_argument("--highlight", action="append", help="repeat it")
    p.add_argument("--lowlight", action="append", help="repeat it")
    p.add_argument("--ask", action="append", help="repeat it")
    p.add_argument("--tldr", help="your own TL;DR line")
    p = sub.add_parser("write", help="write the month's update")
    p.add_argument("--month", help="YYYY-MM (default: the latest month in metrics.json)")
    p.add_argument("--to", choices=["investors", "prospects"], default="investors")
    p.add_argument("--stdout", action="store_true", help="print it, write nothing")
    for name in ("init", "add", "write"):
        sub.choices[name].add_argument("--dir", default=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return {"init": cmd_init, "add": cmd_add, "write": cmd_write}[a.cmd](a)
    except UpdateError as e:
        print("update.py: %s" % e, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
