#!/usr/bin/env python3
"""Pitch Deck Designer for seed-deck: turns the business plan into a 10-slide pitch deck.
Standard library only, no network. The deck is ONE self-contained HTML file: inline CSS, no
fonts or scripts from anywhere else, 16:9 slides, arrow keys to move, and a print stylesheet so
the browser's Print > Save as PDF gives one slide a page.

    python3 deck.py build                        # seed/plan.json -> seed/deck.html, then the lint
    python3 deck.py build --brand "#2F6FEB" --ink "#0E1B33" --accent "#FFB020"
    python3 deck.py outline                      # what every slide will say, with its word count
    python3 deck.py lint                         # the rules below: exit 0 clean, 1 something to fix
    python3 deck.py lint --json

The ten slides, in the order investors expect: title, problem, solution, market, competition,
business model, go-to-market, team, financials, the ask. The words come from plan.json's section
"pitch" lines and "points" (seed-plan); the numbers come from the "numbers" block that
plan.py build writes (market, competitors, unit economics, the model, the use of funds); the
colours from plan.json "brand" (or the flags).

The lint:
  - at most 35 words in a slide's body (the title, the footnote and the page number do not count)
  - one idea a slide: a lead of at most 2 sentences and at most 3 points
  - the ask: the use of funds adds up to the raise
  - every number on a slide is in plan.json's numbers, model.json, market.json, competitors.json
    or config.json (shown rounded is fine: $8.5B for 8,520,000,000). Years and counts of 10 or
    less are not checked.
  - no empty slide, no slide without its data, a plan.json older than model.json

Exit codes: build 0 written (lint problems are printed, not fatal). outline 0. lint 0 clean,
1 problems. 2 bad input (no plan.json, a plan that was never built, a bad colour).
"""

import argparse
import html
import json
import os
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

SECTIONS = [("executive_summary", "Executive summary"), ("problem", "Problem"), ("solution", "Solution"),
            ("market", "Market"), ("competition", "Competition"), ("business_model", "Business model"),
            ("go_to_market", "Go-to-market"), ("financial_plan", "Financial plan"), ("use_of_funds", "Use of funds")]
ORDER = ["title", "problem", "solution", "market", "competition", "business_model", "go_to_market", "team",
         "financials", "ask"]
DEFAULT_BRAND = {"brand": "#2F6FEB", "ink": "#0E1B33", "accent": "#FFB020"}
MAX_WORDS = 35
MAX_SENTENCES = 2
MAX_POINTS = 3
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NUM_RE = re.compile(r"(?<![\w.])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?"
                    r"(?:\s?(thousand|million|billion|bn|[KkMB])(?![A-Za-z]))?(\s?%|x(?![A-Za-z]))?(?![\w])")
DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?([T ].*)?$")
SCALE = {"k": 3, "thousand": 3, "m": 6, "million": 6, "b": 9, "bn": 9, "billion": 9}


class DeckError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- numbers

def D(x):
    if isinstance(x, bool) or x is None:
        raise DeckError("not a number: %r" % (x,))
    try:
        if isinstance(x, float):
            return Decimal(repr(x))
        return Decimal(str(x).strip().lstrip("$").replace(",", ""))
    except (InvalidOperation, ValueError):
        raise DeckError("not a number: %r" % (x,))


def rnd(x, dp):
    return D(x).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)


def trim(q):
    s = format(q, "f")
    return s.rstrip("0").rstrip(".") if "." in s else s


def money(x, dp=None):
    d = D(x)
    if dp is None:
        dp = 0 if d == d.to_integral_value() else 2
    q = rnd(d, dp)
    return "%s$%s" % ("-" if q < 0 else "", format(abs(q), ",f"))


def short_money(x):
    """$158B, $8.5B, $22.8M, $2.99M, $467K, $82.8K, $950 (the same rounding seed-plan uses)."""
    d = D(x)
    sign, a = ("-" if d < 0 else ""), abs(d)
    if a >= Decimal("1e9"):
        return "%s$%sB" % (sign, trim(rnd(a / Decimal("1e9"), 1)))
    if a >= Decimal("1e6"):
        return "%s$%sM" % (sign, trim(rnd(a / Decimal("1e6"), 1 if a >= Decimal("1e7") else 2)))
    if a >= Decimal("1e3"):
        return "%s$%sK" % (sign, trim(rnd(a / Decimal("1e3"), 0 if a >= Decimal("1e5") else 1)))
    return "%s$%s" % (sign, trim(rnd(a, 0)))


def pct(x, dp=1):
    return trim(rnd(x, dp)) + "%"


def count(x):
    return "{:,}".format(int(D(x)))


def month_name(ym):
    m = re.match(r"^(\d{4})-(\d{2})$", str(ym or ""))
    return "%s %s" % (MONTH_NAMES[int(m.group(2)) - 1], m.group(1)) if m else str(ym or "")


def tokens(text):
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
            return False
        if 1900 <= base <= 2100 and "," not in raw:
            return False
    return True


def known_values(*docs):
    vals = set()

    def walk(x):
        if isinstance(x, bool) or x is None:
            return
        if isinstance(x, (int, float)):
            vals.add(D(x))
        elif isinstance(x, str):
            if DATE_RE.match(x):
                return
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


