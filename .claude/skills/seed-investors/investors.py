#!/usr/bin/env python3
"""Investor Finder for seed-investors: researches the investors who back ideas
like yours, from public sources, and ranks them by fit with the reasons and
the links. Standard library only.

    python3 investors.py formd --q "pet care" --since 2025-01-01          # who in your space raised, how much, when
    python3 investors.py import investors.csv                              # rows Claude built from public research
    python3 investors.py add --name "Maya Chen" --firm "Northlight Ventures" --stage seed \\
        --check 250K-1M --sectors "pet care; consumer marketplaces" --geo US \\
        --last-deal "led a pet-care seed round" --last-deal-date 2026-04-13 --source URL
    python3 investors.py rank --write                                      # fit 0-100, with the reasons
    python3 investors.py show                                              # the ranked list
    python3 investors.py show maya-chen                                    # one investor, every field

Fit, 0 to 100 (each part has its reason in the output):
  stage      25  they invest at your stage (12 if one stage off: pre-seed, seed, series a, series b, growth)
  sectors    25  two or more of your sectors match theirs (15 for one)
  check      20  their check range overlaps the check you want (10 if within a factor of 2;
                 0 if their smallest check is bigger than your whole round)
  recency    15  a relevant deal: 15 x (1 - days ago / 730), rounded half up; 0 after two years
  geography  10  they invest where you are (or say global)
  warm intro  5  someone can introduce you
The check you want defaults to 5% to 50% of the ask (--check to change it). Your stage, sectors,
geography and ask come from the flags, else seed/investors.json, else seed/config.json.

Rules: every investor needs at least one public source URL (a firm's own site, a public profile
found through search, an SEC filing, the press); rows without one are refused and never ranked.
Phone numbers and home addresses are never collected: such columns are dropped and a row with a
phone number in it is refused. Never log in anywhere; never scrape LinkedIn.

SEC EDGAR (formd): full-text search for Form D, https://efts.sec.gov/LATEST/search-index, then each
filing's primary_doc.xml for the amounts. Form D has no business description, so the words match
company names and the filing's own text. SEC wants a User-Agent with your name and email:
sec_user_agent in seed/config.json or SEC_USER_AGENT (or --ua). Without one it refuses. A pause
between requests keeps far under SEC's 10 a second. --offline DIR reads efts-<from>.json and
<adsh>.xml instead.

Writes: import and add write seed/investors.json (that is their job); rank writes only with
--write; formd writes seed/formd.json only with --write. --dir changes seed/.
Exit codes: 0 done, 1 refused or nothing found, 2 bad input or a network error.
"""

import argparse
import csv
import datetime
import gzip
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

EFTS = "https://efts.sec.gov/LATEST/search-index?%s"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/%d/%s/%s"
PAGE = 100            # efts returns 100 hits a page
PAUSE = 0.2           # SEC allows 10 requests a second; stay far under it
TIMEOUT = 30
STAGES = ["pre-seed", "seed", "series a", "series b", "growth"]
WEIGHTS = {"stage": 25, "sectors": 25, "check": 20, "recency": 15, "geo": 10, "warm": 5}
RECENCY_DAYS = 730
FREEMAIL = ("gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
            "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com")
PRIVATE_COLUMNS = ("phone", "mobile", "cell", "telephone", "tel", "whatsapp", "address", "home_address",
                   "street", "home", "zip", "postcode")
FIELDS = ("name", "firm", "role", "email", "stage", "check", "check_min", "check_max", "sectors", "geo",
          "last_deal", "last_deal_date", "sources", "source", "warm_intro", "personal_line", "notes")
PHONE = re.compile(r"(?<![\d$])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}(?!\d)")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URL = re.compile(r"^https?://[^\s/]+\.[^\s]+$")
ALIASES = {"email_address": "email", "e-mail": "email", "e_mail": "email", "mail": "email", "url": "sources",
           "urls": "sources", "link": "sources", "links": "sources", "source_url": "sources", "check_size": "check",
           "checks": "check", "sector": "sectors", "focus": "sectors", "stages": "stage", "geography": "geo",
           "location": "geo", "region": "geo", "warm": "warm_intro", "title": "role", "company": "firm",
           "fund": "firm", "last_deal_on": "last_deal_date", "line": "personal_line"}
GLOBAL = ("global", "any", "anywhere", "worldwide", "remote")
GEO_STOP = {"new", "north", "south", "east", "west", "san", "los", "las", "the", "of", "city", "and", "bay", "area"}
GEO_ALIASES = {"usa": "us", "united states": "us", "united states of america": "us", "u.s.": "us",
               "u.s.a.": "us", "uk": "gb", "united kingdom": "gb"}
SECURITIES = [("isEquityType", "equity"), ("isDebtType", "debt"), ("isOptionToAcquireType", "options"),
              ("isSecurityToBeAcquiredType", "securities on exercise"),
              ("isPooledInvestmentFundInterestsType", "fund interests"), ("isTenantInCommonType", "tenant in common"),
              ("isMineralPropertyType", "mineral property")]


class InvError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- parsing helpers

def today_of(text):
    if not text:
        return datetime.date.today()
    try:
        return datetime.datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        raise InvError("--today wants YYYY-MM-DD, not %r" % text)


def parse_date(text, what):
    """YYYY-MM-DD, or YYYY-MM (the 1st of the month)."""
    t = str(text).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m"):
        try:
            return datetime.datetime.strptime(t, fmt).date()
        except ValueError:
            pass
    raise InvError("%s wants YYYY-MM-DD or YYYY-MM, not %r" % (what, text))


