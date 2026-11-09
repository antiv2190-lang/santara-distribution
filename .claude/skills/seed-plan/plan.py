#!/usr/bin/env python3
"""Business Planner for seed-plan: turns your idea into a business plan.
Standard library only, no network. Deterministic (pass --today to pin the date).

    python3 plan.py init --name Leashly --one-liner "A dog-walking app with flat prices"
    python3 plan.py init --name Leashly --one-liner "..." --raise 1.5M --founder "Your Name" --email you@leashly.co
    python3 plan.py build                 # seed/plan.md + the numbers in seed/plan.json, then the checks
    python3 plan.py check                 # the checks only: exit 0 clean, 1 something to fix
    python3 plan.py check --json

init writes seed/config.json (the startup, the founder, the outreach limits: every seed skill
reads it) and seed/plan.json, a skeleton with the nine sections: Executive summary, Problem,
Solution, Market, Competition, Business model, Go-to-market, Financial plan, Use of funds.
Each section has "text" (the plan's prose), "pitch" (one line for the deck slide) and "points"
(up to three short bullets). Claude writes them with the founder.

build pulls the numbers from the other skills' files and writes seed/plan.md:
  seed/market.json       TAM, SAM, SOM and their sourced inputs (seed-market)
  seed/model.json        the 36-month model: revenue, breakeven, burn, runway (seed-model)
  seed/competitors.json  the competitors' ratings and weak points (seed-scout)
It computes the unit economics from the model's assumptions:
  revenue per order          price x take rate
  contribution per order     revenue per order minus the costs of one order
  CAC payback (months)       CAC / (contribution per order x orders per customer a month)
  LTV                        contribution per customer a month / monthly churn
  LTV:CAC                    LTV / CAC

The checks. Flags (fix before anyone sees the plan): an empty section, a missing file, a
raise that disagrees between config.json and model.json, a use of funds that does not add up
to the raise, a SOM above the SAM or a SAM above the TAM, year 3 GMV above the SOM, a model
whose unit economics or yearly totals no longer match its own assumptions, a contribution at
or below $0. Notes (worth a look): a number in a section's text that is in none of the files,
LTV:CAC under 3x, CAC payback over 12 months, cash that runs out inside the 36 months, no
breakeven, no tagline, no team, an empty pitch line.

Projections from your own assumptions, not a forecast. Not investment advice.
Exit codes: init 0 written, 1 refused (a plan is already there). build 0 written. check 0
clean, 1 flags. 2 bad input everywhere (a missing or broken file, a bad flag).
"""

import argparse
import datetime
import json
import os
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

SECTIONS = [("executive_summary", "Executive summary"), ("problem", "Problem"), ("solution", "Solution"),
            ("market", "Market"), ("competition", "Competition"), ("business_model", "Business model"),
            ("go_to_market", "Go-to-market"), ("financial_plan", "Financial plan"), ("use_of_funds", "Use of funds")]
SKILL_FOR = {"model.json": "/seed-model", "market.json": "/seed-market", "competitors.json": "/seed-scout"}
DEFAULT_BRAND = {"brand": "#2F6FEB", "ink": "#0E1B33", "accent": "#FFB020"}
OUTREACH = {"daily_cap": 20, "followup_days": [3, 7], "max_touches": 3, "business_days": True}
CENT = Decimal("0.01")
ONE = Decimal(1)
LTV_CAC_BAR = Decimal(3)
PAYBACK_BAR = Decimal(12)
NOTE = ("Projections come from your own assumptions in seed/model.json: a plan, not a promise. Raising money "
        "depends on the business, and investors decide. Not investment advice.")
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
# a number as people write it: $1.5M, 71M, 15%, 4.24x, 515,771, $2.23
NUM_RE = re.compile(r"(?<![\w.])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?"
                    r"(?:\s?(thousand|million|billion|bn|[KkMB])(?![A-Za-z]))?(\s?%|x(?![A-Za-z]))?(?![\w])")
DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?([T ].*)?$")
SCALE = {"k": 3, "thousand": 3, "m": 6, "million": 6, "b": 9, "bn": 9, "billion": 9}


class PlanError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- numbers

def D(x, what="a number"):
    if isinstance(x, bool) or x is None:
        raise PlanError("%s is not a number: %r" % (what, x))
    try:
        if isinstance(x, float):
            return Decimal(repr(x))
        return Decimal(str(x).strip().lstrip("$").replace(",", ""))
    except (InvalidOperation, ValueError):
        raise PlanError("%s is not a number: %r" % (what, x))


def rnd(x, dp):
    return D(x).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)


def fnum(x):
    d = D(x)
    return int(d) if d == d.to_integral_value() else float(d)


def money(x, dp=None):
    """$1,500,000 for whole amounts, $2.23 for the rest (or a fixed dp)."""
    d = D(x)
    if dp is None:
        dp = 0 if d == d.to_integral_value() else 2
    q = rnd(d, dp)
    return "%s$%s" % ("-" if q < 0 else "", format(abs(q), ",f"))