# ---------------------------------------------------------------- colours

def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mix(a, b, t):
    """t of a, the rest b: mix('#2F6FEB', '#FFFFFF', 0.1) is a pale brand tint."""
    ra, rb = rgb(a), rgb(b)
    return "#%02X%02X%02X" % tuple(int(round(ra[i] * t + rb[i] * (1 - t))) for i in range(3))


def brand_of(plan, over):
    b = dict(DEFAULT_BRAND)
    for k, v in (plan.get("brand") or {}).items():
        if k in b and v:
            b[k] = v
    for k in b:
        if over.get(k):
            b[k] = over[k]
    for k, v in b.items():
        if not HEX.match(str(v)):
            raise DeckError("the %s colour wants #RRGGBB, like #2F6FEB (got %r)" % (k, v))
    return b


# ---------------------------------------------------------------- the slides

def section_map(plan):
    have = {s.get("key"): s for s in plan.get("sections") or [] if isinstance(s, dict)}
    out = {}
    for key, title in SECTIONS:
        s = have.get(key) or {}
        text = (s.get("text") or "").strip()
        pitch = (s.get("pitch") or "").strip()
        if not pitch and text:
            m = re.match(r"^(.+?[.!?])(\s|$)", text)
            pitch = m.group(1) if m else text
        out[key] = {"title": title, "pitch": pitch, "points": [str(p).strip() for p in s.get("points") or [] if p]}
    return out


def cap(text):
    return str(text)[:1].upper() + str(text)[1:]


def theme_word(theme):
    return str(theme or "").split("/")[0].strip() or "issues"


