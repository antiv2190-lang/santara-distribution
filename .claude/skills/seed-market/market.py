#!/usr/bin/env python3
"""Market Sizer for seed-market: TAM, SAM and SOM with a source on every input.
Standard library only, no network. Exact arithmetic (Decimal), whole dollars, half up.

    python3 market.py top-down --population 71M --population-name "US homes with a dog" \\
        --population-source "APPA 2026 State of the Industry" --share 10% --share-source "assumption: ..." \\
        --spend 2400 --spend-name "a year of walks" --spend-source "assumption: ..." --write       # TAM
    python3 market.py bottom-up --customers 400K --customers-source "..." --frequency 96 \\
        --frequency-source "..." --price 25 --price-source "..." --write                         # SAM
    python3 market.py som --share 2.5% --years 3 --reason "why you can win that much" --write      # SOM
    python3 market.py cite --name "US pet industry spend, 2025" --value 158B --source "APPA ..." --write
    python3 market.py show                                                                        # the numbers + checks
    python3 market.py check                                                                       # exit 1 if anything is off

The three numbers (yearly, in the currency):
  TAM  total addressable market   top-down: population x share x spend a year (default level)
  SAM  serviceable market         bottom-up: customers you can reach x purchases a year x price
                                  (either method can fill either level: --level tam|sam)
  SOM  what you can win           a share of SAM in N years, with a stated reason
They must keep SOM <= SAM <= TAM. A write that breaks it is refused. When SAM changes, SOM is
recomputed from its saved share.

Every input needs a source: a URL, a named publication ("APPA 2026 State of the Industry"), or an
assumption said out loud ("assumption: 1 in 10 dog homes pays for walks; check with a survey").
Empty or vague sources ("google", "TBD", "chatgpt") are refused. Assumptions are flagged wherever
they show up. cite records a sourced fact (like an industry total) that the plan and the deck
quote but the math does not use.

Writes seed/market.json only with --write (--dir changes seed/). /seed-plan, /seed-deck and
/seed-coach read it. Market sizes are estimates from your inputs, not a forecast, and not
investment advice.
Exit codes: 0 done, 1 refused (an order that breaks SOM <= SAM <= TAM, a missing source,
check found a problem), 2 bad input.
"""

import argparse
import datetime
import json
import os
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

LEVELS = ("tam", "sam", "som")
VAGUE = {"", "?", "tbd", "todo", "n/a", "na", "none", "source", "google", "internet", "the internet", "web",
         "online", "chatgpt", "ai", "claude", "common knowledge", "estimate", "guess", "assumption", "me"}
NOTE = "Estimates from your inputs, not a forecast. Not investment advice."
ONE = Decimal(1)


class MarketError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- numbers

def num(text, what):
    """71M, 400K, 1.5B, 2,400, $25 -> Decimal."""
    if isinstance(text, bool) or text is None:
        raise MarketError("%s is not a number: %r" % (what, text))
    if isinstance(text, (int, float)):
        return Decimal(repr(text)) if isinstance(text, float) else Decimal(text)
    t = str(text).strip().lower().replace(",", "").replace("$", "").replace(" ", "")
    m = re.match(r"^(\d+(?:\.\d+)?)(k|m|mm|b|bn)?$", t)
    if not m:
        raise MarketError("%s is not a number like 71M, 400K or 2400: %r" % (what, text))
    mult = {None: 1, "k": 10 ** 3, "m": 10 ** 6, "mm": 10 ** 6, "b": 10 ** 9, "bn": 10 ** 9}[m.group(2)]
    v = Decimal(m.group(1)) * mult
    if v <= 0:
        raise MarketError("%s must be above 0" % what)
    return v


def share(text, what="--share"):
    """10% or 0.10 -> Decimal fraction. A bare number above 1 is a percent."""
    t = str(text).strip()
    try:
        if t.endswith("%"):
            v = Decimal(t[:-1].strip()) / 100
        else:
            v = Decimal(t)
            if v > 1:
                v = v / 100
    except InvalidOperation:
        raise MarketError("%s wants a percent like 10%% or a fraction like 0.1, not %r" % (what, text))
    if v <= 0 or v > 1:
        raise MarketError("%s must be above 0%% and at most 100%%, not %r" % (what, text))
    return v


