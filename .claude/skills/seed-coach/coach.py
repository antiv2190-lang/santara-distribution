#!/usr/bin/env python3
"""Pitch Coach for seed-coach: drills you on the hard questions investors ask,
tailored to your own numbers, grades your answers, and plans the first call.
Standard library only, no network.

    python3 coach.py drill --n 10                         # 10 questions across the 8 categories
    python3 coach.py drill --investor maya-chen --customers owners --provider walker
    python3 coach.py drill --category "unit economics" --seed 3
    python3 coach.py grade --answer "15% flat, no owner fee: $3.75 a walk is ours."
    python3 coach.py grade --file answer.txt --question ue-take
    python3 coach.py agenda --investor maya-chen --write  # a 20-minute first-call plan

The bank is questions.json in this folder: market, competition, traction, unit
economics, team, why now, risks, the ask. A question with {placeholders} is
tailored from seed/competitors.json (seed-scout), seed/model.json (seed-model),
seed/market.json (seed-market), seed/investors.json (seed-investors) and
seed/config.json, and is asked only when those files hold the numbers. Tailored
questions come first, then the category spread; --seed N shuffles within a
category, the same way every time.

grade checks five things, 20 points each: the length (15 to 150 words: under
60 seconds spoken at 150 words a minute), a number, no hedging words, specific
names and numbers with no buzzwords, and the answer first (a first sentence of
25 words or fewer).

agenda splits the call into seven blocks (2, 3, 4, 4, 4, 2, 1 minutes for 20;
scaled for --minutes 10 to 60) and pulls the call time from seed/calls/<id>.ics
(seed-closer) when there is one.

Writes only with --write: seed/coach/drill.md, seed/coach/agenda-<id>.md.
Exit codes: drill/agenda 0 done, 1 nothing to ask or no such investor;
grade 0 every check passed, 1 something to fix; 2 bad input.
"""

import argparse
import datetime
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, "questions.json")
WPM = 150
HEDGES = ["i think", "i guess", "i believe", "we believe", "we think", "maybe", "hopefully", "kind of",
          "sort of", "probably", "basically", "might", "perhaps", "try to", "we hope", "fingers crossed"]
BUZZ = ["synergy", "disrupt", "revolutionize", "revolutionise", "game-changer", "game changer", "best-in-class",
        "world-class", "paradigm", "uber for", "next-gen", "cutting-edge", "huge market", "everyone needs"]
BLOCKS = [("Hello and why them", 2), ("The problem", 3), ("The product", 4), ("Market and model", 4),
          ("Their questions", 4), ("The ask", 2), ("Next step", 1)]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


class CoachError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- reading seed/

def read_json(path, what="file"):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, IOError):
        return None
    except ValueError as e:
        raise CoachError("%s is not valid JSON: %s" % (path, e))


def load_bank(path=BANK):
    doc = read_json(path)
    if not doc or not doc.get("questions"):
        raise CoachError("no question bank at %s" % path)
    return doc