def build_slides(plan):
    """The ten slides as data. Every string a slide shows is in its blocks, so lint counts what
    the reader sees."""
    st = plan.get("startup") or {}
    fo = plan.get("founder") or {}
    n = plan.get("numbers") or {}
    sec = section_map(plan)
    name = st.get("name") or "Your startup"
    ue, fin, mk = n.get("unit_economics"), n.get("financials"), n.get("market")
    comps = [c for c in n.get("competitors") or [] if c.get("name")][:3]
    raise_amt = n.get("raise")
    stage = st.get("stage") or "seed"
    S = []

    meta = []
    if raise_amt:
        meta.append("Raising a %s %s" % (short_money(raise_amt), stage))
    if n.get("instrument"):
        meta.append(n["instrument"])
    who = " · ".join(x for x in (fo.get("name"), fo.get("email")) if x)
    S.append({"key": "title", "title": name, "blocks": [
        {"type": "tagline", "text": (plan.get("tagline") or "").strip() or st.get("one_liner") or ""},
        {"type": "meta", "text": " · ".join(meta)}], "foot": who})

    blocks = [{"type": "lead", "text": sec["problem"]["pitch"]}]
    stats = []
    for c in comps[:2]:
        if c.get("top_count") is not None and c.get("low_reviews"):
            low = n.get("low_stars") or 2
            stats.append({"value": "%s of %s" % (c["top_count"], c["low_reviews"]),
                          "label": "recent %s %s reviews mention %s" % ("1★" if low == 1 else "1-%s★" % low, c["name"],
                                                                       theme_word(c.get("top_theme")))})
    if stats:
        blocks.append({"type": "stats", "items": stats})
    elif sec["problem"]["points"]:
        blocks.append({"type": "points", "items": sec["problem"]["points"][:MAX_POINTS + 1]})
    foot = ""
    if stats:
        read = sorted(set(str(c.get("reviews_read")) for c in comps if c.get("reviews_read")))
        foot = "Source: App Store reviews%s%s (seed/competitors.json)." % (
            ", the %s most recent per app" % read[0] if len(read) == 1 else "",
            ", read %s" % n["competitors_generated"] if n.get("competitors_generated") else "")
    S.append({"key": "problem", "title": "The problem", "blocks": blocks, "foot": foot})

    blocks = [{"type": "lead", "text": sec["solution"]["pitch"]}]
    if sec["solution"]["points"]:
        blocks.append({"type": "points", "items": sec["solution"]["points"]})
    S.append({"key": "solution", "title": "The solution", "blocks": blocks, "foot": ""})

    blocks = [{"type": "lead", "text": sec["market"]["pitch"]}]
    foot = ""
    if mk and None not in (mk.get("tam"), mk.get("sam"), mk.get("som")):
        blocks.append({"type": "market", "items": [
            {"tag": "TAM", "value": short_money(mk["tam"]), "label": "the whole market"},
            {"tag": "SAM", "value": short_money(mk["sam"]), "label": "what we can serve"},
            {"tag": "SOM", "value": short_money(mk["som"]), "label": "what we can win"}]})
        srcs = []
        for it in mk.get("inputs") or []:
            s = str(it.get("source") or "")
            if s and not s.lower().startswith("assumption") and s not in srcs:
                srcs.append(s)
        foot = ("Sources: %s. " % "; ".join(srcs) if srcs else "") + "Method: %s (seed/market.json)." % (
            mk.get("method") or "see the plan")
    S.append({"key": "market", "title": "The market", "blocks": blocks, "foot": foot})

    blocks = [{"type": "lead", "text": sec["competition"]["pitch"]}]
    cards = []
    for c in comps:
        sub = []
        if c.get("rating") is not None:
            sub.append("%s★" % c["rating"])
        if c.get("ratings") is not None:
            sub.append("%s ratings" % count(c["ratings"]))
        cards.append({"name": c["name"], "sub": " · ".join(sub), "label": "Weak point",
                      "value": cap(c.get("weak_point") or theme_word(c.get("top_theme"))), "us": False})
    if cards:
        cards.append({"name": name, "sub": "", "label": "",
                      "value": sec["executive_summary"]["pitch"] or sec["solution"]["pitch"], "us": True})
        blocks.append({"type": "cards", "items": cards})
    S.append({"key": "competition", "title": "Competition", "blocks": blocks,
              "foot": "Ratings from the App Store (seed/competitors.json)." if comps else ""})

    blocks = [{"type": "lead", "text": sec["business_model"]["pitch"]}]
    if ue:
        u = ue.get("unit") or "order"
        tiles = [{"value": money(ue["price"]), "label": "a %s" % u},
                 {"value": money(ue["revenue_per_order"], 2), "label": "we keep (%s)" % pct(ue["take_rate_pct"])},
                 {"value": money(ue["contribution_per_order"], 2), "label": "contribution a %s" % u}]
        if ue.get("ltv_cac") is not None:
            tiles.append({"value": "%sx" % trim(rnd(ue["ltv_cac"], 2)), "label": "LTV:CAC"})
        if ue.get("cac_payback_months") is not None:
            tiles.append({"value": "%s mo" % trim(rnd(ue["cac_payback_months"], 2)), "label": "CAC payback"})
        blocks.append({"type": "tiles", "items": tiles})
    S.append({"key": "business_model", "title": "Business model", "blocks": blocks,
              "foot": "Unit economics from seed/model.json assumptions." if ue else ""})

    blocks = [{"type": "lead", "text": sec["go_to_market"]["pitch"]}]
    if sec["go_to_market"]["points"]:
        blocks.append({"type": "steps", "items": sec["go_to_market"]["points"]})
    S.append({"key": "go_to_market", "title": "Go to market", "blocks": blocks, "foot": ""})

    team = [t for t in plan.get("team") or [] if isinstance(t, dict) and t.get("name")][:4]
    S.append({"key": "team", "title": "Team", "blocks": [{"type": "team", "items": [
        {"name": t["name"], "role": t.get("role") or "", "line": t.get("line") or ""} for t in team]}] if team else [],
        "foot": ""})

    blocks = [{"type": "lead", "text": sec["financial_plan"]["pitch"]}]
    foot = ""
    if fin and fin.get("revenue_y1") is not None:
        blocks.append({"type": "bars", "items": [
            {"label": "Year %d" % y, "value": D(fin["revenue_y%d" % y]), "text": short_money(fin["revenue_y%d" % y])}
            for y in (1, 2, 3)], "caption": "Revenue"})
        side = []
        if fin.get("breakeven_month"):
            side.append({"value": "Month %d" % fin["breakeven_month"],
                         "label": "breakeven (%s)" % month_name(fin.get("breakeven_date"))})
        if fin.get("peak_burn"):
            side.append({"value": short_money(fin["peak_burn"]), "label": "peak monthly burn"})
        if fin.get("cash_out_month"):
            side.append({"value": "%d months" % fin["runway_months"], "label": "of runway"})
        blocks.append({"type": "side", "items": side})
        foot = "From seed/model.json, %s to %s. Projections from our own assumptions, not a forecast." % (
            month_name(fin.get("start_month")), month_name(fin.get("end_month")))
    S.append({"key": "financials", "title": "Financials", "blocks": blocks, "foot": foot})

    blocks = [{"type": "lead", "text": sec["use_of_funds"]["pitch"]}]
    funds = n.get("use_of_funds") or {}
    shares = n.get("use_of_funds_pct") or {}
    said = raise_amt and short_money(raise_amt) in sec["use_of_funds"]["pitch"]
    meta = " · ".join(x for x in ("" if (said or not raise_amt) else "%s %s" % (short_money(raise_amt), stage),
                                  (n.get("instrument") or "")) if x)
    if meta:
        blocks.append({"type": "meta", "text": meta[:1].upper() + meta[1:]})
    if funds:
        blocks.append({"type": "funds", "items": [
            {"label": k, "value": D(v), "text": "%s · %s" % (short_money(v), pct(shares[k]) if k in shares else "")}
            for k, v in funds.items()]})
    S.append({"key": "ask", "title": "The ask", "blocks": blocks, "foot": ""})
    for i, s in enumerate(S, start=1):
        s["n"] = i
    return S


def block_texts(b):
    t = b["type"]
    if t in ("lead", "tagline", "meta"):
        return [b["text"]] if b.get("text") else []
    if t in ("points", "steps"):
        return list(b["items"])
    if t in ("stats", "tiles", "side"):
        return [x for it in b["items"] for x in (it["value"], it["label"])]
    if t == "market":
        return [x for it in b["items"] for x in (it["tag"], it["value"], it["label"])]
    if t == "cards":
        return [x for it in b["items"] for x in (it["name"], it["sub"], it["label"], it["value"]) if x]
    if t == "team":
        return [x for it in b["items"] for x in (it["name"], it["role"], it["line"]) if x]
    if t in ("bars", "funds"):
        return ([b["caption"]] if b.get("caption") else []) + [x for it in b["items"] for x in (it["label"], it["text"])]
    return []