def short_money(x):
    """$158B, $8.5B, $22.8M, $2.99M, $467K, $82.8K, $950."""
    d = D(x)
    sign, a = ("-" if d < 0 else ""), abs(d)

    def trim(q):
        s = format(q, "f")
        return s.rstrip("0").rstrip(".") if "." in s else s

    if a >= Decimal("1e9"):
        return "%s$%sB" % (sign, trim(rnd(a / Decimal("1e9"), 1)))
    if a >= Decimal("1e6"):
        return "%s$%sM" % (sign, trim(rnd(a / Decimal("1e6"), 1 if a >= Decimal("1e7") else 2)))
    if a >= Decimal("1e3"):
        return "%s$%sK" % (sign, trim(rnd(a / Decimal("1e3"), 0 if a >= Decimal("1e5") else 1)))
    return "%s$%s" % (sign, trim(rnd(a, 0)))


def pct(x, dp=1):
    s = format(rnd(x, dp), "f")
    return (s.rstrip("0").rstrip(".") if "." in s else s) + "%"


def parse_money(text):
    """1500000, 1,500,000, $1.5M, 750k, 2B -> Decimal dollars."""
    t = str(text).strip().replace(",", "").lstrip("$").strip()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*([kKmMbB])?$", t)
    if not m:
        raise PlanError("--raise wants an amount like 1500000, $1.5M or 750k (got %r)" % text)
    v = Decimal(m.group(1))
    if m.group(2):
        v = v.scaleb(SCALE[m.group(2).lower()])
    return v


def month_name(ym):
    m = re.match(r"^(\d{4})-(\d{2})$", str(ym or ""))
    if not m:
        return str(ym)
    return "%s %s" % (MONTH_NAMES[int(m.group(2)) - 1], m.group(1))


def tokens(text):
    """Every number written in a piece of text: [(as written, kind, value Decimal, decimals, scale)]."""
    out = []
    for m in NUM_RE.finditer(str(text)):
        dollar, whole, frac, suffix, tail = m.groups()
        base = Decimal(whole.replace(",", "") + ("." + frac if frac else ""))
        scale = SCALE.get(suffix.lower(), 0) if suffix else 0
        kind = "pct" if tail and "%" in tail else "mult" if tail else "money" if dollar else "plain"
        out.append((m.group(0).strip(), kind, base, len(frac or ""), scale))
    return out


def worth_checking(tok):
    raw, kind, base, dp, scale = tok
    if kind == "plain" and not scale and dp == 0:
        if base <= 10:
            return False                    # "3 cities", "2 seed rounds": too small to trace
        if 1900 <= base <= 2100 and "," not in raw:
            return False                    # a year
    return True


def known_values(*docs):
    """Every number in the given JSON documents, including numbers written inside their strings."""
    vals = set()

    def walk(x):
        if isinstance(x, bool) or x is None:
            return
        if isinstance(x, (int, float)):
            vals.add(D(x))
        elif isinstance(x, str):
            if DATE_RE.match(x):
                return                      # 2029-12 is a date, not a 12
            for _, _, base, _, scale in tokens(x):
                vals.add(base.scaleb(scale))
        elif isinstance(x, dict):
            for k, v in x.items():
                walk(k)
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for doc in docs:
        walk(doc)
    return vals


def matches(tok, known):
    """Does a number as written (rounded the way it is shown) come from one of the known values?"""
    raw, kind, base, dp, scale = tok
    digits = format(base, "f").replace(".", "").lstrip("0")
    exact = len(digits) < 2             # "$9B" is not a fair rounding of 8.52B: one digit must be exact
    for k in known:
        cands = [abs(k)]
        if kind == "pct":
            cands.append(abs(k) * 100)
        for c in cands:
            v = c.scaleb(-scale)
            if (v == base) if exact else (rnd(v, dp) == base):
                return True
    return False


def untraced(text, known):
    return [t[0] for t in tokens(text) if worth_checking(t) and not matches(t, known)]


# ---------------------------------------------------------------- files

def read_json(path, what, required=True):
    if not os.path.exists(path):
        if required:
            raise PlanError("no %s at %s" % (what, path))
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise PlanError("%s is not valid JSON: %s" % (path, e))