def money(x):
    """1500000 -> $1.5M, 17040000000 -> $17.04B, 3.75 -> $3.75, 2.225 -> $2.23 (half up), 82801 -> $82,801."""
    if x is None:
        return None
    from decimal import Decimal, ROUND_HALF_UP
    v = Decimal(str(x))
    for div, suf in ((10 ** 9, "B"), (10 ** 6, "M")):
        if v >= div:
            return "$" + ("%.2f" % float(v / div)).rstrip("0").rstrip(".") + suf
    if v == v.to_integral_value():
        return "${:,}".format(int(v))
    return "${:,}".format(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def num(x):
    if x is None:
        return None
    v = float(x)
    return str(int(v)) if v == int(v) else ("%.2f" % v).rstrip("0").rstrip(".")


def put(ctx, key, value):
    if value not in (None, "", []):
        ctx[key] = value


def context(sd, investor=None, customers=None, provider=None):
    """Everything a tailored question can use. A missing file just leaves its keys out."""
    ctx = {}
    cfg = read_json(os.path.join(sd, "config.json")) or {}
    st = cfg.get("startup") or {}
    put(ctx, "startup", st.get("name"))
    if st.get("raise") not in (None, ""):
        try:
            put(ctx, "raise", money(float(str(st["raise"]).replace("$", "").replace(",", ""))))
        except ValueError:
            put(ctx, "raise", str(st["raise"]))
    put(ctx, "instrument", st.get("instrument"))
    put(ctx, "one_liner", st.get("one_liner"))
    ctx["customers"] = customers or st.get("customers") or "users"
    prov = provider or st.get("provider")
    ctx["provider_pay"] = ("%s pay" % prov) if prov else "costs"

    comp = read_json(os.path.join(sd, "competitors.json")) or {}
    apps = sorted(comp.get("apps") or [], key=lambda a: -(a.get("ratings") or 0))
    for i, a in enumerate(apps[:2], 1):
        p = "c%d_" % i
        put(ctx, p + "name", a.get("name"))
        if a.get("ratings") is not None:
            put(ctx, p + "ratings", "{:,}".format(int(a["ratings"])))
        put(ctx, p + "rating", a.get("rating"))
        put(ctx, p + "weak", a.get("weak_point"))
        key = a.get("top_theme")
        cnt = a.get("weak_point_count")
        if cnt is None and key:
            cnt = (a.get("themes") or {}).get(key)
        put(ctx, p + "count", cnt)
        put(ctx, p + "low", a.get("low_reviews"))

    model = read_json(os.path.join(sd, "model.json")) or {}
    s, ue = model.get("summary") or {}, model.get("unit_economics") or {}
    asm = model.get("assumptions") or {}
    take = ue.get("take_rate_pct", asm.get("take_rate_pct"))
    if take is not None:
        ctx["take_rate"] = "%s%%" % num(take)
    put(ctx, "unit", ue.get("unit") or asm.get("unit"))
    put(ctx, "price", money(ue.get("price", asm.get("price"))))
    for k in ("revenue_per_order", "contribution_per_order", "cost_per_order", "ltv"):
        put(ctx, k, money(ue.get(k)))
    put(ctx, "cac", money(ue.get("cac", asm.get("cac"))))
    if ue.get("ltv_cac") is not None:
        ctx["ltv_cac"] = "%sx" % num(ue["ltv_cac"])
    put(ctx, "cac_payback", num(ue.get("cac_payback_months")))
    put(ctx, "breakeven_month", s.get("breakeven_month"))
    put(ctx, "runway", s.get("runway_months"))
    if s.get("peak_burn"):
        put(ctx, "peak_burn", money(s["peak_burn"]))
    for k in ("revenue_y1", "revenue_y3"):
        put(ctx, k, money(s.get(k)))
    if s.get("raise") and "raise" not in ctx:
        put(ctx, "raise", money(s["raise"]))
    funds = s.get("use_of_funds") or asm.get("use_of_funds") or {}
    if funds:
        top = max(funds.items(), key=lambda kv: float(kv[1]))
        ctx["top_fund"], ctx["top_fund_amount"] = top[0], money(top[1])

    mk = read_json(os.path.join(sd, "market.json")) or {}
    for k in ("tam", "sam", "som"):
        put(ctx, k, money(mk.get(k)))
    if mk.get("som_share_pct") is not None:
        ctx["som_share"] = "%s%%" % num(mk["som_share_pct"])
    put(ctx, "som_years", mk.get("som_years"))
    for x in mk.get("inputs") or []:
        if x.get("kind") == "assumption" and x.get("level") in ("tam", "sam"):
            ctx["assumption"] = "%s: %s%s" % (x["name"], num(x["value"]), "%" if x.get("unit") == "%" else "")
            break

    if investor:
        inv = find_investor(sd, investor)
        put(ctx, "inv_name", inv.get("name"))
        put(ctx, "inv_first", (inv.get("name") or "").split(" ")[0])
        put(ctx, "inv_firm", inv.get("firm"))
        deal = inv.get("last_relevant_deal") or {}
        put(ctx, "inv_deal", deal.get("what"))
        if inv.get("check_min") is not None:
            put(ctx, "inv_check", "%s-%s" % (money(inv["check_min"]), money(inv["check_max"])))
    if "startup" not in ctx:
        ctx["startup"] = "your company"
    return ctx


def find_investor(sd, ref):
    book = read_json(os.path.join(sd, "investors.json"))
    if not book:
        raise CoachError("no %s: rank investors with /seed-investors first" % os.path.join(sd, "investors.json"), 1)
    for x in book.get("investors") or []:
        if x.get("id") == ref or (x.get("name") or "").lower() == str(ref).lower():
            return x
    raise CoachError("no investor %r in %s" % (ref, os.path.join(sd, "investors.json")), 1)


# ---------------------------------------------------------------- drill

def fields(text):
    return [f for _, f, _, _ in string.Formatter().parse(text) if f]


def fill(text, ctx):
    """The text with its placeholders filled, or None if one is missing."""
    if any(f not in ctx for f in fields(text)):
        return None
    return text.format(**ctx)


def pick(bank, ctx, n=10, category=None, seed=None):
    cats = bank.get("categories") or []
    if category:
        if category not in cats:
            raise CoachError("--category is one of: %s" % ", ".join(cats))
        cats = [category]
    groups = []
    for c in cats:
        tailored, generic = [], []
        for q in bank["questions"]:
            if q.get("category") != c:
                continue
            text = fill(q["q"], ctx)
            if text is None:
                continue
            item = {"id": q["id"], "category": c, "q": text, "tests": q.get("tests"), "strong": q.get("strong"),
                    "tailored": bool(fields(q["q"])),
                    "hint": fill(q["hint"], ctx) if q.get("hint") else None}
            (tailored if item["tailored"] else generic).append(item)
        if seed is not None:
            rnd = random.Random("%s:%s" % (seed, c))
            rnd.shuffle(tailored)
            rnd.shuffle(generic)
        groups.append(tailored + generic)
    out = []
    # tailored first: one tailored per category per round, then the rest round-robin
    for want_tailored in (True, False):
        more = True
        while more and len(out) < n:
            more = False
            for g in groups:
                for item in g:
                    if item["tailored"] == want_tailored and item not in out:
                        out.append(item)
                        more = True
                        break
                if len(out) >= n:
                    break
    return out[:n]


def cmd_drill(a):
    if a.n < 1 or a.n > 50:
        raise CoachError("--n is 1 to 50")
    sd = a.dir or "seed"
    ctx = context(sd, a.investor, a.customers, a.provider)
    qs = pick(load_bank(a.bank), ctx, a.n, a.category, a.seed)
    if not qs:
        print("No questions to ask.")
        return 1
    if a.json:
        print(json.dumps({"questions": qs}, indent=2, ensure_ascii=False))
    else:
        who = " for %s (%s)" % (ctx["inv_name"], ctx.get("inv_firm") or "") if a.investor else ""
        print("Pitch drill%s: %d questions, %d tailored to your numbers" % (who, len(qs), sum(q["tailored"] for q in qs)))
        for i, q in enumerate(qs, 1):
            print("%2d. [%s] %s" % (i, q["category"], q["q"]))
            print("    They are checking: %s. Strong: %s." % (q["tests"], q["strong"]))
            if q.get("hint"):
                print("    Your numbers: %s" % q["hint"])
        print("Answer out loud in under 60 seconds, then: coach.py grade --answer \"...\" --question ID")
    if a.write:
        path = os.path.join(sd, "coach", "drill.md")
        lines = ["# Pitch drill", ""]
        for i, q in enumerate(qs, 1):
            lines += ["%d. **%s** (%s)" % (i, q["q"], q["category"]), "   - Checking: %s" % q["tests"],
                      "   - Strong: %s" % q["strong"]] + (["   - Your numbers: %s" % q["hint"]] if q.get("hint") else [])
        write_text(path, "\n".join(lines) + "\n")
        if not a.json:
            print("Wrote %s." % path)
    return 0


def write_text(path, text):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


# ---------------------------------------------------------------- grade

def grade(text):
    """Five checks, 20 points each. Returns {score, passed, checks: [(name, ok, note)], words, seconds}."""
    t = re.sub(r"\s+", " ", (text or "")).strip()
    if not t:
        raise CoachError("grade needs an answer: --answer \"...\" or --file FILE")
    words = re.findall(r"[A-Za-z0-9$%][A-Za-z0-9$%'.,-]*", t)
    n = len(words)
    secs = int(round(n * 60.0 / WPM))
    low = " " + t.lower() + " "
    checks = []
    checks.append(("length", 15 <= n <= 150,
                   "%d words, about %d seconds spoken" % (n, secs) if 15 <= n <= 150 else
                   ("%d words: too thin, give the reason and one number" % n if n < 15 else
                    "%d words, about %d seconds: over a minute, cut it to 150 words" % (n, secs))))
    has_num = bool(re.search(r"\d", t))
    checks.append(("a number", has_num, "it has a number" if has_num else "no number: add the one that proves it"))
    hedges = [h for h in HEDGES if re.search(r"(?<![a-z])%s(?![a-z])" % re.escape(h), low)]
    checks.append(("no hedging", not hedges, "no hedging words" if not hedges else
                   "hedging: %s. Say it straight" % ", ".join(hedges)))
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", t) if s]
    specifics = len(re.findall(r"\d[\d,.]*%?", t))
    for s in sentences:
        toks = s.split()
        specifics += sum(1 for w in toks[1:] if w[:1].isupper() and w.strip(string.punctuation) not in ("I",))
    buzz = [b for b in BUZZ if b in low]
    ok = specifics >= 2 and not buzz
    checks.append(("specific", ok, "%d specifics (numbers and names)" % specifics if ok else
                   ("buzzwords: %s" % ", ".join(buzz) if buzz else
                    "only %d specifics: name the customer, the competitor, the number" % specifics)))
    first = len(sentences[0].split()) if sentences else 0
    checks.append(("answer first", first <= 25, "the first sentence is %d words" % first if first <= 25 else
                   "the first sentence is %d words: lead with the answer in under 25" % first))
    score = 20 * sum(1 for _, ok, _ in checks if ok)
    return {"score": score, "passed": score == 100, "words": n, "seconds": secs,
            "checks": [{"check": c, "ok": ok, "note": note} for c, ok, note in checks]}


def cmd_grade(a):
    if a.file:
        try:
            with open(a.file, encoding="utf-8") as fh:
                text = fh.read()
        except (OSError, IOError):
            raise CoachError("no file %s" % a.file)
    else:
        text = a.answer
    g = grade(text)
    q = None
    if a.question:
        q = [x for x in load_bank(a.bank)["questions"] if x["id"] == a.question]
        if not q:
            raise CoachError("no question %r in the bank" % a.question)
        q = q[0]
    if a.json:
        print(json.dumps(dict(g, question=q["id"] if q else None), indent=2))
    else:
        if q:
            print("Question %s: %s" % (q["id"], q["q"]))
            print("  A strong answer has: %s." % q["strong"])
        print("Score %d/100" % g["score"])
        for c in g["checks"]:
            print("  [%s] %-13s %s" % ("x" if c["ok"] else " ", c["check"], c["note"]))
        print("Strong. Say it out loud twice more." if g["passed"] else "Fix the unchecked lines and try again.")
    return 0 if g["passed"] else 1


# ---------------------------------------------------------------- agenda

def split_minutes(total):
    """The seven blocks scaled to total minutes, largest remainder, summing exactly."""
    if total < 10 or total > 60:
        raise CoachError("--minutes is 10 to 60")
    raw = [w * total / 20.0 for _, w in BLOCKS]
    mins = [max(1, int(r)) for r in raw]
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - int(raw[i])), i))
    i = 0
    while sum(mins) < total:
        mins[order[i % len(order)]] += 1
        i += 1
    while sum(mins) > total:
        j = max(range(len(mins)), key=lambda k: (mins[k], -k))
        mins[j] -= 1
    return mins