def body_texts(slide):
    return [x for b in slide["blocks"] for x in block_texts(b) if x]


def words(texts):
    return sum(1 for t in texts for w in str(t).split() if re.search(r"[A-Za-z0-9]", w))


def sentences(text):
    return len([s for s in re.split(r"(?<=[.!?])\s+", str(text).strip()) if re.search(r"[A-Za-z0-9]", s)])


# ---------------------------------------------------------------- lint

def lint(plan, slides, files):
    """Problems, one string each. files = the other skills' docs that exist in seed/."""
    issues = []
    n = plan.get("numbers") or {}
    known = known_values(n, plan.get("startup") or {}, *[d for d in files.values() if d is not None])
    if [s["key"] for s in slides] != ORDER:
        issues.append("The slides are not in the standard order.")
    for s in slides:
        where = "Slide %d (%s)" % (s["n"], s["title"])
        texts = body_texts(s)
        if not texts:
            issues.append("%s is empty: write its section in seed/plan.json, then plan.py build." % where)
            continue
        w = words(texts)
        if w > MAX_WORDS:
            issues.append("%s has %d words; keep it to %d or fewer." % (where, w, MAX_WORDS))
        for b in s["blocks"]:
            if b["type"] == "lead" and not b["text"]:
                issues.append("%s has no line: write the pitch for it in seed/plan.json." % where)
            if b["type"] == "lead" and sentences(b["text"]) > MAX_SENTENCES:
                issues.append("%s says %d things in its lead: one idea a slide, %d sentences at most." % (
                    where, sentences(b["text"]), MAX_SENTENCES))
            if b["type"] in ("points", "steps") and len(b["items"]) > MAX_POINTS:
                issues.append("%s has %d points: one idea a slide, %d points at most." % (
                    where, len(b["items"]), MAX_POINTS))
        bad = []
        for t in texts + ([s["foot"]] if s.get("foot") else []):
            for tok in tokens(t):
                if worth_checking(tok) and not matches(tok, known) and tok[0] not in bad:
                    bad.append(tok[0])
        if bad:
            issues.append("%s shows %s, in none of plan.json, model.json, market.json, competitors.json or "
                          "config.json." % (where, ", ".join(bad)))
    types = {s["key"]: [b["type"] for b in s["blocks"]] for s in slides}
    for key, need, fix in (("market", "market", "run /seed-market"), ("competition", "cards", "run /seed-scout"),
                           ("business_model", "tiles", "run /seed-model"), ("financials", "bars", "run /seed-model"),
                           ("ask", "funds", "run /seed-model"), ("team", "team", "add the team to seed/plan.json")):
        if need not in types[key]:
            issues.append("The %s slide has no %s: %s, then plan.py build." % (
                key.replace("_", " "), "data" if need != "team" else "people", fix))
    funds = n.get("use_of_funds") or {}
    if funds and n.get("raise"):
        total = sum((D(v) for v in funds.values()), Decimal(0))
        if total != D(n["raise"]):
            issues.append("The ask: the use of funds adds up to %s, not the %s raise." % (money(total), money(n["raise"])))
    elif not n.get("raise"):
        issues.append("The ask has no raise: set startup.raise in seed/config.json, then plan.py build.")
    model = files.get("model.json")
    fin = n.get("financials") or {}
    if model and fin:
        s = model.get("summary") or {}
        if any(s.get(k) is not None and fin.get(k) is not None and D(s[k]) != D(fin[k])
               for k in ("revenue_y1", "revenue_y2", "revenue_y3", "breakeven_month", "peak_burn")):
            issues.append("plan.json is older than model.json: run plan.py build again, then build the deck.")
    return issues


# ---------------------------------------------------------------- HTML

def esc(x):
    return html.escape(str(x), quote=True)