def write_json(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")


def write_text(path, text):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def strip_notes(doc):
    if isinstance(doc, dict):
        return {k: strip_notes(v) for k, v in doc.items() if not str(k).startswith("_")}
    if isinstance(doc, list):
        return [strip_notes(v) for v in doc]
    return doc


def parse_today(text):
    if not text:
        return datetime.date.today()
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        raise PlanError("--today wants YYYY-MM-DD (got %r)" % text)


# ---------------------------------------------------------------- the numbers block

def unit_economics(a):
    """From seed-model's assumptions. Exact (Decimal) inside, JSON numbers out."""
    try:
        price = D(a["price"], "price")
        take = D(a["take_rate_pct"], "take_rate_pct")
        cust = a.get("customers") or {}
        opc = D(cust["orders_per_customer_month"], "orders_per_customer_month")
        churn = D(cust["churn_monthly_pct"], "churn_monthly_pct")
        cac = D(a["cac"], "cac")
        costs = []
        for c in a.get("cost_per_order") or []:
            one = price * D(c.get("pct_of_price", 0), "pct_of_price") / 100 + D(c.get("fixed", 0), "fixed")
            costs.append({"label": str(c.get("label") or "cost"), "amount": fnum(one)})
    except KeyError as e:
        raise PlanError("model.json's assumptions have no %s: run model.py run --write again" % e)
    rev = price * take / 100
    cost = sum((D(c["amount"]) for c in costs), Decimal(0))
    contrib = rev - cost
    per_cust = contrib * opc
    ltv = per_cust / (churn / 100) if churn > 0 else None
    ltv_cac = ltv / cac if (ltv is not None and cac > 0) else None
    payback = cac / per_cust if per_cust > 0 else None
    return {"unit": str(a.get("unit") or "order"), "units": str(a.get("units") or (a.get("unit") or "order") + "s"),
            "price": fnum(price), "take_rate_pct": fnum(take), "revenue_per_order": fnum(rev),
            "cost_per_order": fnum(cost), "costs": costs, "contribution_per_order": fnum(contrib),
            "orders_per_customer_month": fnum(opc), "contribution_per_customer_month": fnum(per_cust),
            "churn_monthly_pct": fnum(churn), "cac": fnum(cac),
            "ltv": fnum(rnd(ltv, 2)) if ltv is not None else None,
            "ltv_cac": fnum(rnd(ltv_cac, 2)) if ltv_cac is not None else None,
            "cac_payback_months": fnum(rnd(payback, 2)) if payback is not None else None}


def years_of(model):
    months = model.get("months") or []
    out = []
    for y in range(3):
        rows = months[y * 12:(y + 1) * 12]
        if len(rows) != 12:
            break

        def tot(key):
            return fnum(sum((D(r.get(key, 0)) for r in rows), Decimal(0)))

        out.append({"year": y + 1, "orders": tot("orders"), "gmv": tot("gmv"), "revenue": tot("revenue"),
                    "gross_profit": tot("gross_profit"), "opex": tot("opex"), "net": tot("net"),
                    "cash_end": fnum(D(rows[-1].get("cash", 0))), "customers_end": rows[-1].get("customers")})
    return out


def num_or_value(x):
    """market.json tam/sam/som: a number, or {"value": n}."""
    if isinstance(x, dict):
        x = x.get("value")
    if x is None or isinstance(x, bool):
        return None
    try:
        return D(x)
    except PlanError:
        return None


def gather(cfg, model, market, comps):
    st = cfg.get("startup") or {}
    n = {"currency": "USD", "raise": None, "instrument": st.get("instrument") or "", "stage": st.get("stage") or ""}
    if st.get("raise") not in (None, ""):
        n["raise"] = fnum(parse_money(st["raise"]))
    if model:
        s = model.get("summary") or {}
        n["currency"] = s.get("currency") or n["currency"]
        n["unit_economics"] = unit_economics(model.get("assumptions") or {})
        fin = {k: s.get(k) for k in ("months", "start_month", "end_month", "revenue_y1", "revenue_y2", "revenue_y3",
                                     "gmv_y1", "gmv_y2", "gmv_y3", "breakeven_month", "breakeven_date", "peak_burn",
                                     "peak_burn_month", "runway_months", "cash_out_month", "cash_low",
                                     "cash_low_month", "cash_end", "customers_end")}
        fin["years"] = years_of(model)
        n["financials"] = fin
        n["model_raise"] = s.get("raise")
        n["use_of_funds"] = s.get("use_of_funds") or (model.get("assumptions") or {}).get("use_of_funds") or {}
        base = D(n["raise"]) if n.get("raise") else sum((D(v) for v in n["use_of_funds"].values()), Decimal(0))
        n["use_of_funds_pct"] = {k: fnum(rnd(D(v) / base * 100, 1)) for k, v in n["use_of_funds"].items()} \
            if base else {}
    if market:
        n["market"] = {"method": market.get("method"), "currency": market.get("currency") or n["currency"],
                       "tam": fnum(num_or_value(market.get("tam"))) if num_or_value(market.get("tam")) is not None else None,
                       "sam": fnum(num_or_value(market.get("sam"))) if num_or_value(market.get("sam")) is not None else None,
                       "som": fnum(num_or_value(market.get("som"))) if num_or_value(market.get("som")) is not None else None,
                       "inputs": strip_notes(market.get("inputs") or []), "notes": market.get("notes") or ""}
    if comps:
        rows = []
        labels = comps.get("theme_labels") or {}
        for app in comps.get("apps") or []:
            themes = app.get("themes") or {}
            top = app.get("top_theme")
            if not top and themes:
                top = sorted(themes.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
            count = app.get("weak_point_count")
            if count is None and top:
                count = themes.get(top)
            rows.append({"name": app.get("name"), "rating": app.get("rating"), "ratings": app.get("ratings"),
                         "reviews_read": app.get("reviews_read"), "low_reviews": app.get("low_reviews"),
                         "top_theme": top, "top_label": labels.get(top) or app.get("weak_point") or top,
                         "top_count": count, "weak_point": app.get("weak_point") or labels.get(top) or top,
                         "source": app.get("source")})
        n["competitors"] = rows
        n["competitors_generated"] = comps.get("generated")
        n["low_stars"] = comps.get("low_stars") or 2
    return n


# ---------------------------------------------------------------- checks

def section_list(plan):
    """The nine sections in order, filling in any the file is missing."""
    have = {s.get("key"): s for s in plan.get("sections") or [] if isinstance(s, dict)}
    out = []
    for key, title in SECTIONS:
        s = have.get(key) or {}
        out.append({"key": key, "title": s.get("title") or title, "text": (s.get("text") or "").strip(),
                    "pitch": (s.get("pitch") or "").strip(), "points": [p for p in (s.get("points") or []) if p]})
    return out


def checks(cfg, plan, model, market, comps, n, paths):
    flags, notes = [], []
    secs = section_list(plan)
    for i, s in enumerate(secs):
        if not s["text"]:
            flags.append("%s is empty: write it in seed/plan.json (sections[%d].text)." % (s["title"], i))
        elif not s["pitch"]:
            notes.append("%s has no pitch line: the deck will use its first sentence." % s["title"])
    for name, doc in (("model.json", model), ("market.json", market), ("competitors.json", comps)):
        if doc is None:
            flags.append("No %s: run %s first, then build again." % (paths[name], SKILL_FOR[name]))
    st = cfg.get("startup") or {}
    for k in ("name", "one_liner"):
        if not st.get(k):
            flags.append("config.json has no startup.%s." % k)
    if n.get("raise") is None or D(n["raise"]) <= 0:
        flags.append("config.json has no startup.raise: how much are you raising?")
    if model:
        mr = n.get("model_raise")
        if n.get("raise") is not None and mr is not None and D(mr) != D(n["raise"]):
            flags.append("The raise disagrees: config.json says %s, model.json says %s." % (money(n["raise"]), money(mr)))
        funds = n.get("use_of_funds") or {}
        total = sum((D(v) for v in funds.values()), Decimal(0))
        target = D(mr) if mr is not None else (D(n["raise"]) if n.get("raise") is not None else None)
        if not funds:
            flags.append("No use of funds in model.json: add use_of_funds to seed/assumptions.json.")
        elif target is not None and total != target:
            flags.append("The use of funds adds up to %s, not the %s raise." % (money(total), money(target)))
        s = model.get("summary") or {}
        for y, row in enumerate(n["financials"]["years"], start=1):
            said = s.get("revenue_y%d" % y)
            if said is not None and D(said) != D(row["revenue"]):
                flags.append("model.json says year %d revenue is %s but its months add up to %s: run model.py run "
                             "--write again." % (y, money(said), money(row["revenue"])))
        mue = model.get("unit_economics") or {}
        ue = n["unit_economics"]
        stale = [k for k in ("revenue_per_order", "contribution_per_order", "ltv", "ltv_cac", "cac_payback_months")
                 if k in mue and mue[k] is not None and ue.get(k) is not None and D(mue[k]) != D(ue[k])]
        if stale:
            flags.append("model.json's unit economics (%s) no longer match its assumptions: run model.py run --write "
                         "again." % ", ".join(stale))
        if D(ue["contribution_per_order"]) <= 0:
            flags.append("Each %s loses money before opex: contribution is %s. Raise the price or the take rate, "
                         "or cut the cost per %s." % (ue["unit"], money(ue["contribution_per_order"], 2), ue["unit"]))
        else:
            if ue["ltv_cac"] is not None and D(ue["ltv_cac"]) < LTV_CAC_BAR:
                notes.append("LTV:CAC is %sx, under the 3x most seed investors look for." % ue["ltv_cac"])
            if ue["cac_payback_months"] is not None and D(ue["cac_payback_months"]) > PAYBACK_BAR:
                notes.append("CAC payback is %s months, over the 12 investors usually want." % ue["cac_payback_months"])
        fin = n["financials"]
        if fin.get("cash_out_month"):
            notes.append("The cash runs out in month %d (%s): the raise covers %d months. Say what it buys by then, "
                         "or raise more." % (fin["cash_out_month"], month_name(_date_of(model, fin["cash_out_month"])),
                                            fin["runway_months"]))
        if not fin.get("breakeven_month"):
            notes.append("No breakeven inside the %s months of the model." % (fin.get("months") or 36))
    if market:
        mk = n["market"]
        tam, sam, som = mk.get("tam"), mk.get("sam"), mk.get("som")
        if None in (tam, sam, som):
            flags.append("market.json needs tam, sam and som: run /seed-market.")
        else:
            if D(som) > D(sam):
                flags.append("The SOM (%s) is bigger than the SAM (%s)." % (short_money(som), short_money(sam)))
            if D(sam) > D(tam):
                flags.append("The SAM (%s) is bigger than the TAM (%s)." % (short_money(sam), short_money(tam)))
            if model and n["financials"].get("gmv_y3") is not None and D(n["financials"]["gmv_y3"]) > D(som):
                flags.append("Year 3 GMV (%s) is above your SOM (%s): the model sells more than the share of the "
                             "market you said you can win." % (short_money(n["financials"]["gmv_y3"]), short_money(som)))
        if model and mk.get("currency") and mk["currency"] != n["currency"]:
            flags.append("market.json is in %s but model.json is in %s." % (mk["currency"], n["currency"]))
    known = known_values(strip_notes(cfg), model and {k: v for k, v in model.items() if k != "months"},
                         market, comps, n)
    for s in secs:
        for where, text in (("text", s["text"]), ("pitch", s["pitch"]), ("points", " ; ".join(s["points"]))):
            bad = untraced(text, known)
            if bad:
                notes.append("%s %s: %s %s in none of the seed/ files. Check %s." % (
                    s["title"], where, ", ".join(bad), "is" if len(bad) == 1 else "are", "it" if len(bad) == 1 else "them"))
    if not (plan.get("tagline") or "").strip():
        notes.append("No tagline in plan.json: the deck's title slide will use the one-liner.")
    if not [t for t in plan.get("team") or [] if isinstance(t, dict) and t.get("name")]:
        notes.append("No team in plan.json: the deck's team slide needs at least the founder.")
    return flags, notes


def _date_of(model, m):
    rows = model.get("months") or []
    return rows[m - 1].get("date") if 0 < m <= len(rows) else None


# ---------------------------------------------------------------- the plan

def md_escape(text):
    return str(text).replace("|", "\\|")


def render(cfg, plan, n, flags, notes, today):
    st = cfg.get("startup") or {}
    name = st.get("name") or "Your startup"
    secs = section_list(plan)
    ue, fin, mk = n.get("unit_economics"), n.get("financials"), n.get("market")
    comps = n.get("competitors") or []
    L = ["# %s: business plan" % name, ""]
    if st.get("one_liner"):
        L += ["**%s.**" % st["one_liner"].rstrip("."), ""]
    if n.get("raise"):
        raise_line = "Raising a %s %s round" % (money(n["raise"]), st.get("stage") or "")
        raise_line = raise_line.replace("  ", " ")
    else:
        raise_line = "The raise is not set yet"
    if n.get("instrument"):
        raise_line += " on a %s" % n["instrument"]
    L += ["%s. Built %s from the files in seed/." % (raise_line, today.strftime("%b %d, %Y").replace(" 0", " ")), ""]

    rows = []
    if n.get("raise"):
        rows.append(("The raise", "%s %s" % (money(n["raise"]), st.get("stage") or "")))
    if mk and None not in (mk.get("tam"), mk.get("sam"), mk.get("som")):
        rows.append(("Market (TAM / SAM / SOM)", "%s / %s / %s" % (short_money(mk["tam"]), short_money(mk["sam"]),
                                                                  short_money(mk["som"]))))
    if ue:
        rows.append(("Take rate", "%s of a %s %s" % (pct(ue["take_rate_pct"]), money(ue["price"], 2), ue["unit"])))
        rows.append(("Contribution per %s" % ue["unit"], money(ue["contribution_per_order"], 2)))
        if ue["ltv_cac"] is not None:
            rows.append(("LTV:CAC", "%sx (LTV %s, CAC %s)" % (ue["ltv_cac"], money(ue["ltv"], 2), money(ue["cac"], 2))))
        if ue["cac_payback_months"] is not None:
            rows.append(("CAC payback", "%s months" % ue["cac_payback_months"]))
    if fin:
        rows.append(("Revenue, years 1 to 3", " / ".join(money(fin["revenue_y%d" % y]) for y in (1, 2, 3))))
        rows.append(("Breakeven", "month %d (%s)" % (fin["breakeven_month"], month_name(fin["breakeven_date"]))
                     if fin.get("breakeven_month") else "not inside the model"))
        if fin.get("peak_burn"):
            rows.append(("Peak burn", "%s a month (month %s)" % (money(fin["peak_burn"]), fin.get("peak_burn_month"))))
        rows.append(("Runway", runway_text(fin)))
    if rows:
        L += ["| Key number | |", "| --- | ---: |"]
        L += ["| %s | %s |" % (md_escape(k), md_escape(v.strip())) for k, v in rows]
        L.append("")

    L += ["## Checks", ""]
    if not flags and not notes:
        L += ["Every check passed: no empty sections, and the numbers agree between files.", ""]
    else:
        L += ["- **Fix:** %s" % f for f in flags]
        L += ["- Note: %s" % x for x in notes]
        L.append("")

    for i, s in enumerate(secs, start=1):
        L += ["## %d. %s" % (i, s["title"]), ""]
        if s["text"]:
            L += [s["text"], ""]
        else:
            L += ["_Not written yet. Write it in seed/plan.json, then run plan.py build again._", ""]
        if s["points"]:
            L += ["- %s" % p for p in s["points"]]
            L.append("")
        L += section_data(s["key"], plan, n, st)
    L += ["---", "", "_Every number in this plan comes from the files in seed/. %s_" % NOTE, ""]
    return "\n".join(L)


def cap(text):
    return text[:1].upper() + text[1:]


def stars_text(n):
    low = n.get("low_stars") or 2
    return "1 star" if low == 1 else "1 and 2 star" if low == 2 else "1 to %s star" % low


def input_text(it, cur):
    """A market input as people read it: $158,000,000,000, 10%, 71,000,000 homes."""
    v, unit = it.get("value"), str(it.get("unit") or "")
    try:
        d = D(v)
        num = "{:,}".format(int(d)) if d == d.to_integral_value() else format(d, ",f")
    except PlanError:
        return str(v)
    if unit.lower() in ("usd", "$") or unit == cur or unit.startswith(cur + " "):
        rest = unit[len(cur):] if unit.startswith(cur + " ") else ""
        return money(d) + rest
    if unit.startswith("%") or unit == "pct":
        return trim_pct(d) + (unit[1:] if unit.startswith("%") else "")
    if unit in ("count", ""):
        return num
    return "%s %s" % (num, unit)


def trim_pct(d):
    s = format(d, "f")
    return (s.rstrip("0").rstrip(".") if "." in s else s) + "%"


def runway_text(fin):
    if fin.get("cash_out_month"):
        return "%d months: the cash runs out in month %d" % (fin["runway_months"], fin["cash_out_month"])
    low = " (low point %s in month %s)" % (money(fin["cash_low"]), fin.get("cash_low_month")) \
        if fin.get("cash_low") is not None else ""
    return "the cash lasts all %s months%s" % (fin.get("months") or 36, low)


def section_data(key, plan, n, st):
    """The tables build adds under a section, from the other skills' files."""
    L = []
    ue, fin, mk = n.get("unit_economics"), n.get("financials"), n.get("market")
    comps = n.get("competitors") or []
    if key == "executive_summary":
        team = [t for t in plan.get("team") or [] if isinstance(t, dict) and t.get("name")]
        if team:
            L.append("**Team.** " + " ".join("%s, %s.%s" % (t["name"], t.get("role") or "founder",
                                                         (" " + t["line"].rstrip(".") + ".") if t.get("line") else "")
                                             for t in team))
            L.append("")
    elif key == "problem" and comps:
        when = n.get("competitors_generated")
        L.append("What the competitors' own reviews say (seed/competitors.json%s):" % (", " + str(when) if when else ""))
        L.append("")
        for c in comps:
            if c.get("top_count") is not None and c.get("low_reviews"):
                L.append("- %s: %s of %s recent %s reviews mention %s." % (
                    c["name"], c["top_count"], c["low_reviews"], stars_text(n), c["top_label"]))
        L.append("")
    elif key == "market" and mk:
        L += ["| | Size (%s) |" % mk.get("currency", "USD"), "| --- | ---: |"]
        for k, label in (("tam", "TAM, the whole market"), ("sam", "SAM, the part you can serve"),
                         ("som", "SOM, the part you can win")):
            if mk.get(k) is not None:
                L.append("| %s | %s (%s) |" % (label, money(mk[k]), short_money(mk[k])))
        L.append("")
        if mk.get("inputs"):
            L += ["Method: %s. The inputs and where each comes from:" % (mk.get("method") or "not given"), "",
                  "| Input | Value | Source |", "| --- | ---: | --- |"]
            for it in mk["inputs"]:
                shown = input_text(it, mk.get("currency") or "USD")
                L.append("| %s | %s | %s |" % (md_escape(it.get("name", "")), md_escape(shown),
                                              md_escape(it.get("source") or "MISSING: add a source")))
            L.append("")
        notes = mk.get("notes")
        if isinstance(notes, list):
            L += ["- %s" % x for x in notes if x] + ([""] if [x for x in notes if x] else [])
        elif notes:
            L += [str(notes), ""]
    elif key == "competition" and comps:
        L += ["| App | Rating | Ratings | Low reviews | Weak point | Evidence |", "| --- | ---: | ---: | ---: | --- | --- |"]
        for c in comps:
            ev = "%s of %s mention %s" % (c["top_count"], c["low_reviews"], c["top_label"]) \
                if c.get("top_count") is not None and c.get("low_reviews") else ""
            low = "%s of %s read" % (c.get("low_reviews"), c.get("reviews_read")) if c.get("reviews_read") else ""
            L.append("| %s | %s | %s | %s | %s | %s |" % (
                md_escape(c.get("name") or ""), c.get("rating") if c.get("rating") is not None else "",
                "{:,}".format(c["ratings"]) if isinstance(c.get("ratings"), int) else "", low,
                md_escape(cap(c.get("weak_point") or "")), md_escape(ev)))
        L.append("")
        srcs = [c["source"] for c in comps if c.get("source")]
        if srcs:
            L += ["Sources: " + ", ".join(srcs), ""]
    elif key == "business_model" and ue:
        u = ue["unit"]
        costs = ", ".join("%s %s" % (c["label"], money(c["amount"], 2)) for c in ue["costs"])
        L += ["| Per %s | |" % u, "| --- | ---: |",
              "| Price | %s |" % money(ue["price"], 2),
              "| You keep (%s take rate) | %s |" % (pct(ue["take_rate_pct"]), money(ue["revenue_per_order"], 2)),
              "| Costs of one %s | %s%s |" % (u, money(ue["cost_per_order"], 2), (" (%s)" % md_escape(costs)) if costs else ""),
              "| **Contribution per %s** | **%s** |" % (u, money(ue["contribution_per_order"], 2)),
              "| %s per customer a month | %s |" % (ue["units"].capitalize(), ue["orders_per_customer_month"]),
              "| Contribution per customer a month | %s |" % money(ue["contribution_per_customer_month"], 2),
              "| CAC (cost to win one customer) | %s |" % money(ue["cac"], 2)]
        if ue["cac_payback_months"] is not None:
            L.append("| CAC payback | %s months (CAC / contribution per customer a month) |" % ue["cac_payback_months"])
        L.append("| Monthly churn | %s |" % pct(ue["churn_monthly_pct"]))
        if ue["ltv"] is not None:
            L.append("| LTV | %s (contribution per customer a month / churn) |" % money(ue["ltv"], 2))
        if ue["ltv_cac"] is not None:
            L.append("| **LTV:CAC** | **%sx** |" % ue["ltv_cac"])
        L.append("")
    elif key == "financial_plan" and fin:
        yrs = fin.get("years") or []
        if yrs:
            units = ue["units"].capitalize() if ue else "Orders"
            L += ["| | " + " | ".join("Year %d" % y["year"] for y in yrs) + " |",
                  "| --- |" + " ---: |" * len(yrs)]
            L.append("| %s | %s |" % (units, " | ".join("{:,}".format(y["orders"]) for y in yrs)))
            for k, label in (("gmv", "GMV"), ("revenue", "Revenue"), ("gross_profit", "Gross profit"),
                             ("opex", "Opex"), ("net", "Net"), ("cash_end", "Cash at year end")):
                L.append("| %s | %s |" % (label, " | ".join(money(y[k], 0) for y in yrs)))
            L.append("")
        L.append("- Breakeven: %s." % ("month %d (%s), and every month after it" % (
            fin["breakeven_month"], month_name(fin["breakeven_date"])) if fin.get("breakeven_month") else
            "not inside the model"))
        if fin.get("peak_burn"):
            L.append("- Peak burn: %s in month %s." % (money(fin["peak_burn"]), fin.get("peak_burn_month")))
        L.append("- Runway: %s." % runway_text(fin))
        L += ["", "_From seed/model.json, %s to %s: projections from your own assumptions, not a forecast._" % (
            month_name(fin.get("start_month")), month_name(fin.get("end_month"))), ""]
    elif key == "use_of_funds":
        funds = n.get("use_of_funds") or {}
        if funds:
            total = sum((D(v) for v in funds.values()), Decimal(0))
            base = D(n["raise"]) if n.get("raise") else total
            L += ["| Use | Amount | Share |", "| --- | ---: | ---: |"]
            for k, v in funds.items():
                L.append("| %s | %s | %s |" % (md_escape(k), money(v), pct(D(v) / base * 100) if base else ""))
            L.append("| **Total** | **%s** | **%s** |" % (money(total), pct(total / base * 100) if base else ""))
            L.append("")
            if n.get("raise") and total == D(n["raise"]):
                L += ["Adds up to the %s raise." % money(n["raise"]), ""]
    return L


# ---------------------------------------------------------------- commands

def paths_for(d):
    return {k: os.path.join(d, k) for k in ("config.json", "plan.json", "plan.md", "model.json", "market.json",
                                            "competitors.json")}


def load_all(d):
    p = paths_for(d)
    if not os.path.isdir(d):
        raise PlanError("no %s/ folder here: run plan.py init first" % d)
    cfg = read_json(p["config.json"], "config (run plan.py init first)")
    plan = read_json(p["plan.json"], "plan (run plan.py init first)")
    model = read_json(p["model.json"], "model", required=False)
    market = read_json(p["market.json"], "market", required=False)
    comps = read_json(p["competitors.json"], "competitors", required=False)
    return p, cfg, plan, model, market, comps


def cmd_init(a):
    p = paths_for(a.dir)
    if os.path.exists(p["plan.json"]) and not a.force:
        print("plan.py: %s already exists. Edit it, or use --force to start again (that erases its sections)."
              % p["plan.json"], file=sys.stderr)
        return 1
    for k, v in (("--brand", a.brand), ("--ink", a.ink), ("--accent", a.accent)):
        if v and not HEX.match(v):
            raise PlanError("%s wants a colour like #2F6FEB (got %r)" % (k, v))
    wrote = []
    if os.path.exists(p["config.json"]) and not a.force:
        cfg = read_json(p["config.json"], "config")
        kept = True
    else:
        if not a.name or not a.one_liner:
            raise PlanError("init needs --name and --one-liner (the startup's name and what it does, in one line)")
        st = {"name": a.name, "one_liner": a.one_liner, "sector": a.sector or "", "stage": a.stage or "seed",
              "geography": a.geography or "", "raise": fnum(parse_money(a.raise_)) if a.raise_ else None,
              "instrument": a.instrument or ""}
        founder = {"name": a.founder or "", "email": a.email or "", "company_address": a.address or ""}
        cfg = {"startup": st, "founder": founder,
               "sec_user_agent": ("%s %s" % (a.founder, a.email)) if (a.founder and a.email) else "",
               "outreach": dict(OUTREACH)}
        write_json(p["config.json"], cfg)
        wrote.append(p["config.json"])
        kept = False
    founder = (cfg.get("founder") or {}).get("name") or ""
    plan = {"created_by": "seed-plan", "tagline": a.tagline or "",
            "brand": {"brand": a.brand or DEFAULT_BRAND["brand"], "ink": a.ink or DEFAULT_BRAND["ink"],
                      "accent": a.accent or DEFAULT_BRAND["accent"]},
            "sections": [{"key": k, "title": t, "text": "", "pitch": "", "points": []} for k, t in SECTIONS],
            "team": [{"name": founder, "role": "Founder", "line": ""}],
            "numbers": {}, "flags": [], "notes": [], "built": None}
    write_json(p["plan.json"], plan)
    wrote.append(p["plan.json"])
    for w in wrote:
        print("Wrote %s." % w)
    if kept:
        print("Kept the existing %s (use --force to replace it)." % p["config.json"])
    if not (cfg.get("startup") or {}).get("raise"):
        print("Note: config.json has no raise yet. Set startup.raise (a number in dollars).")
    print("Next: write the nine sections into %s with the founder (text, a one-line pitch, up to 3 points), "
          "run /seed-scout, /seed-market and /seed-model, then plan.py build." % p["plan.json"])
    return 0


def evaluate(a):
    p, cfg, plan, model, market, comps = load_all(a.dir)
    n = gather(cfg, model, market, comps)
    flags, notes = checks(cfg, plan, model, market, comps, n, p)
    return p, cfg, plan, n, flags, notes


def print_checks(flags, notes):
    if not flags and not notes:
        print("Every check passed: no empty sections, and the numbers agree between files.")
    for f in flags:
        print("  FIX   %s" % f)
    for x in notes:
        print("  note  %s" % x)


def cmd_build(a):
    today = parse_today(a.today)
    p, cfg, plan, n, flags, notes = evaluate(a)
    text = render(cfg, plan, n, flags, notes, today)
    write_text(p["plan.md"], text)
    st = cfg.get("startup") or {}
    fo = cfg.get("founder") or {}
    plan = dict(plan, startup={k: st.get(k) for k in ("name", "one_liner", "sector", "stage", "geography", "raise",
                                                     "instrument")},
                founder={"name": fo.get("name") or "", "email": fo.get("email") or ""},
                numbers=n, flags=flags, notes=notes, built=today.isoformat())
    write_json(p["plan.json"], plan)
    filled = sum(1 for s in section_list(plan) if s["text"])
    if a.json:
        print(json.dumps({"wrote": [p["plan.md"], p["plan.json"]], "sections_written": filled, "flags": flags,
                          "notes": notes, "numbers": n}, indent=2))
        return 0
    print("%s: business plan, %d of 9 sections written." % (st.get("name") or "Your startup", filled))
    ue = n.get("unit_economics")
    if ue:
        print("  Per %-8s price %s, take %s = %s, contribution %s" % (
            ue["unit"], money(ue["price"], 2), pct(ue["take_rate_pct"]), money(ue["revenue_per_order"], 2),
            money(ue["contribution_per_order"], 2)))
        if ue["ltv_cac"] is not None:
            print("  LTV:CAC      %sx, CAC payback %s months" % (ue["ltv_cac"], ue["cac_payback_months"]))
    print_checks(flags, notes)
    print("Wrote %s and %s." % (p["plan.md"], p["plan.json"]))
    print("Next: /seed-deck turns plan.json into the 10-slide deck." if not flags else
          "Next: fix the items marked FIX, build again, then /seed-deck.")
    return 0


def cmd_check(a):
    p, cfg, plan, n, flags, notes = evaluate(a)
    if a.json:
        print(json.dumps({"ok": not flags, "flags": flags, "notes": notes}, indent=2))
    else:
        print_checks(flags, notes)
    return 0 if not flags else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="Business Planner (seed-plan): the idea, turned into a business plan.")
    ap.add_argument("--dir", default="seed", help="the seed/ folder (default ./seed)")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("init", help="write seed/config.json and the plan.json skeleton")
    p.add_argument("--name")
    p.add_argument("--one-liner")
    p.add_argument("--tagline", help="the short line for the deck's title slide")
    p.add_argument("--sector")
    p.add_argument("--stage", default="seed")
    p.add_argument("--geography")
    p.add_argument("--raise", dest="raise_", metavar="AMOUNT", help="1500000, $1.5M or 750k")
    p.add_argument("--instrument", help='e.g. "post-money SAFE" or "priced equity"')
    p.add_argument("--founder", help="the founder's name")
    p.add_argument("--email", help="the founder's own work email (outreach goes from it)")
    p.add_argument("--address", help="the company's mailing address (outreach emails carry it)")
    p.add_argument("--brand", help="brand colour, #RRGGBB")
    p.add_argument("--ink", help="text colour, #RRGGBB")
    p.add_argument("--accent", help="accent colour, #RRGGBB")
    p.add_argument("--force", action="store_true", help="replace an existing config.json and plan.json")
    p = sub.add_parser("build", help="write seed/plan.md and the numbers into plan.json")
    p.add_argument("--today", help="the build date, YYYY-MM-DD (default today)")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("check", help="the checks only")
    p.add_argument("--json", action="store_true")
    for name in ("init", "build", "check"):
        sub.choices[name].add_argument("--dir", default=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return {"init": cmd_init, "build": cmd_build, "check": cmd_check}[a.cmd](a)
    except PlanError as e:
        print("plan.py: %s" % e, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