def whole(x):
    return int(Decimal(x).quantize(ONE, rounding=ROUND_HALF_UP))


def fmt_num(x):
    d = Decimal(x)
    if d == d.to_integral_value():
        return "{:,}".format(int(d))
    return "{:,}".format(float(d)).rstrip("0").rstrip(".")


def pct_text(frac):
    p = (Decimal(frac) * 100).normalize()
    s = format(p, "f")
    return (s.rstrip("0").rstrip(".") if "." in s else s) + "%"


def big(n, cur="USD"):
    """17040000000 -> $17.04B."""
    sign = "$" if cur == "USD" else cur + " "
    n = int(n)
    for div, suf in ((10 ** 12, "T"), (10 ** 9, "B"), (10 ** 6, "M"), (10 ** 3, "K")):
        if n >= div:
            s = "%.2f" % (n / float(div))
            return sign + s.rstrip("0").rstrip(".") + suf
    return sign + "{:,}".format(n)


def money_text(n, cur="USD"):
    return ("$" if cur == "USD" else cur + " ") + "{:,}".format(int(n))


def show_value(x, cur="USD"):
    """An input's value with its unit: 10%, $2,400, 400,000."""
    u = str(x.get("unit") or "")
    v = fmt_num(x["value"])
    if u.startswith("%"):
        return v + u
    if u == cur or u.startswith(cur + " "):
        return ("$" if cur == "USD" else cur + " ") + v + u[len(cur):]
    if u in ("count", ""):
        return v
    return "%s %s" % (v, u)


def source_kind(src, what):
    s = re.sub(r"\s+", " ", str(src or "")).strip()
    low = s.lower().strip(" .")
    if low in VAGUE:
        raise MarketError("%s needs a real source: a URL, a named publication, or \"assumption: <why>\" "
                          "(got %r)" % (what, src or ""), 1)
    if low.startswith("assumption"):
        why = re.sub(r"^assumption\s*[:,-]?\s*", "", s, flags=re.I)
        if len(why.split()) < 3:
            raise MarketError("%s: an assumption needs its reason in a few words, like \"assumption: 1 in 10 "
                              "dog homes pays for walks\"" % what, 1)
        return s, "assumption"
    if re.search(r"https?://", s):
        return s, "url"
    if len(s.split()) < 2:
        raise MarketError("%s: %r is too vague; name the publication or paste the URL" % (what, s), 1)
    return s, "publication"


def inp(name, value, unit, src, level, what):
    s, kind = source_kind(src, what)
    v = value if not isinstance(value, Decimal) else (int(value) if value == value.to_integral_value() else float(value))
    return {"name": name, "value": v, "unit": unit, "source": s, "kind": kind, "level": level}


# ---------------------------------------------------------------- the document

def today_of(text):
    if not text:
        return datetime.date.today()
    try:
        return datetime.datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        raise MarketError("--today wants YYYY-MM-DD, not %r" % text)


def path_of(a):
    return os.path.join(a.dir or "seed", "market.json")


def load(path):
    if not os.path.isfile(path):
        return {"created_by": "seed-market", "generated": None, "method": None, "tam": None, "sam": None,
                "som": None, "currency": "USD", "inputs": [], "notes": []}
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except ValueError as e:
        raise MarketError("%s is not valid JSON: %s" % (path, e))
    for k in ("inputs", "notes"):
        doc.setdefault(k, [])
    doc.setdefault("currency", "USD")
    return doc