CSS = """
:root{--brand:%(brand)s;--ink:%(ink)s;--accent:%(accent)s;--soft:%(soft)s;--soft2:%(soft2)s;--line:%(line)s;
--muted:%(muted)s;--paper:#FFFFFF;--on-brand:%(on_brand)s;--fit:1}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:%(stage)s;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,
"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.deck{display:flex;flex-direction:column;align-items:center;gap:32px;padding:32px 0}
.slide{width:1280px;height:720px;flex:none;position:relative;display:flex;flex-direction:column;background:var(--paper);
padding:64px 88px 72px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.28)}
.slide h2{margin:0 0 28px;font-size:46px;line-height:1.08;letter-spacing:-.02em;font-weight:750}
.slide h2::after{content:"";display:block;width:56px;height:6px;border-radius:3px;background:var(--accent);margin-top:18px}
.brandbar{position:absolute;top:30px;right:88px;display:flex;align-items:center;gap:10px;font-size:17px;font-weight:650;
color:var(--muted)}
.mark{width:30px;height:30px;border-radius:9px;background:var(--brand);color:#fff;display:grid;place-items:center;
font-weight:800;font-size:17px;line-height:1}
.num{position:absolute;right:88px;bottom:30px;font-size:16px;color:var(--muted);font-variant-numeric:tabular-nums}
.foot{position:absolute;left:88px;right:180px;bottom:28px;font-size:14px;line-height:1.35;color:var(--muted)}
.body{flex:1;display:flex;flex-direction:column;gap:30px;min-height:0;padding-bottom:64px}
.body>*:last-child:not(:first-child),.s-team .body>*{margin-top:auto;margin-bottom:auto}
.lead{font-size:38px;line-height:1.2;font-weight:600;letter-spacing:-.01em;margin:0;max-width:1040px}
.meta{font-size:22px;color:var(--muted);margin:0;font-weight:600}
.points{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.points li{background:var(--soft);border-radius:18px;padding:28px 26px;font-size:26px;line-height:1.25;font-weight:600;
display:flex;gap:14px;align-items:flex-start}
.points svg{flex:none;margin-top:3px}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:28px}
.stat{border:2px solid var(--line);border-radius:22px;padding:30px 32px}
.stat b{display:block;font-size:72px;line-height:1;letter-spacing:-.03em;color:var(--brand);font-variant-numeric:tabular-nums}
.stat span{display:block;margin-top:14px;font-size:24px;line-height:1.3;color:var(--ink)}
.market{display:flex;align-items:center;gap:64px}
.market svg{flex:none}
.legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:22px}
.legend li{display:flex;align-items:baseline;gap:18px;font-size:24px}
.legend .tag{width:74px;font-weight:800;color:var(--muted);font-size:20px;letter-spacing:.06em}
.legend b{font-size:46px;letter-spacing:-.02em;min-width:190px;font-variant-numeric:tabular-nums}
.cards{display:grid;gap:22px}
.card{border:2px solid var(--line);border-radius:20px;padding:26px 26px 28px;display:flex;flex-direction:column;gap:10px}
.card h3{margin:0;font-size:30px;letter-spacing:-.01em}
.card .sub{font-size:20px;color:var(--muted)}
.card .lab{margin-top:18px;font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700}
.card .val{font-size:26px;font-weight:650;line-height:1.25}
.card.us{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
.card.us .val{font-size:24px;margin-top:auto}
.tiles{display:grid;gap:18px}
.tile{background:var(--soft);border-radius:20px;padding:28px 22px}
.tile b{display:block;font-size:50px;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}
.tile b small{font-size:26px;letter-spacing:0;margin-left:4px;font-weight:700}
.tiles.five .tile b{font-size:44px}
.tile span{display:block;margin-top:12px;font-size:21px;color:var(--muted)}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:22px;counter-reset:s}
.steps li{position:relative;padding:74px 26px 28px;border:2px solid var(--line);border-radius:20px;font-size:26px;
line-height:1.25;font-weight:600}
.steps li::before{counter-increment:s;content:counter(s);position:absolute;top:24px;left:26px;width:38px;height:38px;
border-radius:50%%;background:var(--accent);color:var(--ink);display:grid;place-items:center;font-size:20px;font-weight:800}
.team{display:grid;gap:26px}
.person{display:flex;gap:22px;align-items:flex-start;background:var(--soft);border-radius:22px;padding:30px}
.face{flex:none;width:84px;height:84px;border-radius:50%%;background:var(--brand);color:#fff;display:grid;place-items:center;
font-size:30px;font-weight:800}
.person h3{margin:4px 0 4px;font-size:30px}
.person .role{font-size:20px;color:var(--muted);font-weight:650}
.person p{margin:12px 0 0;font-size:23px;line-height:1.3}
.fin{display:flex;gap:56px;align-items:flex-end;flex:1;min-height:0}
.side{display:flex;flex-direction:column;gap:20px;flex:1}
.side div{border-left:6px solid var(--accent);padding:6px 0 6px 22px}
.side b{display:block;font-size:46px;letter-spacing:-.02em;line-height:1.05}
.side span{display:block;font-size:21px;color:var(--muted);margin-top:6px}
.funds{display:flex;flex-direction:column;gap:18px;max-width:1100px}
.fund{display:grid;grid-template-columns:360px 1fr 200px;align-items:center;gap:22px;font-size:24px}
.fund .track{height:26px;border-radius:13px;background:var(--soft2);overflow:hidden}
.fund .fill{height:100%%;border-radius:13px;background:var(--brand)}
.fund .amt{font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.s-title{background:var(--brand);color:var(--on-brand);justify-content:center}
.s-title .body{justify-content:center;gap:26px}
.s-title h1{margin:0;font-size:120px;line-height:1;letter-spacing:-.04em;font-weight:800;display:flex;align-items:center;gap:30px}
.s-title .bigmark{width:112px;height:112px;border-radius:30px;background:var(--on-brand);color:var(--brand);display:grid;
place-items:center;font-size:66px;font-weight:800}
.s-title .tagline{font-size:46px;line-height:1.15;font-weight:600;margin:0;max-width:1000px}
.s-title .meta{color:var(--on-brand);opacity:.85;font-size:26px;display:inline-flex;align-items:center;gap:14px}
.s-title .meta::before{content:"";width:40px;height:6px;border-radius:3px;background:var(--accent)}
.s-title .foot,.s-title .num{color:var(--on-brand);opacity:.8}
.hud{display:none}
html.js body{overflow:hidden;height:100vh}
html.js .deck{position:fixed;inset:0;display:block;padding:0}
html.js .slide{position:absolute;left:50%%;top:50%%;transform:translate(-50%%,-50%%) scale(var(--fit));display:none}
html.js .slide.on{display:flex}
html.js .hud{display:block;position:fixed;left:16px;bottom:12px;font-size:13px;color:rgba(255,255,255,.7);
background:rgba(0,0,0,.45);padding:4px 10px;border-radius:6px;opacity:0;transition:opacity .4s;pointer-events:none}
html.js .hud.show{opacity:1}
@page{size:13.333in 7.5in;margin:0}
@media print{
html,body,html.js body{background:#fff;height:auto;overflow:visible}
html.js .deck,.deck{position:static;display:block;padding:0}
.slide,html.js .slide{display:flex!important;position:relative;left:auto;top:auto;transform:none;box-shadow:none;margin:0;
break-after:page;page-break-after:always}
.hud,html.js .hud{display:none}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
"""