def _nth_sunday(year, month, n):
    d = datetime.date(year, month, 1)
    d += datetime.timedelta(days=(6 - d.weekday()) % 7)
    return d + datetime.timedelta(weeks=n - 1)


def utc_to_eastern(utc):
    """US rule since 2007: daylight time from the 2nd Sunday of March to the 1st Sunday of November."""
    start = datetime.datetime.combine(_nth_sunday(utc.year, 3, 2), datetime.time(7, 0))
    end = datetime.datetime.combine(_nth_sunday(utc.year, 11, 1), datetime.time(6, 0))
    return utc + datetime.timedelta(hours=-4 if start <= utc < end else -5)


def clock(dt):
    return "%s %s %d %d, %d:%02d %s" % (DAYS[dt.weekday()], MONTHS[dt.month - 1], dt.day, dt.year,
                                        dt.hour % 12 or 12, dt.minute, "AM" if dt.hour < 12 else "PM")


def read_call(path):
    """seed/calls/<id>.ics -> {when, link} or None. A UTC time is shown in New York time."""
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except (OSError, IOError):
        return None
    text = re.sub(r"\r?\n[ \t]", "", raw)          # unfold long lines
    out = {}
    m = re.search(r"^DTSTART(;[^:\r\n]*)?:(\d{8}T\d{4,6})(Z?)\s*$", text, re.M)
    if m:
        dt = datetime.datetime.strptime(m.group(2)[:13], "%Y%m%dT%H%M")
        tz = re.search(r"TZID=([^;:]+)", m.group(1) or "")
        if m.group(3) == "Z":
            out["when"] = clock(utc_to_eastern(dt)) + " ET"
        else:
            out["when"] = clock(dt) + (" (%s)" % tz.group(1) if tz else "")
    keep = [l for l in text.splitlines() if l.split(":", 1)[0].split(";")[0] in ("URL", "LOCATION", "DESCRIPTION")]
    links = re.findall(r"https?://[^\s\\,;]+", "\n".join(keep))
    if links:
        out["link"] = links[0]
    return out or None