def money(text, what="an amount"):
    """$250K, 1M, 1.5m, 1,500,000 -> int dollars."""
    if isinstance(text, bool):
        raise InvError("%s is not an amount: %r" % (what, text))
    if isinstance(text, (int, float)):
        return int(round(text))
    t = str(text).strip().lower().replace(",", "").replace("$", "").replace(" ", "")
    m = re.match(r"^(\d+(?:\.\d+)?)([km]?|mm|bn?)$", t)
    if not m:
        raise InvError("%s is not an amount like $250K or 1.5M: %r" % (what, text))
    mult = {"": 1, "k": 1000, "m": 10 ** 6, "mm": 10 ** 6, "b": 10 ** 9, "bn": 10 ** 9}[m.group(2)]
    return int(round(float(m.group(1)) * mult))


def money_range(text, what="--check"):
    """'250K-1M', '$250K to $1M', '$100K' -> (min, max)."""
    parts = re.split(r"\s*(?:-|–|to)\s*", str(text).strip(), maxsplit=1)
    lo = money(parts[0], what)
    hi = money(parts[1], what) if len(parts) > 1 and parts[1] else lo
    if lo <= 0 or hi < lo:
        raise InvError("%s wants a range like 250K-1M with the low end first, not %r" % (what, text))
    return lo, hi


def short_money(n):
    if n is None:
        return "?"
    if n >= 10 ** 6:
        s = "%.2f" % (n / 1e6)
        return "$" + s.rstrip("0").rstrip(".") + "M"
    if n >= 1000:
        s = "%.1f" % (n / 1e3)
        return "$" + s.rstrip("0").rstrip(".") + "K"
    return "$%d" % n


def full_money(n):
    return "$" + "{:,}".format(int(n)) if n is not None else "?"


def split_list(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        items = v
    else:
        items = re.split(r"\s*[;|]\s*|\s*,\s*", str(v))
    return [str(x).strip() for x in items if str(x).strip()]


def split_urls(v):
    """URLs separated by spaces, semicolons, pipes or commas (or a list)."""
    if v is None:
        return []
    items = v if isinstance(v, (list, tuple)) else re.split(r"[\s;|,]+", str(v))
    out = []
    for x in items:
        out.extend(u for u in re.split(r"[\s;|]+", str(x).strip()) if u)
    return out


def norm_stage(s):
    t = re.sub(r"[\s_-]+", " ", str(s).strip().lower())
    t = {"preseed": "pre-seed", "pre seed": "pre-seed", "a": "series a", "series-a": "series a",
         "b": "series b", "seriesa": "series a", "seriesb": "series b", "late": "growth",
         "growth equity": "growth"}.get(t, t)
    if t not in STAGES:
        raise InvError("stage %r is not one of: %s" % (s, ", ".join(STAGES)))
    return t


def words(s):
    t = str(s).lower().replace("&", " and ")
    out = set()
    for w in re.findall(r"[a-z0-9]+", t):
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        if w not in ("and", "the", "of", "for"):
            out.add(w)
    return out


def sector_match(ours, theirs):
    """Our sectors that match one of theirs: equal words, or one's words inside the other's."""
    hit = []
    for o in ours:
        ow = words(o)
        for t in theirs:
            tw = words(t)
            if ow and tw and (ow <= tw or tw <= ow):
                hit.append(o)
                break
    return hit


def norm_geo(g):
    t = re.sub(r"\s+", " ", str(g).strip().lower())
    return GEO_ALIASES.get(t, t)


def geo_match(ours, theirs):
    """(matched, reason)."""
    th = [norm_geo(g) for g in theirs]
    if any(g in GLOBAL for g in th):
        return True, "invests globally"
    for o in ours:
        on = norm_geo(o)
        ow = (set(re.findall(r"[a-z0-9.]+", on)) - GEO_STOP) | {on}
        for t in th:
            tw = (set(re.findall(r"[a-z0-9.]+", t)) - GEO_STOP) | {t}
            if on == t or (ow & tw):
                return True, "invests in %s" % t.upper() if len(t) <= 3 else "invests in %s" % t.title()
    return False, None


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")
    return s or "investor"


def truthy(v):
    if isinstance(v, bool):
        return v
    return str(v or "").strip().lower() in ("1", "y", "yes", "true", "warm", "x")


# ---------------------------------------------------------------- the seed folder

def seed_dir(a):
    return a.dir or "seed"


def read_json(path, what):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, IOError):
        raise InvError("no %s at %s" % (what, path), 1)
    except ValueError as e:
        raise InvError("%s is not valid JSON: %s" % (path, e))