JS = """
(function(){
var d=document,root=d.documentElement,slides=[].slice.call(d.querySelectorAll('.slide')),i=0,t=0,hud=d.getElementById('hud');
root.className+=' js';
function fit(){root.style.setProperty('--fit',Math.min(window.innerWidth/1280,window.innerHeight/720));}
function show(n){i=Math.max(0,Math.min(slides.length-1,n));
for(var k=0;k<slides.length;k++){slides[k].className=slides[k].className.replace(/ on\\b/g,'')+(k===i?' on':'');
slides[k].setAttribute('aria-hidden',k===i?'false':'true');}
hud.textContent=(i+1)+' / '+slides.length+'  \u00b7  arrows to move, P to print';
hud.className='hud show';clearTimeout(t);t=setTimeout(function(){hud.className='hud';},1800);
if(history.replaceState){history.replaceState(null,'','#'+(i+1));}}
d.addEventListener('keydown',function(e){var k=e.key;
if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '||k==='Enter'){show(i+1);e.preventDefault();}
else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'||k==='Backspace'){show(i-1);e.preventDefault();}
else if(k==='Home'){show(0);}else if(k==='End'){show(slides.length-1);}
else if((k==='p'||k==='P')&&!e.metaKey&&!e.ctrlKey){window.print();}});
d.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('a')){return;}
show(e.clientX>window.innerWidth/2?i+1:i-1);});
window.addEventListener('resize',fit);
fit();var h=parseInt((location.hash||'').slice(1),10);show(h>0?h-1:0);
})();
"""

CHECK = ('<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="13" '
         'fill="var(--brand)"/><path d="M7.5 13.5l3.6 3.6 7.4-7.6" fill="none" stroke="#fff" stroke-width="2.6" '
         'stroke-linecap="round" stroke-linejoin="round"/></svg>')


def initials(name):
    parts = [p for p in re.split(r"\s+", str(name).strip()) if p]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


def market_svg(items):
    radii = (180, 122, 64)
    fills = ("var(--soft)", "var(--soft2)", "var(--brand)")
    parts = ['<svg width="380" height="380" viewBox="0 0 380 380" role="img" aria-label="TAM, SAM and SOM, not to scale">']
    for r, f, it in zip(radii, fills, items):
        cy = 370 - r
        parts.append('<circle cx="190" cy="%d" r="%d" fill="%s"/>' % (cy, r, f))
        ty = cy - r + (34 if r > 100 else 0)
        if r > 100:
            parts.append('<text x="190" y="%d" text-anchor="middle" font-size="19" font-weight="800" fill="var(--ink)" '
                         'letter-spacing="1.5">%s</text>' % (ty, esc(it["tag"])))
        else:
            parts.append('<text x="190" y="%d" text-anchor="middle" font-size="19" font-weight="800" fill="#fff" '
                         'letter-spacing="1.5" dominant-baseline="middle">%s</text>' % (cy, esc(it["tag"])))
    parts.append("</svg>")
    return "".join(parts)