def build_agenda(sd, ref, minutes=20, customers=None, provider=None):
    inv = find_investor(sd, ref)
    ctx = context(sd, inv["id"], customers, provider)
    call = read_call(os.path.join(sd, "calls", "%s.ics" % inv["id"]))
    pipe = read_json(os.path.join(sd, "pipeline.json")) or {}
    status = None
    for r in pipe.get("investors") or []:
        if r.get("id") == inv["id"]:
            status = r.get("status")
    mins = split_minutes(minutes)
    problem = []
    for i in (1, 2):
        if ("c%d_name" % i) in ctx and ("c%d_count" % i) in ctx:
            problem.append("%s: %s of %s recent 1-2 star reviews mention %s." % (
                ctx["c%d_name" % i], ctx["c%d_count" % i], ctx["c%d_low" % i], ctx["c%d_weak" % i]))
    market = ", ".join("%s %s" % (k.upper(), ctx[k]) for k in ("tam", "sam", "som") if k in ctx)
    model = []
    if "take_rate" in ctx:
        model.append("%s take rate" % ctx["take_rate"])
    if "contribution_per_order" in ctx:
        model.append("%s contribution a %s" % (ctx["contribution_per_order"], ctx.get("unit", "order")))
    if "ltv_cac" in ctx:
        model.append("LTV:CAC %s" % ctx["ltv_cac"])
    if "breakeven_month" in ctx:
        model.append("breakeven in month %s" % ctx["breakeven_month"])
    likely = [q["q"] for q in pick(load_bank(), ctx, 3)]
    ask = "%s %s" % (ctx.get("raise", "The raise"), ctx.get("instrument") or "round")
    if "top_fund" in ctx:
        ask += "; the biggest use: %s (%s)" % (ctx["top_fund"], ctx["top_fund_amount"])
    texts = [
        "Thank them. %s Ask what they are looking at right now." % (
            ('Open with your line: "%s"' % inv["personal_line"]) if inv.get("personal_line") else "Say why them."),
        " ".join(problem) or "The problem in one sentence, with the evidence.",
        "%s: %s. Show it, do not describe it." % (ctx["startup"], ctx.get("one_liner") or "the product in one line"),
        "; ".join(x for x in (market, ", ".join(model)) if x) or "The market size and the model, two numbers each.",
        "Let them ask. Be ready for: " + " / ".join(likely),
        "%s. Ask who else they would want in the round." % ask,
        "Ask for the next step and a date: a partner meeting, then the deck and the data room.",
    ]
    rows, t = [], 0
    for (title, _), m, body in zip(BLOCKS, mins, texts):
        rows.append({"start": t, "end": t + m, "title": title, "minutes": m, "plan": body})
        t += m
    why = [r for r in inv.get("reasons") or [] if not r.endswith("(+0)")]
    return {"investor": inv["id"], "name": inv["name"], "firm": inv.get("firm"), "role": inv.get("role"),
            "minutes": minutes, "call": call, "status": status, "why": why[:3], "blocks": rows}


