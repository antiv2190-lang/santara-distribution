#!/usr/bin/env python3
"""Financial Modeler for seed-model: the 36-month model behind your raise.
Standard library only, no network. Deterministic: the same assumptions give
the same numbers, to the cent.

    python3 model.py init                  # copy assumptions.example.json to seed/assumptions.json
    python3 model.py run                   # 36 months from seed/assumptions.json, then the summary
    python3 model.py run --write           # also write seed/model.json (plan, deck and coach read it)
    python3 model.py run --months --json   # every month, as JSON
    python3 model.py funds                 # does the use of funds add up to the raise?
    python3 model.py csv                   # seed/model.json to seed/model.csv, for a spreadsheet

The model, month by month (m = 1 to 36):
  new customers  new_month_1, growing new_growth_pct a month (one rate for each year)
  customers      last month's, minus churn (churn_monthly_pct, rounded half up), plus the new ones
  orders         customers x orders_per_customer_month (rounded half up)
  GMV            orders x price: what customers pay
  revenue        GMV x take_rate_pct: what you keep
  gross profit   revenue minus orders x cost_per_order (card fees, per-order costs): the contribution
  opex           payroll x (1 + payroll_overhead_pct) + marketing (new customers x CAC)
                 + monthly opex + one-off costs that month
  net            gross profit minus opex
  cash           last month's cash + net (+ the raise in raise_month)

The summary:
  revenue_y1..y3   the sums of months 1-12, 13-24 and 25-36
  breakeven_month  the first month with net >= 0 that every later month keeps (null if never)
  peak_burn        the biggest monthly loss
  runway_months    the months the cash covers before it first goes below zero; 36 when it never
                   does (cash_out_month is then null)
  unit_economics   revenue and contribution per order, CAC payback, LTV and LTV:CAC

Refused, with the reason: a missing or negative input, a take rate or churn outside 0 to 100, a
start month that is not YYYY-MM. funds exits 1 when the use of funds does not add up to the raise.

Projections from your own assumptions, not a forecast. Not investment advice.
Exit codes: 0 done, 1 refused (funds that do not add up, a file already there), 2 bad input.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
EXAMPLE = os.path.join(HERE, "assumptions.example.json")
MONTHS = 36
CENT = Decimal("0.01")
ONE = Decimal(1)
NOTE = "Projections from your own assumptions: a plan, not a forecast. Not investment advice."
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
CSV_FIELDS = ["month", "date", "new_customers", "churned", "customers", "orders", "gmv", "revenue",
              "cost_of_revenue", "gross_profit", "payroll", "marketing", "other_opex", "opex", "net", "cash"]
CSV_MONEY = CSV_FIELDS[6:]


class ModelError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- numbers

def D(x, what="a number"):
    if isinstance(x, bool) or x is None:
        raise ModelError("%s is not a number: %r" % (what, x))
    try:
        if isinstance(x, float):
            return Decimal(repr(x))
        return Decimal(str(x).strip().lstrip("$").replace(",", ""))
    except (InvalidOperation, ValueError):
        raise ModelError("%s is not a number: %r" % (what, x))


def cents(x):
    return D(x).quantize(CENT, rounding=ROUND_HALF_UP)


def half_up(x):
    return int(D(x).quantize(ONE, rounding=ROUND_HALF_UP))


def money(x, dp=0):
    q = D(x).quantize(CENT if dp else ONE, rounding=ROUND_HALF_UP)
    sign = "-" if q < 0 else ""
    return "%s$%s" % (sign, format(abs(q), ",f"))


def fnum(x):
    """A Decimal for JSON: a whole number as int, otherwise a float."""
    d = D(x)
    if d == d.to_integral_value():
        return int(d)
    return float(d)


def month_label(start, m):
    """start = (year, month); m = 1 is the start month. Returns ('2027-01', 'Jan 2027')."""
    y, mo = start
    idx = (mo - 1) + (m - 1)
    yy, mm = y + idx // 12, idx % 12 + 1
    return "%04d-%02d" % (yy, mm), "%s %d" % (MONTH_NAMES[mm - 1], yy)


# ---------------------------------------------------------------- assumptions

def read_json(path, what):
    if not os.path.exists(path):
        raise ModelError("no %s at %s" % (what, path))
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise ModelError("%s is not valid JSON: %s" % (path, e))


def clean(doc):
    """The assumptions without the _about style notes."""
    if isinstance(doc, dict):
        return {k: clean(v) for k, v in doc.items() if not str(k).startswith("_")}
    if isinstance(doc, list):
        return [clean(v) for v in doc]
    return doc


def validate(doc):
    """Check every input and return them as Decimals. Raises ModelError listing every problem."""
    if not isinstance(doc, dict):
        raise ModelError("the assumptions must be a JSON object")
    errs = []

    def num(obj, key, where, default=None, lo=Decimal(0), hi=None, required=True):
        if key not in obj or obj[key] is None:
            if required and default is None:
                errs.append("%s%s is missing" % (where, key))
                return Decimal(0)
            return D(default) if default is not None else None
        try:
            v = D(obj[key], where + key)
        except ModelError as e:
            errs.append(str(e))
            return Decimal(0)
        if lo is not None and v < lo:
            errs.append("%s%s must be %s or more (got %s)" % (where, key, lo, obj[key]))
        if hi is not None and v > hi:
            errs.append("%s%s must be %s or less (got %s)" % (where, key, hi, obj[key]))
        return v

    a = {"company": str(doc.get("company") or "Your startup"), "currency": str(doc.get("currency") or "USD"),
         "unit": str(doc.get("unit") or "order")}
    a["units"] = str(doc.get("units") or a["unit"] + "s")
    sm = str(doc.get("start_month") or "")
    m = re.match(r"^(\d{4})-(\d{2})$", sm)
    if not m or not 1 <= int(m.group(2)) <= 12:
        errs.append("start_month wants YYYY-MM, like 2027-01 (got %r)" % (doc.get("start_month"),))
        a["start"] = (2027, 1)
    else:
        a["start"] = (int(m.group(1)), int(m.group(2)))
    a["price"] = num(doc, "price", "", lo=None)
    if doc.get("price") is not None and a["price"] <= 0 and not any(e.startswith("price ") for e in errs):
        errs.append("price must be above 0 (got %s)" % doc.get("price"))
    a["take"] = num(doc, "take_rate_pct", "", hi=Decimal(100))
    a["cash_at_start"] = num(doc, "cash_at_start", "", default=0, lo=None)
    a["raise"] = num(doc, "raise", "")
    rm = num(doc, "raise_month", "", default=1, lo=Decimal(1), hi=Decimal(MONTHS))
    a["raise_month"] = int(rm) if rm is not None else 1
    a["cac"] = num(doc, "cac", "")
    a["overhead"] = num(doc, "payroll_overhead_pct", "", default=0, hi=Decimal(200))

    cust = doc.get("customers")
    if not isinstance(cust, dict):
        errs.append("customers is missing: {starting, new_month_1, new_growth_pct, churn_monthly_pct, "
                    "orders_per_customer_month}")
        cust = {"new_month_1": 0, "churn_monthly_pct": 0, "orders_per_customer_month": 0}
    a["starting"] = num(cust, "starting", "customers.", default=0)
    a["new1"] = num(cust, "new_month_1", "customers.")
    a["churn"] = num(cust, "churn_monthly_pct", "customers.")
    if a["churn"] >= 100:
        errs.append("customers.churn_monthly_pct must be under 100 (got %s)" % cust.get("churn_monthly_pct"))
    a["opc"] = num(cust, "orders_per_customer_month", "customers.")
    g = cust.get("new_growth_pct", 0)
    if not isinstance(g, list):
        g = [g]
    if not 1 <= len(g) <= 3:
        errs.append("customers.new_growth_pct wants one number or one a year (up to 3)")
        g = [0]
    growth = []
    for i, v in enumerate(g):
        try:
            gv = D(v, "customers.new_growth_pct[%d]" % i)
            if gv <= -100:
                errs.append("customers.new_growth_pct[%d] must be above -100" % i)
            growth.append(gv)
        except ModelError as e:
            errs.append(str(e))
            growth.append(Decimal(0))
    while len(growth) < 3:
        growth.append(growth[-1])
    a["growth"] = growth

    costs = []
    for i, it in enumerate(doc.get("cost_per_order") or []):
        if not isinstance(it, dict):
            errs.append("cost_per_order[%d] must be an object" % i)
            continue
        w = "cost_per_order[%d]." % i
        pct = num(it, "pct_of_price", w, default=0, hi=Decimal(100))
        fixed = num(it, "fixed", w, default=0)
        costs.append({"label": str(it.get("label") or "cost %d" % (i + 1)), "pct": pct, "fixed": fixed})
    a["costs"] = costs

    roles = []
    for i, it in enumerate(doc.get("payroll") or []):
        if not isinstance(it, dict):
            errs.append("payroll[%d] must be an object" % i)
            continue
        w = "payroll[%d]." % i
        start = num(it, "start_month", w, default=1, lo=Decimal(1), hi=Decimal(MONTHS))
        end = num(it, "end_month", w, required=False, lo=Decimal(1), hi=Decimal(MONTHS))
        roles.append({"role": str(it.get("role") or "role %d" % (i + 1)), "monthly": num(it, "monthly", w),
                      "count": num(it, "count", w, default=1), "start": int(start),
                      "end": int(end) if end is not None else MONTHS})
    a["payroll"] = roles

    opex = []
    for i, it in enumerate(doc.get("opex") or []):
        if not isinstance(it, dict):
            errs.append("opex[%d] must be an object" % i)
            continue
        w = "opex[%d]." % i
        start = num(it, "start_month", w, default=1, lo=Decimal(1), hi=Decimal(MONTHS))
        opex.append({"label": str(it.get("label") or "opex %d" % (i + 1)), "monthly": num(it, "monthly", w),
                     "start": int(start)})
    a["opex"] = opex

    once = []
    for i, it in enumerate(doc.get("one_off") or []):
        if not isinstance(it, dict):
            errs.append("one_off[%d] must be an object" % i)
            continue
        w = "one_off[%d]." % i
        mo = num(it, "month", w, lo=Decimal(1), hi=Decimal(MONTHS))
        once.append({"label": str(it.get("label") or "one-off %d" % (i + 1)), "month": int(mo),
                     "cost": num(it, "cost", w)})
    a["one_off"] = once

    uof = doc.get("use_of_funds") or {}
    if not isinstance(uof, dict):
        errs.append("use_of_funds must be an object of {what: amount}")
        uof = {}
    funds = []
    for k, v in uof.items():
        try:
            fv = D(v, "use_of_funds[%r]" % k)
            if fv <= 0:
                errs.append("use_of_funds[%r] must be above 0" % k)
            funds.append((str(k), fv))
        except ModelError as e:
            errs.append(str(e))
    a["funds"] = funds
    if errs:
        raise ModelError("the assumptions need fixing:\n  - " + "\n  - ".join(errs))
    return a


# ---------------------------------------------------------------- the model

def unit_economics(a):
    """Per order and per customer, exact (Decimal). The plan and the deck quote these."""
    rev = a["price"] * a["take"] / 100
    cost = sum((a["price"] * c["pct"] / 100 + c["fixed"] for c in a["costs"]), Decimal(0))
    contrib = rev - cost
    per_cust = contrib * a["opc"]
    churn = a["churn"] / 100
    ltv = per_cust / churn if churn > 0 else None
    ltv_cac = ltv / a["cac"] if (ltv is not None and a["cac"] > 0) else None
    payback = a["cac"] / per_cust if per_cust > 0 else None
    return {"unit": a["unit"], "price": fnum(a["price"]), "take_rate_pct": fnum(a["take"]),
            "revenue_per_order": fnum(rev), "cost_per_order": fnum(cost), "contribution_per_order": fnum(contrib),
            "orders_per_customer_month": fnum(a["opc"]), "contribution_per_customer_month": fnum(per_cust),
            "churn_monthly_pct": fnum(a["churn"]), "cac": fnum(a["cac"]),
            "ltv": fnum(cents(ltv)) if ltv is not None else None,
            "ltv_cac": fnum(ltv_cac.quantize(CENT, rounding=ROUND_HALF_UP)) if ltv_cac is not None else None,
            "cac_payback_months": fnum(payback.quantize(CENT, rounding=ROUND_HALF_UP)) if payback is not None else None}


def run_model(doc):
    """doc = the assumptions JSON. Returns the model.json document."""
    a = validate(doc)
    rows = []
    customers = half_up(a["starting"])
    cash = a["cash_at_start"]
    new_f = a["new1"]
    for m in range(1, MONTHS + 1):
        if m > 1:
            new_f = new_f * (1 + a["growth"][(m - 1) // 12] / 100)
        new = half_up(new_f)
        churned = half_up(Decimal(customers) * a["churn"] / 100)
        customers = customers - churned + new
        orders = half_up(Decimal(customers) * a["opc"])
        gmv = Decimal(orders) * a["price"]
        revenue = cents(gmv * a["take"] / 100)
        cor = cents(sum((Decimal(orders) * (a["price"] * c["pct"] / 100 + c["fixed"]) for c in a["costs"]),
                        Decimal(0)))
        gp = revenue - cor
        base_pay = sum((r["monthly"] * r["count"] for r in a["payroll"] if r["start"] <= m <= r["end"]), Decimal(0))
        payroll = cents(base_pay * (1 + a["overhead"] / 100))
        marketing = cents(Decimal(new) * a["cac"])
        other = cents(sum((o["monthly"] for o in a["opex"] if o["start"] <= m), Decimal(0))
                      + sum((o["cost"] for o in a["one_off"] if o["month"] == m), Decimal(0)))
        opex = payroll + marketing + other
        net = gp - opex
        cash = cash + net + (a["raise"] if m == a["raise_month"] else 0)
        date, _ = month_label(a["start"], m)
        rows.append({"month": m, "date": date, "new_customers": new, "churned": churned, "customers": customers,
                     "orders": orders, "gmv": gmv, "revenue": revenue, "cost_of_revenue": cor, "gross_profit": gp,
                     "payroll": payroll, "marketing": marketing, "other_opex": other, "opex": opex, "net": net,
                     "cash": cash})

    def year(key, y):
        return sum((r[key] for r in rows[(y - 1) * 12:y * 12]), Decimal(0))

    breakeven = None
    for i in range(MONTHS - 1, -1, -1):
        if rows[i]["net"] >= 0:
            breakeven = i + 1
        else:
            break
    worst = min(rows, key=lambda r: (r["net"], r["month"]))
    peak_burn = -worst["net"] if worst["net"] < 0 else Decimal(0)
    cash_out = next((r["month"] for r in rows if r["cash"] < 0), None)
    low = min(rows, key=lambda r: (r["cash"], r["month"]))
    funds_total = sum((v for _, v in a["funds"]), Decimal(0))
    summary = {"company": a["company"], "currency": a["currency"], "unit": a["unit"], "months": MONTHS,
               "start_month": rows[0]["date"], "end_month": rows[-1]["date"],
               "revenue_y1": fnum(year("revenue", 1)), "revenue_y2": fnum(year("revenue", 2)),
               "revenue_y3": fnum(year("revenue", 3)),
               "gmv_y1": fnum(year("gmv", 1)), "gmv_y2": fnum(year("gmv", 2)), "gmv_y3": fnum(year("gmv", 3)),
               "net_y1": fnum(year("net", 1)), "net_y2": fnum(year("net", 2)), "net_y3": fnum(year("net", 3)),
               "breakeven_month": breakeven,
               "breakeven_date": rows[breakeven - 1]["date"] if breakeven else None,
               "peak_burn": fnum(peak_burn), "peak_burn_month": worst["month"] if peak_burn > 0 else None,
               "runway_months": (cash_out - 1) if cash_out else MONTHS, "cash_out_month": cash_out,
               "cash_low": fnum(low["cash"]), "cash_low_month": low["month"], "cash_end": fnum(rows[-1]["cash"]),
               "customers_end": rows[-1]["customers"],
               "raise": fnum(a["raise"]), "raise_month": a["raise_month"],
               "use_of_funds": {k: fnum(v) for k, v in a["funds"]}, "use_of_funds_total": fnum(funds_total),
               "funds_match": bool(a["funds"]) and funds_total == a["raise"]}
    months = [{k: (fnum(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in rows]
    return {"created_by": "seed-model", "assumptions": clean(doc), "months": months, "summary": summary,
            "unit_economics": unit_economics(a), "note": NOTE}


def check_funds(doc):
    """(ok, lines). The use of funds must add up to the raise, to the cent."""
    a = validate(doc)
    lines = ["Use of funds for the %s raise" % money(a["raise"])]
    if not a["funds"]:
        return False, lines + ["  (none yet) Add use_of_funds to the assumptions: {\"what\": amount}, adding up to "
                               "the raise."]
    total = sum((v for _, v in a["funds"]), Decimal(0))
    width = max(len(k) for k, _ in a["funds"] + [("Total", 0)])
    for k, v in a["funds"]:
        pct = (v / a["raise"] * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP) if a["raise"] else Decimal(0)
        lines.append("  %-*s  %12s  %5s%%" % (width, k, money(v), pct))
    tpct = (total / a["raise"] * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP) if a["raise"] else Decimal(0)
    lines.append("  %-*s  %12s  %5s%%" % (width, "Total", money(total), tpct))
    if a["raise"] == 0:
        return False, lines + ["The raise is $0: set raise in the assumptions."]
    if total == a["raise"]:
        return True, lines + ["Adds up to the raise."]
    gap = a["raise"] - total
    if gap > 0:
        return False, lines + ["Short by %s: the use of funds adds up to %s, the raise is %s. Every dollar of the "
                               "raise needs a job." % (money(gap, 2 if gap % 1 else 0), money(total), money(a["raise"]))]
    return False, lines + ["Over by %s: the use of funds adds up to %s, more than the %s raise." % (
        money(-gap, 2 if gap % 1 else 0), money(total), money(a["raise"]))]


# ---------------------------------------------------------------- output

def describe(model, show_months=False):
    s, ue = model["summary"], model["unit_economics"]
    a = model["assumptions"]
    start = tuple(int(x) for x in s["start_month"].split("-"))
    unit, units = s["unit"], a.get("units") or s["unit"] + "s"

    def lab(m):
        return month_label(start, m)[1]

    out = ["%s: %d-month model, %s to %s (%s)" % (s["company"], s["months"], lab(1), lab(s["months"]), s["currency"])]
    yrs = [model["months"][i * 12:(i + 1) * 12] for i in range(3)]

    def row(name, vals):
        return "  %-18s" % name + "".join("%15s" % v for v in vals)

    out.append(row("", ["Year 1", "Year 2", "Year 3"]))
    out.append(row(units.capitalize(), ["{:,}".format(sum(r["orders"] for r in y)) for y in yrs]))
    for key, name in (("gmv", "GMV"), ("revenue", "Revenue"), ("gross_profit", "Gross profit"),
                      ("opex", "Opex"), ("net", "Net")):
        out.append(row(name, [money(sum(D(r[key]) for r in y)) for y in yrs]))
    out.append(row("Cash at year end", [money(y[-1]["cash"]) for y in yrs]))
    out.append(row("Customers (end)", ["{:,}".format(y[-1]["customers"]) for y in yrs]))
    out.append("")
    out.append("  Per %-14s price %s, you keep %s (%s%%), costs %s, contribution %s" % (
        unit, money(ue["price"], 2), money(ue["revenue_per_order"], 2), ue["take_rate_pct"],
        money(ue["cost_per_order"], 2), money(ue["contribution_per_order"], 2)))
    if ue["ltv_cac"] is not None:
        out.append("  %-18s LTV %s on a %s CAC: LTV:CAC %sx, CAC paid back in %s months" % (
            "Per customer", money(ue["ltv"], 2), money(ue["cac"], 2), ue["ltv_cac"], ue["cac_payback_months"]))
    if s["breakeven_month"]:
        out.append("  %-18s month %d (%s), and every month after it" % ("Breakeven", s["breakeven_month"],
                                                                      lab(s["breakeven_month"])))
    else:
        out.append("  %-18s not within %d months" % ("Breakeven", s["months"]))
    if s["peak_burn_month"]:
        out.append("  %-18s %s in month %d (%s)" % ("Peak burn", money(s["peak_burn"]), s["peak_burn_month"],
                                                   lab(s["peak_burn_month"])))
    else:
        out.append("  %-18s none: every month makes money" % "Peak burn")
    if s["cash_out_month"]:
        out.append("  %-18s %d months: the cash runs out in month %d (%s). Raise more or cut the plan." % (
            "Runway", s["runway_months"], s["cash_out_month"], lab(s["cash_out_month"])))
    else:
        out.append("  %-18s the cash lasts all %d months (low point %s in month %d)" % (
            "Runway", s["months"], money(s["cash_low"]), s["cash_low_month"]))
    if s["funds_match"]:
        out.append("  %-18s adds up to the %s raise" % ("Use of funds", money(s["raise"])))
    elif s["use_of_funds"]:
        out.append("  %-18s adds up to %s, not the %s raise: run model.py funds" % (
            "Use of funds", money(s["use_of_funds_total"]), money(s["raise"])))
    else:
        out.append("  %-18s not set yet: add use_of_funds, then run model.py funds" % "Use of funds")
    if show_months:
        out.append("")
        out.append("  %5s %8s %9s %9s %12s %11s %12s %11s %11s %13s" % (
            "month", "date", "customers", units[:9], "GMV", "revenue", "gross profit", "opex", "net", "cash"))
        for r in model["months"]:
            out.append("  %5d %8s %9s %9s %12s %11s %12s %11s %11s %13s" % (
                r["month"], r["date"], "{:,}".format(r["customers"]), "{:,}".format(r["orders"]), money(r["gmv"]),
                money(r["revenue"]), money(r["gross_profit"]), money(r["opex"]), money(r["net"]), money(r["cash"])))
    out.append(NOTE)
    return out


def write_json(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")


def to_csv(model):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(CSV_FIELDS)
    for r in model["months"]:
        w.writerow([format(cents(r[k]), "f") if k in CSV_MONEY else r[k] for k in CSV_FIELDS])
    return buf.getvalue()


# ---------------------------------------------------------------- commands

def assumptions_path(a):
    return a.assumptions or os.path.join(a.dir, "assumptions.json")


def cmd_init(a):
    dest = assumptions_path(a)
    if os.path.exists(dest) and not a.force:
        print("model.py: %s already exists. Edit it, or use --force to start again from the example." % dest,
              file=sys.stderr)
        return 1
    doc = read_json(EXAMPLE, "example assumptions")
    write_json(dest, doc)
    print("Wrote %s (the Leashly example: replace every number with yours)." % dest)
    print("Next: edit it with the founder, then model.py run --write.")
    return 0


def cmd_run(a):
    model = run_model(read_json(assumptions_path(a), "assumptions (run model.py init first)"))
    out = os.path.join(a.dir, "model.json")
    if a.write:
        write_json(out, model)
    if a.json:
        doc = model if a.months else {k: v for k, v in model.items() if k != "months"}
        print(json.dumps(doc, indent=2))
        return 0
    for line in describe(model, a.months):
        print(line)
    if a.write:
        print("Wrote %s." % out)
        print("Next: /seed-plan pulls these numbers into the business plan, then /seed-deck.")
    else:
        print("Nothing written. Add --write to save %s." % out)
    return 0


def cmd_funds(a):
    ok, lines = check_funds(read_json(assumptions_path(a), "assumptions (run model.py init first)"))
    if a.json:
        print(json.dumps({"ok": ok, "lines": lines}, indent=2))
    else:
        for line in lines:
            print(line)
    return 0 if ok else 1


def cmd_csv(a):
    src = os.path.join(a.dir, "model.json")
    model = read_json(src, "model (run model.py run --write first)")
    if not isinstance(model.get("months"), list) or len(model["months"]) != MONTHS:
        raise ModelError("%s has no 36 months: run model.py run --write again" % src)
    text = to_csv(model)
    ap = assumptions_path(a)
    stale = False
    if os.path.exists(ap):
        try:
            stale = clean(read_json(ap, "assumptions")) != model.get("assumptions")
        except ModelError:
            stale = False
    if a.out == "-":
        sys.stdout.write(text)
        return 0
    out = a.out or os.path.join(a.dir, "model.csv")
    d = os.path.dirname(out)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("Wrote %s (%d months, %d columns)." % (out, MONTHS, len(CSV_FIELDS)))
    if stale:
        print("Note: %s changed since %s was written. Run model.py run --write to refresh it." % (ap, src))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Financial Modeler (seed-model): the 36-month model behind the raise.")
    ap.add_argument("--dir", default="seed", help="the seed/ folder (default ./seed)")
    ap.add_argument("--assumptions", metavar="PATH", help="default <dir>/assumptions.json")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("init", help="copy the example assumptions into seed/assumptions.json")
    p.add_argument("--force", action="store_true", help="overwrite an existing assumptions.json")
    p = sub.add_parser("run", help="run the 36 months and print the summary")
    p.add_argument("--write", action="store_true", help="write <dir>/model.json")
    p.add_argument("--months", action="store_true", help="print every month too")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("funds", help="check the use of funds adds up to the raise")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("csv", help="export <dir>/model.json as a CSV")
    p.add_argument("--out", metavar="PATH", help="default <dir>/model.csv; - prints it")
    for name in ("init", "run", "funds", "csv"):
        sp = sub.choices[name]
        sp.add_argument("--dir", default=argparse.SUPPRESS)
        sp.add_argument("--assumptions", metavar="PATH", default=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return {"init": cmd_init, "run": cmd_run, "funds": cmd_funds, "csv": cmd_csv}[a.cmd](a)
    except ModelError as e:
        print("model.py: %s" % e, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