def write_json(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def load_book(sd):
    path = os.path.join(sd, "investors.json")
    if os.path.isfile(path):
        doc = read_json(path, "investors")
        doc.setdefault("investors", [])
        return doc
    return {"created_by": "seed-investors", "generated": None, "ask": None, "criteria": {}, "investors": []}


def load_config(sd):
    path = os.path.join(sd, "config.json")
    return read_json(path, "config") if os.path.isfile(path) else {}


# ---------------------------------------------------------------- one investor row

def clean_row(raw, today, where="row"):
    """A dict from a CSV row, a JSON object or the add flags -> (investor, warnings). Raises InvError(code 1)."""
    warnings = []
    raw = dict((str(k).strip().lower().replace(" ", "_"), v) for k, v in raw.items() if k is not None)
    for k in list(raw):
        if k in ALIASES and not str(raw.get(ALIASES[k]) or "").strip():
            raw[ALIASES[k]] = raw.pop(k)
    for k in list(raw):
        if k in PRIVATE_COLUMNS or k.startswith("phone") or k.endswith("_phone") or "address" in k:
            if str(raw[k] or "").strip():
                warnings.append("%s: dropped the %r column: phone numbers and home addresses are never collected"
                                % (where, k))
            del raw[k]
        elif k not in FIELDS and k not in ("id", "fit", "reasons", "added", "last_relevant_deal"):
            if str(raw[k] or "").strip():
                warnings.append("%s: ignored the unknown column %r" % (where, k))
            del raw[k]
    name = str(raw.get("name") or "").strip()
    if not name:
        raise InvError("%s has no name" % where, 1)
    label = "%s (%s)" % (where, name)
    for k, v in raw.items():
        if k in ("sources", "source"):
            continue
        if isinstance(v, str) and PHONE.search(v):
            raise InvError("%s: %s holds what looks like a phone number; phone numbers are never collected. "
                           "Remove it and try again." % (label, k), 1)
    sources = split_urls(raw.get("sources")) + split_urls(raw.get("source"))
    sources = [s for i, s in enumerate(sources) if s not in sources[:i]]
    bad = [s for s in sources if not URL.match(s)]
    if bad:
        raise InvError("%s: a source must be a public URL (https://...), not %r" % (label, bad[0]), 1)
    if not sources:
        raise InvError("%s has no source: add the public page this came from (their site, a profile found "
                       "through search, an SEC filing, the press)" % label, 1)
    email = str(raw.get("email") or "").strip()
    if email:
        if not EMAIL.match(email):
            raise InvError("%s: %r is not an email address" % (label, email), 1)
        if email.split("@")[1].lower() in FREEMAIL:
            warnings.append("%s: %s is a personal-style address; use it only if they publish it for pitches"
                            % (label, email))
    stages = [norm_stage(s) for s in split_list(raw.get("stage"))]
    cmin = cmax = None
    if str(raw.get("check") or "").strip():
        cmin, cmax = money_range(raw["check"], "%s check" % label)
    if str(raw.get("check_min") or "").strip():
        cmin = money(raw["check_min"], "%s check_min" % label)
    if str(raw.get("check_max") or "").strip():
        cmax = money(raw["check_max"], "%s check_max" % label)
    if cmin is not None and cmax is None:
        cmax = cmin
    if cmax is not None and cmin is None:
        cmin = cmax
    if cmin is not None and cmax < cmin:
        raise InvError("%s: check_max is under check_min" % label)
    deal = raw.get("last_relevant_deal") if isinstance(raw.get("last_relevant_deal"), dict) else None
    what = str(raw.get("last_deal") or (deal or {}).get("what") or "").strip()
    when = str(raw.get("last_deal_date") or (deal or {}).get("date") or "").strip()
    last = None
    if what or when:
        if not when:
            raise InvError("%s: last_deal needs last_deal_date (YYYY-MM-DD) for the recency score" % label)
        d = parse_date(when, "%s last_deal_date" % label)
        if d > today:
            raise InvError("%s: last_deal_date %s is in the future" % (label, d), 1)
        last = {"what": what or "a relevant deal", "date": d.isoformat()}
    inv = {"id": str(raw.get("id") or "").strip() or slug(name), "name": name,
           "firm": str(raw.get("firm") or "").strip(), "role": str(raw.get("role") or "").strip(),
           "email": email, "stage": stages, "check_min": cmin, "check_max": cmax,
           "sectors": split_list(raw.get("sectors")), "geo": split_list(raw.get("geo")),
           "last_relevant_deal": last, "sources": sources, "warm_intro": truthy(raw.get("warm_intro")),
           "personal_line": str(raw.get("personal_line") or "").strip(),
           "notes": str(raw.get("notes") or "").strip(), "fit": None, "reasons": []}
    if not inv["personal_line"]:
        warnings.append("%s has no personal_line yet: /seed-closer needs one before it drafts an email" % label)
    return inv, warnings


def merge(book, inv, today):
    """Add or update by email, else by name + firm. Returns 'added' or 'updated'."""
    for old in book["investors"]:
        same_email = inv["email"] and old.get("email", "").lower() == inv["email"].lower()
        same_name = (old.get("name", "").lower() == inv["name"].lower()
                     and old.get("firm", "").lower() == inv["firm"].lower())
        if same_email or same_name:
            for k, v in inv.items():
                if k == "id":
                    continue
                if k == "sources":
                    old["sources"] = list(old.get("sources") or []) + [s for s in v if s not in (old.get("sources") or [])]
                elif v not in (None, "", [], False) or k == "warm_intro":
                    old[k] = v
            old["fit"], old["reasons"] = None, []
            return "updated", old
    ids = set(x.get("id") for x in book["investors"])
    base, n = inv["id"], 2
    while inv["id"] in ids:
        inv["id"] = "%s-%d" % (base, n)
        n += 1
    inv["added"] = today.isoformat()
    book["investors"].append(inv)
    return "added", inv


def read_rows(path):
    if not os.path.isfile(path):
        raise InvError("no file %s" % path, 1)
    if path.lower().endswith(".json"):
        doc = read_json(path, "investors file")
        rows = doc.get("investors") if isinstance(doc, dict) else doc
        if not isinstance(rows, list):
            raise InvError("%s wants a list of investors (or {\"investors\": [...]})" % path)
        return [(("item %d" % (i + 1)), r) for i, r in enumerate(rows)]
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return [("row %d" % (i + 2), r) for i, r in enumerate(csv.DictReader(fh))]


# ---------------------------------------------------------------- fit

def criteria_of(a, book, cfg):
    st = cfg.get("startup") or {}
    old = book.get("criteria") or {}
    stage = a.stage or old.get("stage") or st.get("stage")
    sectors = split_list(a.sectors) if a.sectors else (old.get("sectors") or split_list(st.get("sector")))
    geo = split_list(a.geo) if a.geo else (old.get("geo") or split_list(st.get("geography")))
    ask = None
    if a.ask:
        ask = money(a.ask, "--ask")
    elif book.get("ask"):
        ask = money(book["ask"], "the ask")
    elif st.get("raise"):
        ask = money(st["raise"], "startup.raise in config.json")
    missing = [n for n, v in (("stage", stage), ("sectors", sectors), ("geo", geo), ("ask", ask)) if not v]
    if missing:
        raise InvError("rank needs your %s: pass --%s, or fill seed/config.json (startup.stage, sector, "
                       "geography, raise)" % (", ".join(missing), missing[0]), 2)
    if a.check:
        cmin, cmax = money_range(a.check)
    elif old.get("check") and not a.ask:
        cmin, cmax = money(old["check"]["min"]), money(old["check"]["max"])
    else:
        cmin, cmax = int(round(ask * 0.05)), int(round(ask * 0.5))
    return {"stage": norm_stage(stage), "sectors": sectors, "geo": geo, "check": {"min": cmin, "max": cmax}}, ask


def recency_points(days):
    """15 x (1 - days / 730), rounded half up, exact in integers."""
    if days <= 0:
        return WEIGHTS["recency"]
    if days >= RECENCY_DAYS:
        return 0
    num = WEIGHTS["recency"] * (RECENCY_DAYS - days)
    return (2 * num + RECENCY_DAYS) // (2 * RECENCY_DAYS)


def score(inv, crit, ask, today):
    """(fit, reasons) or (None, [why it was refused])."""
    for k in ("stage", "sectors", "geo", "sources"):       # a hand-edited file may hold "seed", not ["seed"]
        if isinstance(inv.get(k), str):
            inv[k] = split_list(inv[k]) if k != "sources" else split_urls(inv[k])
    if not [s for s in inv.get("sources") or [] if URL.match(str(s))]:
        return None, ["refused: no public source; add the page this came from, then rank again"]
    pts, why = 0, []
    stages = []
    for s in inv.get("stage") or []:
        try:
            stages.append(norm_stage(s))
        except InvError:
            pass
    ours = crit["stage"]
    if ours in stages:
        pts += WEIGHTS["stage"]
        why.append("invests at %s (+%d)" % (ours, WEIGHTS["stage"]))
    elif stages and min(abs(STAGES.index(s) - STAGES.index(ours)) for s in stages) == 1:
        pts += 12
        why.append("invests at %s, one stage off %s (+12)" % (", ".join(stages), ours))
    elif stages:
        why.append("invests at %s, not %s (+0)" % (", ".join(stages), ours))
    else:
        why.append("stage unknown: check their site (+0)")

    hit = sector_match(crit["sectors"], inv.get("sectors") or [])
    p = WEIGHTS["sectors"] if len(hit) >= 2 else (15 if hit else 0)
    pts += p
    why.append(("sectors match: %s (+%d)" % (", ".join(hit), p)) if hit else
               ("no sector overlap with %s (+0)" % ", ".join(crit["sectors"])))

    lo, hi = inv.get("check_min"), inv.get("check_max")
    cmin, cmax = crit["check"]["min"], crit["check"]["max"]
    want = "%s-%s" % (short_money(cmin), short_money(cmax))
    if lo is None or hi is None:
        why.append("check size unknown (+0)")
    else:
        theirs = short_money(lo) if lo == hi else "%s-%s" % (short_money(lo), short_money(hi))
        if lo > ask:
            why.append("their smallest check, %s, is bigger than your whole %s round (+0)" % (short_money(lo), short_money(ask)))
        elif lo <= cmax and hi >= cmin:
            pts += WEIGHTS["check"]
            why.append("checks of %s fit the %s you want (+%d)" % (theirs, want, WEIGHTS["check"]))
        elif hi * 2 >= cmin and lo <= cmax * 2:
            pts += 10
            why.append("checks of %s are close to the %s you want (+10)" % (theirs, want))
        else:
            why.append("checks of %s are far from the %s you want (+0)" % (theirs, want))

    deal = inv.get("last_relevant_deal") or None
    if deal and deal.get("date"):
        d = parse_date(deal["date"], "last_relevant_deal.date")
        days = (today - d).days
        p = recency_points(days)
        pts += p
        why.append("%s, %d days ago (+%d)" % (deal.get("what") or "a relevant deal", max(days, 0), p))
    else:
        why.append("no relevant deal on record (+0)")

    ok, g = geo_match(crit["geo"], inv.get("geo") or [])
    if ok:
        pts += WEIGHTS["geo"]
        why.append("%s (+%d)" % (g, WEIGHTS["geo"]))
    else:
        why.append(("invests in %s, not %s (+0)" % (", ".join(inv["geo"]), ", ".join(crit["geo"])))
                   if inv.get("geo") else "geography unknown (+0)")

    if inv.get("warm_intro"):
        pts += WEIGHTS["warm"]
        why.append("warm intro available (+%d)" % WEIGHTS["warm"])
    return pts, why


def rank_book(book, crit, ask, today):
    ranked, refused = [], []
    for inv in book["investors"]:
        fit, why = score(inv, crit, ask, today)
        inv["fit"], inv["reasons"] = fit, why
        (refused if fit is None else ranked).append(inv)
    ranked.sort(key=lambda x: (-x["fit"], x["name"].lower()))
    book["investors"] = ranked + refused
    book["criteria"] = crit
    book["ask"] = ask
    book["generated"] = today.isoformat()
    book["created_by"] = "seed-investors"
    return ranked, refused


def print_table(rows, n=None):
    print("  %3s  %-16s %-22s %-12s %-16s %s" % ("fit", "name", "firm", "check", "stage", "id"))
    for x in rows[:n] if n else rows:
        chk = "?" if x.get("check_min") is None else (
            short_money(x["check_min"]) if x["check_min"] == x["check_max"] else
            "%s-%s" % (short_money(x["check_min"]), short_money(x["check_max"])))
        print("  %3s  %-16s %-22s %-12s %-16s %s" % (
            "-" if x.get("fit") is None else x["fit"], x["name"][:16], (x.get("firm") or "")[:22], chk,
            ", ".join(x.get("stage") or [])[:16], x["id"]))


# ---------------------------------------------------------------- SEC EDGAR: Form D

def sec_user_agent(cli, sd):
    ua = (cli or os.environ.get("SEC_USER_AGENT") or "").strip()
    if not ua:
        ua = str(load_config(sd).get("sec_user_agent") or "").strip()
    if not ua:
        raise InvError("SEC asks every automated request to say who is asking: set sec_user_agent in "
                       "seed/config.json (or SEC_USER_AGENT) to \"Your Name your@email\"", 1)
    m = re.search(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", ua)
    low = ua.lower()
    placeholder = (re.search(r"@example\.|\.example\b|\byou@|\byour[ ._-]?(?:name|email)\b|\bname@|\bemail@", low)
                   or (m and m.group(0).split("@")[0].lower() in ("you", "user", "name", "email", "me")))
    if not m or not re.sub(re.escape(m.group(0)), "", ua).strip() or placeholder:
        raise InvError("sec_user_agent must be your real name and email, like \"Ada Lovelace ada@yourstartup.com\" "
                       "(got %r)" % ua, 1)
    return ua


class Sec(object):
    def __init__(self, ua=None, offline=None, pause=PAUSE):
        self.ua, self.offline, self.pause, self._last = ua, offline, pause, 0.0

    def get(self, url, name):
        if self.offline:
            path = os.path.join(self.offline, name)
            if not os.path.isfile(path):
                return None
            with open(path, "rb") as fh:
                raw = fh.read()
        else:
            gap = time.time() - self._last
            if self._last and gap < self.pause:
                time.sleep(self.pause - gap)
            self._last = time.time()
            req = urllib.request.Request(url, headers={"User-Agent": self.ua, "Accept-Encoding": "gzip"})
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    raw = r.read()
            except urllib.error.HTTPError as e:
                e.close()
                if e.code == 404:
                    return None
                if e.code == 403:
                    raise InvError("SEC refused the request (HTTP 403): its fair-access rule wants your real name "
                                   "and email in sec_user_agent, and fewer than 10 requests a second")
                if e.code == 429:
                    raise InvError("SEC says slow down (HTTP 429): wait ten minutes and try again")
                raise InvError("SEC answered HTTP %d for %s" % (e.code, url.split("?")[0]))
            except urllib.error.URLError as e:
                raise InvError("could not reach SEC EDGAR: %s" % (e.reason,))
            except OSError as e:
                raise InvError("network error: %s" % (e,))
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "replace")


def efts_url(q, since, until, start):
    query = q.strip()
    if " " in query and '"' not in query:
        query = '"%s"' % query          # a phrase, not any of the words
    p = [("q", query), ("dateRange", "custom"), ("startdt", since), ("enddt", until), ("forms", "D")]
    if start:
        p.append(("from", str(start)))
    return EFTS % urllib.parse.urlencode(p)


def company_of(display):
    """'Pawprint Labs, Inc.  (CIK 0001999999)' -> 'Pawprint Labs, Inc.'"""
    return re.sub(r"\s*\((?:[A-Z0-9.\- ,]+)\)\s*", " ", re.sub(r"\s*\(CIK \d+\)\s*$", "", display or "")).strip()


def strip_ns(root):
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def txt(el, path):
    x = el.find(path) if el is not None else None
    return (x.text or "").strip() if x is not None and x.text else ""


def amount(s):
    s = (s or "").strip()
    if not s:
        return None
    if s.lower().startswith("indefinite"):
        return "indefinite"
    try:
        return int(round(float(s)))
    except ValueError:
        return None


def parse_form_d(xml_text):
    """primary_doc.xml -> the facts a founder needs. Names and roles of related persons, never addresses."""
    try:
        root = strip_ns(ET.fromstring(xml_text))
    except ET.ParseError as e:
        raise InvError("a Form D document is not valid XML: %s" % e)
    iss = root.find("primaryIssuer")
    off = root.find("offeringData")
    sec = off.find("typesOfSecuritiesOffered") if off is not None else None
    securities = [label for tag, label in SECURITIES if txt(sec, tag).lower() == "true"]
    if txt(sec, "isOtherType").lower() == "true":
        securities.append(txt(sec, "descriptionOfOtherType") or "other")
    people = []
    for p in root.findall("relatedPersonsList/relatedPersonInfo"):
        n = " ".join(x for x in (txt(p, "relatedPersonName/firstName"), txt(p, "relatedPersonName/lastName")) if x)
        rel = [(r.text or "").strip() for r in p.findall("relatedPersonRelationshipList/relationship") if r.text]
        if n:
            people.append({"name": n, "relationships": rel, "clarification": txt(p, "relationshipClarification")})
    first = txt(off, "typeOfFiling/dateOfFirstSale/value")
    return {"company": txt(iss, "entityName"), "cik": txt(iss, "cik"),
            "city": txt(iss, "issuerAddress/city"), "state": txt(iss, "issuerAddress/stateOrCountry"),
            "incorporated": txt(iss, "jurisdictionOfInc"), "year_of_inc": txt(iss, "yearOfInc/value") or None,
            "entity_type": txt(iss, "entityType"),
            "industry": txt(off, "industryGroup/industryGroupType"),
            "fund_type": txt(off, "industryGroup/investmentFundInfo/investmentFundType") or None,
            "amendment": txt(off, "typeOfFiling/newOrAmendment/isAmendment").lower() == "true",
            "first_sale": first or ("yet to occur" if off is not None and off.find(
                "typeOfFiling/dateOfFirstSale/yetToOccur") is not None else None),
            "securities": securities,
            "amount_offered": amount(txt(off, "offeringSalesAmounts/totalOfferingAmount")),
            "amount_sold": amount(txt(off, "offeringSalesAmounts/totalAmountSold")),
            "amount_remaining": amount(txt(off, "offeringSalesAmounts/totalRemaining")),
            "investors_count": amount(txt(off, "investors/totalNumberAlreadyInvested")),
            "minimum_investment": amount(txt(off, "minimumInvestmentAccepted")),
            "related_persons": people}


def search_form_d(sec, q, since, until, max_hits):
    hits, total, start = [], None, 0
    while len(hits) < max_hits:
        text = sec.get(efts_url(q, since, until, start), "efts-%d.json" % start)
        if text is None:
            break
        try:
            doc = json.loads(text)
        except ValueError:
            raise InvError("EDGAR full-text search sent something that is not JSON")
        block = doc.get("hits") or {}
        tot = block.get("total")
        total = tot.get("value") if isinstance(tot, dict) else tot
        page = block.get("hits") or []
        hits.extend(page)
        start += PAGE
        if not page or len(page) < PAGE or (total is not None and start >= total):
            break
    return hits[:max_hits], total


def collect(sec, q, since, until, max_hits=40, details=True, amendments=True):
    hits, total = search_form_d(sec, q, since, until, max_hits)
    seen, filings = set(), []
    for h in hits:
        s = h.get("_source") or {}
        adsh = s.get("adsh") or (h.get("_id") or "").split(":")[0]
        if not adsh or adsh in seen:
            continue
        form = s.get("form") or s.get("file_type") or "D"
        if not amendments and form.upper() != "D":
            continue
        seen.add(adsh)
        ciks = s.get("ciks") or []
        cik = int(ciks[0]) if ciks else int(adsh.split("-")[0])
        fname = (h.get("_id") or "").split(":", 1)[1] if ":" in (h.get("_id") or "") else "primary_doc.xml"
        folder = adsh.replace("-", "")
        names = s.get("display_names") or []
        f = {"adsh": adsh, "cik": "%010d" % cik, "company": company_of(names[0]) if names else "",
             "form": form, "filed": s.get("file_date"), "location": ", ".join(s.get("biz_locations") or []),
             "state_of_inc": ", ".join(s.get("inc_states") or []),
             "url": ARCHIVE % (cik, folder, "%s-index.htm" % adsh), "doc_url": ARCHIVE % (cik, folder, fname)}
        if details:
            xml_text = sec.get(f["doc_url"], "%s.xml" % adsh)
            if xml_text:
                d = parse_form_d(xml_text)
                f.update(dict((k, v) for k, v in d.items() if k not in ("company", "cik") or not f.get(k)))
                f["amendment"] = d["amendment"] or form.upper() != "D"
        filings.append(f)
    filings.sort(key=lambda x: (x.get("filed") or "", x["adsh"]), reverse=True)
    return filings, total


def summarise(filings):
    sold = [f["amount_sold"] for f in filings if isinstance(f.get("amount_sold"), int) and f["amount_sold"] > 0]
    return {"filings": len(filings), "companies": len(set(f["cik"] for f in filings)),
            "with_amounts": len(sold), "median_sold": int(statistics.median(sold)) if sold else None,
            "total_sold": sum(sold) if sold else None}


def leads_of(f):
    """Directors who are not officers: often an investor's board seat."""
    out = []
    for p in f.get("related_persons") or []:
        rel = [r.lower() for r in p.get("relationships") or []]
        if "director" in rel and "executive officer" not in rel:
            out.append(p["name"])
    return out


# ---------------------------------------------------------------- commands

def cmd_formd(a):
    today = today_of(a.today)
    since = parse_date(a.since, "--since").isoformat()
    until = parse_date(a.until, "--until").isoformat() if a.until else today.isoformat()
    if until < since:
        raise InvError("--until is before --since")
    if not (a.q or "").strip():
        raise InvError("--q needs the words to search for")
    if a.max < 1 or a.max > 500:
        raise InvError("--max is 1 to 500")
    ua = None if a.offline else sec_user_agent(a.ua, seed_dir(a))
    sec = Sec(ua, a.offline)
    filings, total = collect(sec, a.q, since, until, a.max, not a.no_details, not a.no_amendments)
    summ = summarise(filings)
    doc = {"created_by": "seed-investors", "generated": today.isoformat(), "query": a.q, "since": since,
           "until": until, "total_hits": total, "source": efts_url(a.q, since, until, 0),
           "summary": summ, "filings": filings}
    if a.json:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
    elif not filings:
        print("No Form D filings matched %r from %s to %s. Form D has no business description: try the words "
              "founders put in company names (one word, like \"pet\" or \"paw\")." % (a.q, since, until))
    else:
        print("SEC EDGAR Form D filings matching %r, %s to %s: %d shown of %s" % (
            a.q, since, until, len(filings), total if total is not None else "?"))
        print("  %-10s %-30s %-18s %12s %12s %5s  %s" % ("filed", "company", "where", "sold", "offered", "inv.",
                                                         "securities"))
        for f in filings:
            off = f.get("amount_offered")
            print("  %-10s %-30s %-18s %12s %12s %5s  %s%s" % (
                f.get("filed") or "?", (f["company"] or "?")[:30], (f.get("location") or "")[:18],
                full_money(f["amount_sold"]) if isinstance(f.get("amount_sold"), int) else "?",
                "indefinite" if off == "indefinite" else (full_money(off) if isinstance(off, int) else "?"),
                f.get("investors_count") if f.get("investors_count") is not None else "?",
                ", ".join(f.get("securities") or []), " (amendment)" if f.get("amendment") else ""))
            if f.get("fund_type"):
                print("  %10s a %s raising money: an investor to research, not a comparable startup" % (
                    "", f["fund_type"].lower()))
            lead = leads_of(f)
            if lead:
                print("  %10s directors who are not officers (look them up): %s" % ("", ", ".join(lead)))
        print("%d filings from %d companies. Amount sold: median %s, total %s (the %d that state it)." % (
            summ["filings"], summ["companies"], full_money(summ["median_sold"]) if summ["median_sold"] else "?",
            full_money(summ["total_sold"]) if summ["total_sold"] else "?", summ["with_amounts"]))
        print("Form D names the company, not its investors. Search the press for \"<company> seed round\" to "
              "find who led, then add them with a source.")
    if a.write:
        path = os.path.join(seed_dir(a), "formd.json")
        write_json(path, doc)
        if not a.json:
            print("Wrote %s." % path)
    return 0 if filings else 1


def save_rows(a, rows):
    today = today_of(a.today)
    sd = seed_dir(a)
    book = load_book(sd)
    done, refused, warnings = [], [], []
    for where, raw in rows:
        try:
            inv, w = clean_row(raw, today, where)
            warnings.extend(w)
            how, inv = merge(book, inv, today)
            done.append((how, inv))
        except InvError as e:
            refused.append(str(e))
    for w in warnings:
        print("Note: " + w)
    for r in refused:
        print("Refused: " + r)
    if done:
        book["created_by"] = "seed-investors"
        book["generated"] = today.isoformat()
        path = os.path.join(sd, "investors.json")
        write_json(path, book)
        for how, inv in done:
            print("%s %s (%s), %d source%s." % (how.capitalize(), inv["name"], inv["id"], len(inv["sources"]),
                                                "" if len(inv["sources"]) == 1 else "s"))
        print("Wrote %s: %d investors. Next: investors.py rank --write." % (path, len(book["investors"])))
    return 0 if done and not refused else 1


def cmd_import(a):
    return save_rows(a, read_rows(a.file))


def cmd_add(a):
    raw = {"name": a.name, "firm": a.firm, "role": a.role, "email": a.email, "stage": a.stage_list,
           "check": a.check, "sectors": a.sectors, "geo": a.geo, "last_deal": a.last_deal,
           "last_deal_date": a.last_deal_date, "sources": a.source or [], "warm_intro": a.warm_intro,
           "personal_line": a.personal_line, "notes": a.notes}
    return save_rows(a, [("--name", dict((k, v) for k, v in raw.items() if v not in (None, "")))])


def cmd_rank(a):
    sd = seed_dir(a)
    book = load_book(sd)
    if not book["investors"]:
        print("No investors in %s yet. Add them: investors.py import FILE.csv, or investors.py add." %
              os.path.join(sd, "investors.json"))
        return 1
    crit, ask = criteria_of(a, book, load_config(sd))
    ranked, refused = rank_book(book, crit, ask, today_of(a.today))
    if a.json:
        print(json.dumps(book, indent=2, ensure_ascii=False))
    else:
        print("Investor fit for a %s %s round in %s, sectors %s; checks of %s-%s wanted" % (
            short_money(ask), crit["stage"], ", ".join(crit["geo"]), ", ".join(crit["sectors"]),
            short_money(crit["check"]["min"]), short_money(crit["check"]["max"])))
        print_table(ranked)
        for x in ranked[:a.reasons]:
            print("  %s (%d): %s" % (x["name"], x["fit"], "; ".join(x["reasons"])))
        for x in refused:
            print("Refused: %s (%s): %s" % (x["name"], x["id"], x["reasons"][0]))
    if a.write:
        path = os.path.join(sd, "investors.json")
        write_json(path, book)
        if not a.json:
            print("Wrote %s." % path)
    elif not a.json:
        print("Not saved: add --write so /seed-closer can use the fits.")
    return 0 if ranked else 1


def cmd_show(a):
    sd = seed_dir(a)
    path = os.path.join(sd, "investors.json")
    if not os.path.isfile(path):
        print("No %s yet. Add investors: investors.py import FILE.csv" % path)
        return 1
    book = load_book(sd)
    if a.id:
        hit = [x for x in book["investors"] if x["id"] == a.id or x["name"].lower() == a.id.lower()]
        if not hit:
            print("No investor %r in %s." % (a.id, path))
            return 1
        x = hit[0]
        if a.json:
            print(json.dumps(x, indent=2, ensure_ascii=False))
            return 0
        print("%s, %s, %s (%s)" % (x["name"], x.get("role") or "role ?", x.get("firm") or "firm ?", x["id"]))
        print("  fit       %s" % ("not ranked yet" if x.get("fit") is None else x["fit"]))
        for r in x.get("reasons") or []:
            print("            %s" % r)
        print("  email     %s" % (x.get("email") or "none yet"))
        print("  stage     %s" % ", ".join(x.get("stage") or []))
        print("  checks    %s" % ("?" if x.get("check_min") is None else
                                  "%s-%s" % (short_money(x["check_min"]), short_money(x["check_max"]))))
        print("  sectors   %s" % ", ".join(x.get("sectors") or []))
        print("  geo       %s" % ", ".join(x.get("geo") or []))
        d = x.get("last_relevant_deal")
        print("  last deal %s" % ("%s (%s)" % (d["what"], d["date"]) if d else "none on record"))
        print("  warm      %s" % ("yes" if x.get("warm_intro") else "no"))
        print("  line      %s" % (x.get("personal_line") or "none yet: /seed-closer needs one"))
        for s in x.get("sources") or []:
            print("  source    %s" % s)
        return 0
    if a.json:
        print(json.dumps(book, indent=2, ensure_ascii=False))
        return 0
    print("%d investors in %s (ranked %s)" % (len(book["investors"]), path, book.get("generated") or "never"))
    print_table(book["investors"], a.top)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Investor Finder (seed-investors): public research, ranked by fit.")
    sub = ap.add_subparsers(dest="cmd")

    def common(p):
        p.add_argument("--dir", help="the seed folder (default ./seed)")
        p.add_argument("--today", help="YYYY-MM-DD (default: today)")
        p.add_argument("--json", action="store_true")

    p = sub.add_parser("formd", help="SEC EDGAR Form D: who in your space raised, how much, when")
    p.add_argument("--q", required=True, help='the words, e.g. "pet care" (a phrase when it has spaces)')
    p.add_argument("--since", required=True, help="YYYY-MM-DD")
    p.add_argument("--until", help="YYYY-MM-DD (default today)")
    p.add_argument("--max", type=int, default=40, help="filings to read, 1 to 500 (default 40)")
    p.add_argument("--no-details", action="store_true", help="skip each filing's amounts (one request a filing)")
    p.add_argument("--no-amendments", action="store_true", help="drop D/A amendments")
    p.add_argument("--ua", help="SEC User-Agent (default: SEC_USER_AGENT or sec_user_agent in config.json)")
    p.add_argument("--offline", metavar="DIR", help="saved efts-<from>.json and <adsh>.xml files")
    p.add_argument("--write", action="store_true", help="save seed/formd.json")
    common(p)
    p = sub.add_parser("import", help="add investors from a CSV or JSON file")
    p.add_argument("file")
    common(p)
    p = sub.add_parser("add", help="add one investor")
    p.add_argument("--name", required=True)
    p.add_argument("--firm")
    p.add_argument("--role")
    p.add_argument("--email")
    p.add_argument("--stage", dest="stage_list", help='e.g. "pre-seed; seed"')
    p.add_argument("--check", help="their check range, e.g. 250K-1M")
    p.add_argument("--sectors", help='e.g. "pet care; marketplaces"')
    p.add_argument("--geo")
    p.add_argument("--last-deal", help="their latest relevant deal, in a few words")
    p.add_argument("--last-deal-date", help="YYYY-MM-DD")
    p.add_argument("--source", action="append", help="a public URL (repeat for more)")
    p.add_argument("--warm-intro", action="store_true")
    p.add_argument("--personal-line", help="the first line of the email, from your research")
    p.add_argument("--notes")
    common(p)
    p = sub.add_parser("rank", help="fit 0-100 with reasons")
    p.add_argument("--stage")
    p.add_argument("--sectors")
    p.add_argument("--geo")
    p.add_argument("--ask", help="your round, e.g. 1.5M")
    p.add_argument("--check", help="the check you want from one investor, e.g. 75K-750K")
    p.add_argument("--reasons", type=int, default=10, help="print the reasons for the top N (default 10)")
    p.add_argument("--write", action="store_true")
    common(p)
    p = sub.add_parser("show", help="the ranked list, or one investor")
    p.add_argument("id", nargs="?")
    p.add_argument("--top", type=int)
    common(p)
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 2
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return {"formd": cmd_formd, "import": cmd_import, "add": cmd_add, "rank": cmd_rank,
                "show": cmd_show}[a.cmd](a)
    except InvError as e:
        print("investors.py: %s" % e, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