def bars_svg(items, caption):
    w, h, top, bottom = 560, 380, 54, 44
    peak = max([it["value"] for it in items] + [Decimal(1)])
    bw, gap = 120, 60
    x0 = (w - (len(items) * bw + (len(items) - 1) * gap)) // 2
    parts = ['<svg width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s by year">' % (
        w, h, w, h, esc(caption))]
    base = h - bottom
    parts.append('<line x1="0" y1="%d" x2="%d" y2="%d" stroke="var(--line)" stroke-width="2"/>' % (base, w, base))
    for i, it in enumerate(items):
        v = max(it["value"], Decimal(0))
        bh = int((v / peak) * (base - top)) if peak else 0
        x = x0 + i * (bw + gap)
        fill = "var(--brand)" if i == len(items) - 1 else "var(--soft2)"
        parts.append('<rect x="%d" y="%d" width="%d" height="%d" rx="12" fill="%s"/>' % (x, base - bh, bw, max(bh, 2), fill))
        parts.append('<text x="%d" y="%d" text-anchor="middle" font-size="26" font-weight="750" fill="var(--ink)">%s</text>'
                     % (x + bw // 2, base - bh - 14, esc(it["text"])))
        parts.append('<text x="%d" y="%d" text-anchor="middle" font-size="20" fill="var(--muted)">%s</text>'
                     % (x + bw // 2, base + 30, esc(it["label"])))
    parts.append('<text x="0" y="22" font-size="18" font-weight="800" fill="var(--muted)" letter-spacing="1.5">%s</text>'
                 % esc(caption.upper()))
    parts.append("</svg>")
    return "".join(parts)


def render_block(b):
    t = b["type"]
    if t == "lead":
        return '<p class="lead">%s</p>' % esc(b["text"] or "(not written yet)")
    if t == "tagline":
        return '<p class="tagline">%s</p>' % esc(b["text"])
    if t == "meta":
        return '<p class="meta">%s</p>' % esc(b["text"]) if b["text"] else ""
    if t == "points":
        return '<ul class="points">%s</ul>' % "".join("<li>%s<span>%s</span></li>" % (CHECK, esc(p)) for p in b["items"])
    if t == "steps":
        return '<ol class="steps">%s</ol>' % "".join("<li>%s</li>" % esc(p) for p in b["items"])
    if t == "stats":
        return '<div class="stats">%s</div>' % "".join(
            '<div class="stat"><b>%s</b><span>%s</span></div>' % (esc(it["value"]), esc(it["label"])) for it in b["items"])
    if t == "market":
        legend = "".join('<li><span class="tag">%s</span><b>%s</b><span>%s</span></li>' % (
            esc(it["tag"]), esc(it["value"]), esc(it["label"])) for it in b["items"])
        return '<div class="market">%s<ul class="legend">%s</ul></div>' % (market_svg(b["items"]), legend)
    if t == "cards":
        cols = len(b["items"])
        out = []
        for it in b["items"]:
            out.append('<div class="card%s"><h3>%s</h3>%s%s<div class="val">%s</div></div>' % (
                " us" if it["us"] else "", esc(it["name"]),
                '<div class="sub">%s</div>' % esc(it["sub"]) if it["sub"] else "",
                '<div class="lab">%s</div>' % esc(it["label"]) if it["label"] else "", esc(it["value"])))
        return '<div class="cards" style="grid-template-columns:repeat(%d,1fr)">%s</div>' % (cols, "".join(out))
    if t == "tiles":
        def big(v):
            head, _, tail = str(v).partition(" ")
            return esc(head) + (" <small>%s</small>" % esc(tail) if tail else "")
        return '<div class="tiles%s" style="grid-template-columns:repeat(%d,1fr)">%s</div>' % (
            " five" if len(b["items"]) >= 5 else "", len(b["items"]), "".join(
                '<div class="tile"><b>%s</b><span>%s</span></div>' % (big(it["value"]), esc(it["label"]))
                for it in b["items"]))
    if t == "team":
        cols = min(max(len(b["items"]), 1), 2)
        return '<div class="team" style="grid-template-columns:repeat(%d,1fr)">%s</div>' % (cols, "".join(
            '<div class="person"><div class="face">%s</div><div><h3>%s</h3><div class="role">%s</div>%s</div></div>' % (
                esc(initials(it["name"])), esc(it["name"]), esc(it["role"]),
                "<p>%s</p>" % esc(it["line"]) if it["line"] else "") for it in b["items"]))
    if t == "bars":
        return bars_svg(b["items"], b.get("caption") or "")
    if t == "side":
        return '<div class="side">%s</div>' % "".join(
            '<div><b>%s</b><span>%s</span></div>' % (esc(it["value"]), esc(it["label"])) for it in b["items"])
    if t == "funds":
        peak = max([it["value"] for it in b["items"]] + [Decimal(1)])
        return '<div class="funds">%s</div>' % "".join(
            '<div class="fund"><span>%s</span><div class="track"><div class="fill" style="width:%s%%"></div></div>'
            '<span class="amt">%s</span></div>' % (esc(it["label"]), trim(rnd(it["value"] / peak * 100, 1)), esc(it["text"]))
            for it in b["items"])
    return ""


def render_slide(s, name):
    blocks = s["blocks"]
    if s["key"] == "title":
        inner = '<h1><span class="bigmark">%s</span>%s</h1>' % (esc(initials(name)[:1]), esc(s["title"]))
        inner += "".join(render_block(b) for b in blocks)
        head = ""
    else:
        head = '<div class="brandbar"><span class="mark">%s</span>%s</div><h2>%s</h2>' % (
            esc(initials(name)[:1]), esc(name), esc(s["title"]))
        if s["key"] == "financials" and any(b["type"] == "bars" for b in blocks):
            lead = "".join(render_block(b) for b in blocks if b["type"] == "lead")
            rest = "".join(render_block(b) for b in blocks if b["type"] != "lead")
            inner = lead + '<div class="fin">%s</div>' % rest
        else:
            inner = "".join(render_block(b) for b in blocks)
    foot = '<div class="foot">%s</div>' % esc(s["foot"]) if s.get("foot") else ""
    return ('<section class="slide s-%s" id="s%d" aria-label="Slide %d: %s">%s<div class="body">%s</div>%s'
            '<div class="num">%d / %d</div></section>' % (
                s["key"].replace("_", "-"), s["n"], s["n"], esc(s["title"]), head, inner, foot, s["n"], len(ORDER)))


def render(plan, slides, brand):
    name = (plan.get("startup") or {}).get("name") or "Your startup"
    ink, white = brand["ink"], "#FFFFFF"
    css = CSS % {"brand": brand["brand"], "ink": ink, "accent": brand["accent"],
                 "soft": mix(brand["brand"], white, 0.08), "soft2": mix(brand["brand"], white, 0.22),
                 "line": mix(ink, white, 0.12), "muted": mix(ink, white, 0.62), "on_brand": white,
                 "stage": mix(ink, "#000000", 0.85)}
    body = "\n".join(render_slide(s, name) for s in slides)
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<title>%s: pitch deck</title>\n<style>%s</style>\n</head>\n<body>\n<main class="deck">\n%s\n</main>\n'
            '<div class="hud" id="hud" aria-live="polite"></div>\n<script>%s</script>\n</body>\n</html>\n'
            % (esc(name), css, body, JS))


# ---------------------------------------------------------------- commands

def read_json(path, what, required=True):
    if not os.path.exists(path):
        if required:
            raise DeckError("no %s at %s" % (what, path))
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise DeckError("%s is not valid JSON: %s" % (path, e))


def load(a):
    plan_path = a.plan or os.path.join(a.dir, "plan.json")
    plan = read_json(plan_path, "plan (run /seed-plan first: plan.py init, then plan.py build)")
    if not plan.get("built") or not plan.get("numbers"):
        raise DeckError("%s has no numbers yet: run plan.py build first" % plan_path)
    files = {}
    for f in ("model.json", "market.json", "competitors.json", "config.json"):
        files[f] = read_json(os.path.join(a.dir, f), f, required=False)
    return plan, files


def cmd_build(a):
    plan, files = load(a)
    brand = brand_of(plan, {"brand": a.brand, "ink": a.ink, "accent": a.accent})
    slides = build_slides(plan)
    text = render(plan, slides, brand)
    out = a.out or os.path.join(a.dir, "deck.html")
    d = os.path.dirname(out)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(text)
    issues = lint(plan, slides, files)
    print("Wrote %s: %d slides, %s KB, one self-contained file." % (out, len(slides), (len(text.encode("utf-8")) + 1023) // 1024))
    print("Open it in a browser: the arrow keys move, P prints. Print > Save as PDF gives one slide a page.")
    if issues:
        print("The lint found %d thing%s to fix:" % (len(issues), "" if len(issues) == 1 else "s"))
        for x in issues:
            print("  - %s" % x)
    else:
        print("Lint: clean (35 words or fewer a slide, one idea a slide, the numbers trace to your files).")
    print("Next: /seed-coach drills the questions this deck invites; /seed-closer attaches it to the outreach.")
    return 0


def cmd_outline(a):
    plan, files = load(a)
    slides = build_slides(plan)
    if a.json:
        print(json.dumps([{"n": s["n"], "key": s["key"], "title": s["title"], "body": body_texts(s),
                           "words": words(body_texts(s)), "foot": s["foot"]} for s in slides], indent=2))
        return 0
    name = (plan.get("startup") or {}).get("name") or "Your startup"
    print("%s: pitch deck outline (%d slides)" % (name, len(slides)))
    for s in slides:
        t = body_texts(s)
        print("%2d. %-16s %2d words  %s" % (s["n"], s["title"], words(t), " | ".join(t) or "(empty)"))
    return 0


def cmd_lint(a):
    plan, files = load(a)
    slides = build_slides(plan)
    issues = lint(plan, slides, files)
    if a.json:
        print(json.dumps({"ok": not issues, "issues": issues,
                          "words": {s["key"]: words(body_texts(s)) for s in slides}}, indent=2))
    elif issues:
        for x in issues:
            print("  - %s" % x)
    else:
        print("Lint: clean. %d slides, the most words on one is %d." % (
            len(slides), max(words(body_texts(s)) for s in slides)))
    return 0 if not issues else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="Pitch Deck Designer (seed-deck): the plan, as a 10-slide deck.")
    ap.add_argument("--dir", default="seed", help="the seed/ folder (default ./seed)")
    ap.add_argument("--plan", metavar="PATH", help="default <dir>/plan.json")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("build", help="write seed/deck.html")
    p.add_argument("--out", metavar="PATH", help="default <dir>/deck.html")
    p.add_argument("--brand", help="#RRGGBB (default plan.json brand.brand)")
    p.add_argument("--ink", help="#RRGGBB (default plan.json brand.ink)")
    p.add_argument("--accent", help="#RRGGBB (default plan.json brand.accent)")
    p = sub.add_parser("outline", help="print what each slide says")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("lint", help="check the deck against the rules")
    p.add_argument("--json", action="store_true")
    for name in ("build", "outline", "lint"):
        sub.choices[name].add_argument("--dir", default=argparse.SUPPRESS)
        sub.choices[name].add_argument("--plan", metavar="PATH", default=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return {"build": cmd_build, "outline": cmd_outline, "lint": cmd_lint}[a.cmd](a)
    except DeckError as e:
        print("deck.py: %s" % e, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