def agenda_lines(ag):
    out = ["First call: %s%s%s (%d minutes)" % (ag["name"], ", " + ag["role"] if ag.get("role") else "",
                                                 ", " + ag["firm"] if ag.get("firm") else "", ag["minutes"])]
    if ag.get("call"):
        out.append("When: %s%s" % (ag["call"].get("when", "see the invite"),
                                   ", " + ag["call"]["link"] if ag["call"].get("link") else ""))
    elif ag.get("status") != "booked":
        out.append("Not booked yet: /seed-closer books the call and writes the invite.")
    if ag["why"]:
        out.append("Why them: " + "; ".join(ag["why"]))
    for b in ag["blocks"]:
        out.append("  %2d-%-2d min  %-18s %s" % (b["start"], b["end"], b["title"], b["plan"]))
    out.append("Before: coach.py drill --investor %s, answered out loud. After: log it in /seed-closer and "
               "follow up within 24 hours." % ag["investor"])
    return out


def cmd_agenda(a):
    sd = a.dir or "seed"
    ag = build_agenda(sd, a.investor, a.minutes, a.customers, a.provider)
    lines = agenda_lines(ag)
    if a.json:
        print(json.dumps(ag, indent=2, ensure_ascii=False))
    else:
        for l in lines:
            print(l)
    if a.write:
        path = os.path.join(sd, "coach", "agenda-%s.md" % ag["investor"])
        write_text(path, "# %s\n\n" % lines[0] + "\n".join("- " + l.strip() for l in lines[1:]) + "\n")
        if not a.json:
            print("Wrote %s." % path)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Pitch Coach (seed-coach): hard questions, graded answers, the call plan.")
    sub = ap.add_subparsers(dest="cmd")

    def common(p):
        p.add_argument("--dir", help="the seed folder (default ./seed)")
        p.add_argument("--json", action="store_true")

    p = sub.add_parser("drill", help="the hard questions, tailored")
    p.add_argument("--n", type=int, default=10)
    p.add_argument("--category")
    p.add_argument("--seed", type=int, help="shuffle within each category, repeatably")
    p.add_argument("--investor", help="an id or name in seed/investors.json")
    p.add_argument("--customers", help='your customers in one word, e.g. "owners" (default "users")')
    p.add_argument("--provider", help='the supply side, e.g. "walker" (default: "costs")')
    p.add_argument("--bank", default=BANK, help=argparse.SUPPRESS)
    p.add_argument("--write", action="store_true", help="save seed/coach/drill.md")
    common(p)
    add_more_parsers(sub, common)
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 2
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return COMMANDS[a.cmd](a)
    except CoachError as e:
        print("coach.py: %s" % e, file=sys.stderr)
        return e.code


def add_more_parsers(sub, common):
    p = sub.add_parser("grade", help="grade a written answer")
    p.add_argument("--answer")
    p.add_argument("--file")
    p.add_argument("--question", help="a question id from the bank")
    p.add_argument("--bank", default=BANK, help=argparse.SUPPRESS)
    common(p)
    p = sub.add_parser("agenda", help="a first-call plan for a booked investor")
    p.add_argument("--investor", required=True)
    p.add_argument("--minutes", type=int, default=20)
    p.add_argument("--customers")
    p.add_argument("--provider")
    p.add_argument("--write", action="store_true", help="save seed/coach/agenda-<id>.md")
    common(p)


COMMANDS = {"drill": cmd_drill, "grade": cmd_grade, "agenda": cmd_agenda}


if __name__ == "__main__":
    sys.exit(main())