def save(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def order_problems(doc):
    out = []
    t, s, o = doc.get("tam"), doc.get("sam"), doc.get("som")
    cur = doc.get("currency", "USD")
    if t is not None and s is not None and s > t:
        out.append("SAM %s is bigger than TAM %s: the market you can serve cannot beat the whole market"
                   % (big(s, cur), big(t, cur)))
    if s is not None and o is not None and o > s:
        out.append("SOM %s is bigger than SAM %s" % (big(o, cur), big(s, cur)))
    if t is not None and o is not None and o > t:
        out.append("SOM %s is bigger than TAM %s" % (big(o, cur), big(t, cur)))
    return out


def method_of(doc):
    parts = []
    for lv in ("tam", "sam"):
        m = (doc.get("methods") or {}).get(lv)
        if m:
            parts.append("%s %s" % (m, lv.upper()))
    if doc.get("som") is not None and doc.get("som_share_pct") is not None:
        parts.append("SOM %s of SAM in %d years" % (pct_text(Decimal(str(doc["som_share_pct"])) / 100), doc["som_years"]))
    return ", ".join(parts) or None


def set_level(doc, level, value, method, formula, inputs, today):
    doc["inputs"] = [x for x in doc["inputs"] if x.get("level") != level] + inputs
    doc[level] = value
    doc.setdefault("methods", {})[level] = method
    doc.setdefault("formulas", {})[level] = formula
    notes = []
    if level == "sam" and doc.get("som_share_pct") is not None:
        frac = Decimal(str(doc["som_share_pct"])) / 100
        doc["som"] = whole(Decimal(value) * frac)
        doc["formulas"]["som"] = "%s of SAM %s = %s" % (pct_text(frac), money_text(value, doc["currency"]),
                                                       money_text(doc["som"], doc["currency"]))
        notes.append("SOM recomputed from the new SAM: %s" % big(doc["som"], doc["currency"]))
    doc["method"] = method_of(doc)
    doc["generated"] = today.isoformat()
    doc["created_by"] = "seed-market"
    return notes


def finish(a, doc, lines, extra_notes=()):
    path = path_of(a)
    bad = order_problems(doc)
    if a.json:
        print(json.dumps({"ok": not bad, "problems": bad, "notes": list(extra_notes), "market": doc},
                         indent=2, ensure_ascii=False))
        if not bad and a.write:
            save(path, doc)
        return 1 if bad else 0
    for l in lines:
        print(l)
    for n in extra_notes:
        print("Note: " + n)
    assumptions = [x for x in doc["inputs"] if x.get("kind") == "assumption" and x.get("level") != "context"]
    if assumptions:
        print("Assumptions in it (say so when you quote it): %s." % "; ".join(x["name"] for x in assumptions))
    if bad:
        for b in bad:
            print("Refused: " + b, file=sys.stderr)
        print("Not saved. Fix the inputs: SOM <= SAM <= TAM.", file=sys.stderr)
        return 1
    if a.write:
        save(path, doc)
        print("Wrote %s." % path)
    else:
        print("Not saved: add --write.")
    print(NOTE)
    return 0


# ---------------------------------------------------------------- commands

def cmd_top_down(a):
    doc = load(path_of(a))
    cur = a.currency or doc["currency"]
    doc["currency"] = cur
    level = a.level or "tam"
    pop = num(a.population, "--population")
    sh = share(a.share)
    sp = num(a.spend, "--spend")
    value = whole(pop * sh * sp)
    pname = a.population_name or "people"
    shname = a.share_name or "share of %s that would buy" % pname
    sname = a.spend_name or "spend a year each"
    ins = [inp(pname, pop, "count", a.population_source, level, "--population-source"),
           inp(shname, sh * 100, "%", a.share_source, level, "--share-source"),
           inp(sname, sp, "%s a year" % cur, a.spend_source, level, "--spend-source")]
    formula = "%s %s x %s x %s = %s" % (fmt_num(pop), pname, pct_text(sh), money_text(sp, cur) if sp == sp.to_integral_value()
                                         else "$" + fmt_num(sp), money_text(value, cur))
    notes = set_level(doc, level, value, "top-down", formula, ins, today_of(a.today))
    lines = ["%s (top-down): %s a year" % (level.upper(), big(value, cur)), "  " + formula]
    for x in ins:
        lines.append("  - %s = %s: %s" % (x["name"], show_value(x, cur), x["source"]))
    return finish(a, doc, lines, notes)


def cmd_bottom_up(a):
    doc = load(path_of(a))
    cur = a.currency or doc["currency"]
    doc["currency"] = cur
    level = a.level or "sam"
    cu = num(a.customers, "--customers")
    fr = num(a.frequency, "--frequency")
    pr = num(a.price, "--price")
    value = whole(cu * fr * pr)
    cname = a.customers_name or "customers you can reach"
    unit = a.unit or "purchase"
    ins = [inp(cname, cu, "count", a.customers_source, level, "--customers-source"),
           inp("%ss a year per customer" % unit, fr, "per year", a.frequency_source, level, "--frequency-source"),
           inp("price per %s" % unit, pr, cur, a.price_source, level, "--price-source")]
    formula = "%s %s x %s %ss a year x %s = %s" % (fmt_num(cu), cname, fmt_num(fr), unit,
                                                  ("$" if cur == "USD" else cur + " ") + fmt_num(pr), money_text(value, cur))
    notes = set_level(doc, level, value, "bottom-up", formula, ins, today_of(a.today))
    lines = ["%s (bottom-up): %s a year" % (level.upper(), big(value, cur)), "  " + formula]
    for x in ins:
        lines.append("  - %s = %s: %s" % (x["name"], show_value(x, cur), x["source"]))
    return finish(a, doc, lines, notes)


def cmd_som(a):
    doc = load(path_of(a))
    cur = doc["currency"]
    if doc.get("sam") is None:
        raise MarketError("SOM is a share of SAM: size SAM first (market.py bottom-up --write)", 1)
    sh = share(a.share)
    if a.years < 1 or a.years > 10:
        raise MarketError("--years is 1 to 10")
    reason = re.sub(r"\s+", " ", a.reason or "").strip()
    if len(reason.split()) < 6:
        raise MarketError("--reason needs a real sentence on why you can win that share (who switches, why, "
                          "how you reach them)", 1)
    value = whole(Decimal(doc["sam"]) * sh)
    doc["som"] = value
    doc["som_share_pct"] = float(sh * 100)
    doc["som_years"] = a.years
    doc["som_reason"] = reason
    doc.setdefault("formulas", {})["som"] = "%s of SAM %s = %s" % (pct_text(sh), money_text(doc["sam"], cur),
                                                                  money_text(value, cur))
    doc["method"] = method_of(doc)
    doc["generated"] = today_of(a.today).isoformat()
    notes = []
    if sh > Decimal("0.1"):
        notes.append("%s of the SAM in %d years is a lot: be ready to defend it with a plan, customer by "
                     "customer" % (pct_text(sh), a.years))
    lines = ["SOM: %s a year within %d years (%s of SAM %s)" % (big(value, cur), a.years, pct_text(sh), big(doc["sam"], cur)),
             "  " + doc["formulas"]["som"], "  Why: " + reason]
    return finish(a, doc, lines, notes)


def cmd_cite(a):
    doc = load(path_of(a))
    v = num(a.value, "--value")
    x = inp(a.name.strip(), v, a.unit or doc["currency"], a.source, "context", "--source")
    doc["inputs"] = [i for i in doc["inputs"] if not (i.get("level") == "context" and i["name"] == x["name"])] + [x]
    doc["generated"] = today_of(a.today).isoformat()
    doc["created_by"] = "seed-market"
    shown = big(v, doc["currency"]) if x["unit"] == doc["currency"] else show_value(x, doc["currency"])
    lines = ["Fact: %s = %s" % (x["name"], shown), "  " + x["source"],
             "  (quoted by the plan and the deck; not part of the TAM, SAM, SOM math)"]
    return finish(a, doc, lines)


def report(doc):
    cur = doc.get("currency", "USD")
    lines = ["Market size (%s a year)%s" % (cur, ", " + doc["method"] if doc.get("method") else "")]
    for lv in LEVELS:
        v = doc.get(lv)
        f = (doc.get("formulas") or {}).get(lv)
        lines.append("  %s  %-10s %s" % (lv.upper(), big(v, cur) if v is not None else "not sized", f or ""))
    if doc.get("som_reason"):
        lines.append("  Why the SOM: " + doc["som_reason"])
    facts = [x for x in doc.get("inputs") or [] if x.get("level") == "context"]
    for x in facts:
        lines.append("  Fact: %s = %s (%s)" % (x["name"], big(x["value"], cur) if x["unit"] == cur else
                                               show_value(x, cur), x["source"]))
    return lines


def problems(doc):
    out = order_problems(doc)
    for lv in LEVELS:
        if doc.get(lv) is None:
            out.append("%s is not sized yet" % lv.upper())
    for x in doc.get("inputs") or []:
        try:
            source_kind(x.get("source"), "input %r" % x.get("name"))
        except MarketError as e:
            out.append(str(e))
    if doc.get("som") is not None and not doc.get("som_reason"):
        out.append("SOM has no stated reason")
    return out


def cmd_show(a):
    path = path_of(a)
    if not os.path.isfile(path):
        print("No %s yet. Start with market.py top-down ... --write" % path)
        return 1
    doc = load(path)
    if a.json:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
        return 0
    for l in report(doc):
        print(l)
    for x in doc["inputs"]:
        if x.get("kind") == "assumption":
            print("  Assumption (%s): %s = %s. %s" % (x["level"].upper() if x["level"] != "context" else "fact",
                                                      x["name"], show_value(x, doc.get("currency", "USD")), x["source"]))
    for p in problems(doc):
        print("Check: " + p)
    print(NOTE)
    return 0


def cmd_check(a):
    path = path_of(a)
    if not os.path.isfile(path):
        print("No %s yet." % path)
        return 1
    doc = load(path)
    bad = problems(doc)
    if a.json:
        print(json.dumps({"ok": not bad, "problems": bad}, indent=2))
    elif bad:
        for b in bad:
            print("Problem: " + b)
    else:
        print("OK: SOM <= SAM <= TAM, every input has a source, the SOM has its reason.")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Market Sizer (seed-market): TAM, SAM, SOM with sources.")
    sub = ap.add_subparsers(dest="cmd")

    def common(p, writes=True):
        p.add_argument("--dir", help="the seed folder (default ./seed)")
        p.add_argument("--today", help="YYYY-MM-DD for the date written (default: today)")
        p.add_argument("--json", action="store_true")
        if writes:
            p.add_argument("--write", action="store_true", help="save seed/market.json")

    p = sub.add_parser("top-down", help="population x share x spend")
    p.add_argument("--population", required=True)
    p.add_argument("--population-name")
    p.add_argument("--population-source", required=True)
    p.add_argument("--share", required=True, help="10%% or 0.1")
    p.add_argument("--share-name")
    p.add_argument("--share-source", required=True)
    p.add_argument("--spend", required=True, help="spend a year each")
    p.add_argument("--spend-name")
    p.add_argument("--spend-source", required=True)
    p.add_argument("--level", choices=["tam", "sam"])
    p.add_argument("--currency")
    common(p)
    p = sub.add_parser("bottom-up", help="customers x purchases a year x price")
    p.add_argument("--customers", required=True)
    p.add_argument("--customers-name")
    p.add_argument("--customers-source", required=True)
    p.add_argument("--frequency", required=True, help="purchases a year per customer")
    p.add_argument("--frequency-source", required=True)
    p.add_argument("--price", required=True)
    p.add_argument("--price-source", required=True)
    p.add_argument("--unit", help='what one purchase is, e.g. "walk" (default "purchase")')
    p.add_argument("--level", choices=["sam", "tam"])
    p.add_argument("--currency")
    common(p)
    p = sub.add_parser("som", help="the share of SAM you can win in N years")
    p.add_argument("--share", required=True)
    p.add_argument("--years", type=int, required=True)
    p.add_argument("--reason", required=True)
    common(p)
    p = sub.add_parser("cite", help="a sourced fact the plan quotes (not part of the math)")
    p.add_argument("--name", required=True)
    p.add_argument("--value", required=True)
    p.add_argument("--unit")
    p.add_argument("--source", required=True)
    common(p)
    p = sub.add_parser("show", help="print seed/market.json with its checks")
    common(p, writes=False)
    p = sub.add_parser("check", help="exit 1 if the numbers are out of order or unsourced")
    common(p, writes=False)
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 2
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return {"top-down": cmd_top_down, "bottom-up": cmd_bottom_up, "som": cmd_som, "cite": cmd_cite,
                "show": cmd_show, "check": cmd_check}[a.cmd](a)
    except MarketError as e:
        print("market.py: %s" % e, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
