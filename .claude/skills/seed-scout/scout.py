#!/usr/bin/env python3
"""Competitor Scout for seed-scout: finds the weak points of your competitors
in their own App Store reviews. Standard library only, no keys.

    python3 scout.py find "dog walking"                     # the apps people find for your idea
    python3 scout.py reviews 547320928 --pages 10 --write   # the 500 most recent reviews -> seed/reviews/
    python3 scout.py reviews "Rover" --write                # a name works too (the search picks the app)
    python3 scout.py themes 547320928                       # what the 1-2 star reviews complain about
    python3 scout.py compare 547320928 940734609 --write    # the weak point of each -> seed/competitors.json
    python3 scout.py pricing 547320928 --note "keeps 20% of each booking" --source URL --write
    python3 scout.py show                                   # the current seed/competitors.json

Sources (free, public, not an official API, so they can change or slow down):
  - iTunes Search API     https://itunes.apple.com/search?term=...&media=software&entity=software
  - iTunes Lookup API     https://itunes.apple.com/lookup?id=APP_ID
  - customer-reviews RSS  https://itunes.apple.com/us/rss/customerreviews/page=N/id=APP_ID/sortby=mostrecent/json
    50 reviews a page, 10 pages at most: the 500 most recent reviews in one country.
One request at a time, a pause between pages, a 20-second timeout, a User-Agent that says who is asking.

The themes (keyword rules on the title + text of each 1-2 star review; one review can hit several):
  fees           fees and pricing          fee, price, expensive, %, commission, greedy, money grab
  cancellations  cancellations and no-shows  cancel, no-show, never showed up
  support        customer support          customer service, support, no response, chat bot
  bugs           bugs and app quality      crash, bug, glitch, error, log in, the update, not working
  trust          trust and safety          safety, background check, scam, fraud, stolen, injured, trust
  payments       payments and refunds      refund, payment, payout, charged, chargeback, dispute
  availability   availability              nobody available, not available, in my area, no walkers
"N of M low reviews mention X": M is the 1-2 star reviews read, N the ones that match X.
--rules FILE adds or replaces themes: {"key": {"label": "...", "patterns": ["regex", ...]}}.

The weak point of each app (compare):
  - with two or more apps: the theme that sets this app apart, its share of low reviews minus the
    pooled share of the other apps (a complaint every app gets, like support, is not a gap you can
    win on). Only themes in at least 5% of its low reviews count. If none is above the others, or
    with --by count, it is the most mentioned theme.
  - with one app: the most mentioned theme.
  top_theme in competitors.json is the weak point's theme; most_mentioned is the raw winner.

Writes only with --write: seed/reviews/<app_id>.json (reviews), seed/competitors.json (compare,
pricing). --dir changes seed/. --offline DIR reads saved responses instead of the network:
search.json, lookup-<id>.json and rss-<id>-<page>.json (rev-<id>-<page>.json works too).

Exit codes: 0 done, 1 nothing found or refused, 2 bad input or a network error.
"""

import argparse
import datetime
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "seed-skill/1.0 (+https://github.com/Jakeschincariol/seed-skill)"
SEARCH = "https://itunes.apple.com/search?%s"
LOOKUP = "https://itunes.apple.com/lookup?id=%s&country=%s"
RSS = "https://itunes.apple.com/%s/rss/customerreviews/page=%d/id=%s/sortby=mostrecent/json"
MAX_PAGES = 10
PAUSE = 1.0
TIMEOUT = 20
MIN_SHARE = 5.0      # a weak point needs at least 5% of the app's low reviews
EXAMPLES = 3
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

THEMES = [
    ("fees", "fees and pricing", [
        r"\bfees?\b", r"\bpric(?:e|es|ed|ey|ing)\b", r"\boverpriced\b", r"\bexpensive\b", r"\bovercharg",
        r"\bcosts?\b|\bcostly\b", r"\d\s*%|\bpercent\b", r"\bcommission\b", r"\bgreed(?:y)?\b",
        r"\b(?:money|cash) (?:grab|hungry)\b", r"\bafford", r"\bcheaper\b", r"\bmark ?up\b", r"\bsurcharge"]),
    ("cancellations", "cancellations and no-shows", [
        r"\bcancel", r"\bno[\s-]?shows?\b", r"\bnever show(?:ed)? up\b", r"\bdid(?:n't| not) show up\b",
        r"\bstood (?:me|us) up\b"]),
    ("support", "customer support", [
        r"\bcustomer (?:service|support|care)\b", r"\bsupport\b", r"\bno (?:response|reply|answer)\b",
        r"\bnever (?:respond|replied|answer|got back|heard back)", r"\bunhelpful\b", r"\bchat ?bots?\b",
        r"\bcan'?t (?:reach|contact|get a hold)\b", r"\bhelp center\b", r"\bon hold\b"]),
    ("bugs", "bugs and app quality", [
        r"\bcrash", r"\bbugs?\b|\bbuggy\b", r"\bglitch", r"\bfreez|\bfroze", r"\bwon'?t (?:load|open)\b",
        r"\berror\b", r"\bslow\b", r"\blog ?in\b|\bsign ?in\b", r"\b(?:new|latest|recent|last|this|the) update\b",
        r"\bnot working\b|\bdoesn'?t work\b|\bdoes not work\b"]),
    ("trust", "trust and safety", [
        r"\bunsafe\b|\bsafety\b", r"\blost (?:my |our |the )?(?:dog|cat|pet)\b", r"\binjur",
        r"\bdied\b|\bdeath\b|\bkilled\b", r"\bst(?:ole|olen|eal)", r"\bbackground checks?\b", r"\bscam",
        r"\bfraud", r"\btrust", r"\bdistrust"]),
    ("payments", "payments and refunds", [
        r"\brefund", r"\bpayments?\b", r"\bpayouts?\b", r"\bmoney back\b", r"\bcharged\b", r"\bchargeback",
        r"\bdispute"]),
    ("availability", "availability", [
        r"\b(?:nobody|no one) (?:is )?(?:available|accepted|applied)\b", r"\bunavailable\b|\bnot available\b",
        r"\bin my area\b", r"\bcan'?t find (?:a |any |anyone)", r"\bno (?:walkers?|sitters?|drivers?|providers?|pros)\b"]),
]


class ScoutError(Exception):
    def __init__(self, msg, code=2):
        Exception.__init__(self, msg)
        self.code = code


# ---------------------------------------------------------------- small helpers

def today_of(text):
    if not text:
        return datetime.date.today()
    try:
        return datetime.datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        raise ScoutError("--today wants YYYY-MM-DD, not %r" % text)


def nice_date(iso):
    """2026-10-14 -> Oct 14 2026."""
    try:
        y, m, d = [int(x) for x in iso[:10].split("-")]
        return "%s %d %d" % (MONTHS[m - 1], d, y)
    except (ValueError, IndexError):
        return iso


def pct(n, m):
    return 0.0 if not m else round(100.0 * n / m, 1)


def rating1(x):
    """App Store average to one decimal, half up: 4.88527 -> 4.9."""
    if x is None:
        return None
    return float(int(float(x) * 10 + 0.5)) / 10


def short_name(name):
    """'Rover – Pet Sitters' -> 'Rover', 'Wag! - Dog Walkers & Sitters' -> 'Wag!'."""
    for sep in (" – ", " - ", ": ", " | "):
        if sep in name:
            return name.split(sep)[0].strip()
    return name.strip()


def read_json(path, what="file"):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, IOError):
        raise ScoutError("no %s at %s" % (what, path), 1)
    except ValueError as e:
        raise ScoutError("%s is not valid JSON: %s" % (path, e))


def write_json(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def decode(raw):
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


# ---------------------------------------------------------------- fetching

class Source(object):
    """Live network, or a folder of saved responses (--offline)."""

    def __init__(self, offline=None, pause=PAUSE, country="us"):
        self.offline = offline
        self.pause = pause
        self.country = country.lower()
        self._last = 0.0

    def _get(self, url):
        gap = time.time() - self._last
        if self._last and gap < self.pause:
            time.sleep(self.pause - gap)
        self._last = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                                   "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return decode(r.read())
        except urllib.error.HTTPError as e:
            e.close()
            if e.code in (400, 404):
                return None             # past the last page, or no such app
            raise ScoutError("the App Store answered HTTP %d for %s" % (e.code, url.split("?")[0]))
        except urllib.error.URLError as e:
            raise ScoutError("could not reach the App Store: %s" % (e.reason,))
        except OSError as e:
            raise ScoutError("network error: %s" % (e,))

    def _file(self, *names):
        for n in names:
            p = os.path.join(self.offline, n)
            if os.path.isfile(p):
                with open(p, "rb") as fh:
                    return decode(fh.read())
        return None

    def _json(self, text, what):
        if text is None:
            return None
        try:
            return json.loads(text)
        except ValueError:
            raise ScoutError("the App Store sent something that is not JSON for %s" % what)

    def search(self, term, limit=10):
        if self.offline:
            path = self.offline if os.path.isfile(self.offline) else os.path.join(self.offline, "search.json")
            if not os.path.isfile(path):
                raise ScoutError("offline: no %s" % path, 1)
            with open(path, "rb") as fh:
                return self._json(decode(fh.read()), "the search")
        q = urllib.parse.urlencode({"term": term, "country": self.country, "media": "software",
                                    "entity": "software", "limit": int(limit)})
        return self._json(self._get(SEARCH % q), "the search") or {"resultCount": 0, "results": []}

    def lookup(self, app_id):
        if self.offline:
            return self._json(self._file("lookup-%s.json" % app_id), "lookup %s" % app_id)
        return self._json(self._get(LOOKUP % (app_id, self.country)), "lookup %s" % app_id)

    def page(self, app_id, n):
        if self.offline:
            return self._json(self._file("rss-%s-%d.json" % (app_id, n), "rev-%s-%d.json" % (app_id, n)),
                              "reviews page %d" % n)
        return self._json(self._get(RSS % (self.country, n, app_id)), "reviews page %d" % n)


def app_row(r):
    """One iTunes Search/Lookup result -> the fields we keep."""
    return {"app_id": int(r.get("trackId")), "app_name": r.get("trackName") or "",
            "name": short_name(r.get("trackName") or ""), "seller": r.get("sellerName") or r.get("artistName"),
            "rating": rating1(r.get("averageUserRating")), "ratings": r.get("userRatingCount"),
            "genre": r.get("primaryGenreName"), "price": r.get("formattedPrice") or r.get("price"),
            "url": (r.get("trackViewUrl") or "").split("?")[0]}


def find_apps(src, term, limit=10):
    doc = src.search(term, limit)
    out = []
    for r in (doc or {}).get("results") or []:
        if r.get("trackId") and (r.get("kind") in (None, "software") or r.get("wrapperType") == "software"):
            out.append(app_row(r))
    return out[:limit]


def resolve(src, ref):
    """An app id, or a name: the search result whose name contains it, most ratings first."""
    ref = str(ref).strip()
    if re.match(r"^(?:id)?\d{6,12}$", ref):
        return int(ref.lstrip("id")), None
    apps = find_apps(src, ref, 10)
    if not apps:
        raise ScoutError("no App Store app found for %r" % ref, 1)
    low = ref.lower()
    named = [a for a in apps if low in a["app_name"].lower()]
    if not named:
        raise ScoutError("no app named %r in the search; use its id: %s" % (
            ref, ", ".join("%s (%s)" % (a["app_name"], a["app_id"]) for a in apps[:3])), 1)
    pick = max(named, key=lambda a: a["ratings"] or 0)
    return pick["app_id"], pick


def parse_feed(doc):
    """The customer-reviews RSS (JSON flavour) -> [{id, date, stars, title, text, version, votes}]."""
    feed = (doc or {}).get("feed") or {}
    entries = feed.get("entry") or []
    if isinstance(entries, dict):
        entries = [entries]
    out = []
    for e in entries:
        if not isinstance(e, dict) or "im:rating" not in e:
            continue        # older feeds put the app itself first
        lab = lambda k: ((e.get(k) or {}).get("label") or "")
        try:
            stars = int(lab("im:rating"))
        except ValueError:
            continue
        updated = lab("updated")
        out.append({"id": lab("id"), "date": updated[:10], "updated": updated, "stars": stars,
                    "title": lab("title"), "text": lab("content"), "version": lab("im:version"),
                    "votes": int(lab("im:voteSum") or 0) if lab("im:voteSum").lstrip("-").isdigit() else 0})
    return out


def fetch_reviews(src, app_id, pages=MAX_PAGES):
    if pages < 1 or pages > MAX_PAGES:
        raise ScoutError("--pages is 1 to %d (the feed stops at 10 pages of 50: the 500 most recent)" % MAX_PAGES)
    seen, out, read = set(), [], 0
    for n in range(1, pages + 1):
        rows = parse_feed(src.page(app_id, n))
        if not rows:
            break
        read = n
        for r in rows:
            if r["id"] and r["id"] in seen:
                continue
            seen.add(r["id"])
            out.append(r)
    return out, read


def load_app(src, ref, pages=MAX_PAGES, seed_dir=None, today=None):
    """The reviews document for one app: saved in seed/reviews/, else offline or live."""
    app_id, picked = resolve(src, ref)
    saved = os.path.join(seed_dir, "reviews", "%d.json" % app_id) if seed_dir else None
    if saved and os.path.isfile(saved) and not src.offline:
        return read_json(saved, "reviews"), False
    info = picked
    look = src.lookup(app_id)
    if look and look.get("results"):
        info = app_row(look["results"][0])
    reviews, read = fetch_reviews(src, app_id, pages)
    if not reviews:
        raise ScoutError("no reviews for app %d (a wrong id, or an app with no reviews in this country)" % app_id, 1)
    info = info or {"app_id": app_id, "app_name": str(app_id), "name": str(app_id), "rating": None, "ratings": None}
    doc = {"created_by": "seed-scout", "app_id": app_id, "name": info["name"], "app_name": info["app_name"],
           "seller": info.get("seller"), "rating": info.get("rating"), "ratings": info.get("ratings"),
           "country": src.country, "fetched": (today or datetime.date.today()).isoformat(), "pages": read,
           "source": RSS % (src.country, 1, app_id) + (" (pages 1-%d)" % read if read > 1 else ""),
           "reviews": reviews}
    return doc, True


# ---------------------------------------------------------------- themes

def load_rules(path=None):
    rules = [(k, label, [re.compile(p, re.I) for p in pats]) for k, label, pats in THEMES]
    if not path:
        return rules
    doc = read_json(path, "rules file")
    if not isinstance(doc, dict) or not doc:
        raise ScoutError("%s wants {\"key\": {\"label\": \"...\", \"patterns\": [\"regex\", ...]}}" % path)
    keys = [k for k, _, _ in rules]
    for k, v in doc.items():
        if not isinstance(v, dict) or not v.get("patterns"):
            raise ScoutError("rules %r needs a list of patterns" % k)
        try:
            pats = [re.compile(p, re.I) for p in v["patterns"]]
        except re.error as e:
            raise ScoutError("rules %r has a bad pattern: %s" % (k, e))
        row = (k, v.get("label") or k, pats)
        if k in keys:
            rules[keys.index(k)] = row
        else:
            rules.append(row)
    return rules


def norm_text(r):
    t = "%s %s" % (r.get("title") or "", r.get("text") or "")
    return t.replace("’", "'").replace("‘", "'")


def theme_counts(reviews, rules, max_stars=2):
    """{counts, low, read, matches{key: [reviews]}, unthemed} over the reviews with <= max_stars."""
    low = [r for r in reviews if r.get("stars") is not None and int(r["stars"]) <= max_stars]
    counts = dict((k, 0) for k, _, _ in rules)
    matches = dict((k, []) for k, _, _ in rules)
    unthemed = 0
    for r in low:
        t = norm_text(r)
        hit = False
        for k, _, pats in rules:
            if any(p.search(t) for p in pats):
                counts[k] += 1
                matches[k].append(r)
                hit = True
        if not hit:
            unthemed += 1
    return {"counts": counts, "low": len(low), "read": len(reviews), "matches": matches, "unthemed": unthemed}


def most_mentioned(counts, order):
    best = None
    for k in order:
        if best is None or counts[k] > counts[best]:
            best = k
    return best if best is not None and counts[best] > 0 else None


def examples_of(rows, n=EXAMPLES):
    rows = sorted(rows, key=lambda r: (r.get("updated") or r.get("date") or "", r.get("id") or ""), reverse=True)
    return [{"title": r.get("title") or "", "date": r.get("date"), "stars": int(r["stars"])} for r in rows[:n]]


def weak_points(stats, order, by="gap"):
    """stats: [{counts, low}] per app -> [(theme, rule, gap_pp)] per app."""
    out = []
    for i, s in enumerate(stats):
        top = most_mentioned(s["counts"], order)
        if by == "count" or len(stats) < 2 or not s["low"]:
            out.append((top, "most mentioned", None))
            continue
        others_low = sum(o["low"] for j, o in enumerate(stats) if j != i)
        best, best_gap = None, None
        for k in order:
            n = s["counts"][k]
            if n < 2 or pct(n, s["low"]) < MIN_SHARE:
                continue
            other = sum(o["counts"].get(k, 0) for j, o in enumerate(stats) if j != i)
            gap = 100.0 * n / s["low"] - (100.0 * other / others_low if others_low else 0.0)
            if best is None or gap > best_gap + 1e-9 or (abs(gap - best_gap) <= 1e-9 and n > s["counts"][best]):
                best, best_gap = k, gap
        if best is None or best_gap <= 0:
            out.append((top, "most mentioned", None))
        else:
            out.append((best, "sets it apart", round(best_gap, 1)))
    return out


def label_of(rules, key):
    for k, label, _ in rules:
        if k == key:
            return label
    return key


def app_summary(doc, rules, max_stars=2):
    st = theme_counts(doc["reviews"], rules, max_stars)
    dates = sorted(r["date"] for r in doc["reviews"] if r.get("date"))
    st.update({"app_id": doc["app_id"], "name": doc.get("name"), "app_name": doc.get("app_name"),
               "rating": doc.get("rating"), "ratings": doc.get("ratings"), "source": doc.get("source"),
               "first": dates[0] if dates else None, "last": dates[-1] if dates else None,
               "fetched": doc.get("fetched")})
    return st


def build_competitors(docs, rules, max_stars=2, by="gap", today=None):
    order = [k for k, _, _ in rules]
    stats = [app_summary(d, rules, max_stars) for d in docs]
    weak = weak_points(stats, order, by)
    apps = []
    for s, (key, rule, gap) in zip(stats, weak):
        row = {"name": s["name"], "app_name": s["app_name"], "app_id": s["app_id"], "rating": s["rating"],
               "ratings": s["ratings"], "reviews_read": s["read"], "low_reviews": s["low"],
               "themes": s["counts"], "top_theme": key, "weak_point": label_of(rules, key) if key else None,
               "weak_point_count": s["counts"][key] if key else 0,
               "weak_point_share": pct(s["counts"][key], s["low"]) if key else 0.0,
               "weak_point_rule": rule, "gap_points": gap, "most_mentioned": most_mentioned(s["counts"], order),
               "weak_point_line": ("%d of %d recent %s reviews mention %s" % (
                   s["counts"][key], s["low"], "1-star" if max_stars == 1 else "1-%d star" % max_stars,
                   label_of(rules, key))) if key else "no theme matched",
               "examples": examples_of(s["matches"][key]) if key else [],
               "reviews_from": s["first"], "reviews_to": s["last"], "fetched": s["fetched"], "source": s["source"]}
        apps.append(row)
    return {"created_by": "seed-scout", "generated": (today or datetime.date.today()).isoformat(),
            "low_stars": max_stars, "weak_point_by": "count" if (by == "count" or len(docs) < 2) else "gap",
            "theme_labels": dict((k, label) for k, label, _ in rules), "apps": apps}


# ---------------------------------------------------------------- printing

def fmt_int(n):
    return "{:,}".format(n) if isinstance(n, int) else "?"


def print_themes(s, rules, max_stars, n_examples=EXAMPLES):
    name = s["app_name"] or s["name"]
    print("%s (%s): %d of the %d most recent reviews are %s (%s to %s)" % (
        name, s["app_id"], s["low"], s["read"], "1 star" if max_stars == 1 else "1 or %d stars" % max_stars,
        nice_date(s["first"] or ""), nice_date(s["last"] or "")))
    if s["rating"] is not None:
        print("  App Store: %.1f stars from %s ratings" % (s["rating"], fmt_int(s["ratings"])))
    order = [k for k, _, _ in rules]
    ranked = sorted(order, key=lambda k: (-s["counts"][k], order.index(k)))
    print("  %-28s %14s %7s" % ("theme", "low reviews", "share"))
    for k in ranked:
        print("  %-28s %7d of %-4d %6.1f%%" % (label_of(rules, k), s["counts"][k], s["low"], pct(s["counts"][k], s["low"])))
    print("  %-28s %7d of %-4d %6.1f%%" % ("(no theme)", s["unthemed"], s["low"], pct(s["unthemed"], s["low"])))
    top = most_mentioned(s["counts"], order)
    if top:
        print("Most mentioned: %s, %d of %d low reviews." % (label_of(rules, top), s["counts"][top], s["low"]))
        print("Examples (%s, newest first):" % label_of(rules, top))
        for ex in examples_of(s["matches"][top], n_examples):
            print("  %-12s %d star%s  \"%s\"" % (nice_date(ex["date"]), ex["stars"], "" if ex["stars"] == 1 else "s",
                                               ex["title"]))
    print("A review can mention several themes. Read the examples before you quote a theme.")


def print_compare(doc):
    print("Competitors: their most recent App Store reviews, %s only" % (
        "1-star" if doc["low_stars"] == 1 else "1-%d star" % doc["low_stars"]))
    print("  %-14s %6s %10s %9s   %-27s %s" % ("app", "rating", "ratings", "low/read", "weak point", "evidence"))
    for a in doc["apps"]:
        print("  %-14s %6s %10s %9s   %-27s %d of %d (%.1f%%)" % (
            a["name"][:14], "%.1f" % a["rating"] if a["rating"] is not None else "?", fmt_int(a["ratings"]),
            "%d/%d" % (a["low_reviews"], a["reviews_read"]), a["weak_point"] or "none",
            a["weak_point_count"], a["low_reviews"], a["weak_point_share"]))
    if doc["weak_point_by"] == "gap":
        print("Weak point = the complaint that sets each app apart: its share of low reviews minus the others'.")
    else:
        print("Weak point = the most mentioned complaint.")
    for a in doc["apps"]:
        mm = a.get("most_mentioned")
        if mm and mm != a["top_theme"]:
            print("  %s: the most mentioned is %s (%d of %d), but the other apps get it about as often." % (
                a["name"], doc["theme_labels"].get(mm, mm), a["themes"][mm], a["low_reviews"]))
        for ex in a["examples"]:
            print("  %s  %-12s %d star%s  \"%s\"" % (a["name"][:10], nice_date(ex["date"]), ex["stars"],
                                                   "" if ex["stars"] == 1 else "s", ex["title"]))


# ---------------------------------------------------------------- commands

def seed_dir(a):
    return a.dir or "seed"


def cmd_find(a):
    src = Source(a.offline, country=a.country)
    apps = find_apps(src, a.term, a.limit)
    if a.json:
        print(json.dumps({"term": a.term, "apps": apps}, indent=2, ensure_ascii=False))
        return 0 if apps else 1
    if not apps:
        print("No App Store apps for %r. Try the words a customer would type." % a.term)
        return 1
    print("App Store search %r (%s), in the store's own order:" % (a.term, a.country.upper()))
    print("  %-11s %-34s %6s %10s  %s" % ("app id", "app", "rating", "ratings", "seller"))
    for x in apps:
        print("  %-11s %-34s %6s %10s  %s" % (x["app_id"], x["app_name"][:34],
                                              "%.1f" % x["rating"] if x["rating"] is not None else "?",
                                              fmt_int(x["ratings"]), x["seller"] or ""))
    print("Next: scout.py reviews APP_ID --write for the ones that are real rivals (most ratings first).")
    return 0


def cmd_reviews(a):
    src = Source(a.offline, country=a.country)
    doc, _ = load_app(src, a.app, a.pages, None, today_of(a.today))
    lows = [r for r in doc["reviews"] if r["stars"] <= 2]
    stars = dict((s, sum(1 for r in doc["reviews"] if r["stars"] == s)) for s in range(1, 6))
    dates = sorted(r["date"] for r in doc["reviews"])
    if a.json:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
    else:
        print("%s (%s): read %d reviews, the most recent first (%d page%s), %s to %s" % (
            doc["app_name"], doc["app_id"], len(doc["reviews"]), doc["pages"], "" if doc["pages"] == 1 else "s",
            nice_date(dates[0]), nice_date(dates[-1])))
        if doc["rating"] is not None:
            print("  App Store: %.1f stars from %s ratings" % (doc["rating"], fmt_int(doc["ratings"])))
        print("  Stars: " + "  ".join("%d: %d" % (s, stars[s]) for s in (5, 4, 3, 2, 1)))
        print("  1-2 star reviews: %d of %d" % (len(lows), len(doc["reviews"])))
    if a.write:
        path = os.path.join(seed_dir(a), "reviews", "%d.json" % doc["app_id"])
        write_json(path, doc)
        if not a.json:
            print("Wrote %s." % path)
    if not a.json:
        print("Next: scout.py themes %s, then scout.py compare with the other rivals." % doc["app_id"])
    return 0


def docs_for(a, refs):
    src = Source(a.offline, country=a.country)
    docs = []
    for ref in refs:
        if os.path.isfile(ref):
            docs.append(read_json(ref, "reviews file"))
            continue
        doc, fetched = load_app(src, ref, a.pages, seed_dir(a), today_of(a.today))
        if fetched and a.write:
            write_json(os.path.join(seed_dir(a), "reviews", "%d.json" % doc["app_id"]), doc)
        docs.append(doc)
    ids = [d["app_id"] for d in docs]
    if len(set(ids)) != len(ids):
        raise ScoutError("the same app is in the list twice")
    return docs


def check_stars(n):
    if n not in (1, 2, 3):
        raise ScoutError("--stars is 1, 2 or 3 (the low reviews are the ones at or under it)")
    return n


def cmd_themes(a):
    rules = load_rules(a.rules)
    docs = docs_for(a, [a.app])
    s = app_summary(docs[0], rules, check_stars(a.stars))
    if a.json:
        order = [k for k, _, _ in rules]
        top = most_mentioned(s["counts"], order)
        print(json.dumps({"app_id": s["app_id"], "name": s["name"], "reviews_read": s["read"],
                          "low_reviews": s["low"], "themes": s["counts"], "unthemed": s["unthemed"],
                          "most_mentioned": top, "examples": examples_of(s["matches"][top]) if top else []},
                         indent=2, ensure_ascii=False))
        return 0
    if not s["low"]:
        print("%s has no reviews at %d stars or under among the %d read." % (s["app_name"], a.stars, s["read"]))
        return 1
    print_themes(s, rules, a.stars, a.examples)
    return 0


def cmd_compare(a):
    rules = load_rules(a.rules)
    docs = docs_for(a, a.apps)
    doc = build_competitors(docs, rules, check_stars(a.stars), a.by, today_of(a.today))
    path = os.path.join(seed_dir(a), "competitors.json")
    if a.write and os.path.isfile(path):
        old = read_json(path, "competitors")
        notes = dict((x.get("app_id"), x.get("pricing")) for x in old.get("apps") or [] if x.get("pricing"))
        for x in doc["apps"]:
            if notes.get(x["app_id"]):
                x["pricing"] = notes[x["app_id"]]
    if a.json:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
    else:
        print_compare(doc)
    if a.write:
        write_json(path, doc)
        if not a.json:
            print("Wrote %s." % path)
    if not a.json:
        print("Next: read each rival's pricing page and record it (scout.py pricing), then /seed-market.")
    return 0


def cmd_pricing(a):
    if not re.match(r"^https?://\S+\.\S+", a.source or ""):
        raise ScoutError("--source needs the URL of the page you read (their pricing or help page)", 1)
    if not (a.note or "").strip():
        raise ScoutError("--note needs what the page says, in a sentence", 1)
    path = os.path.join(seed_dir(a), "competitors.json")
    doc = read_json(path, "competitors.json (run scout.py compare --write first)")
    ref = str(a.app).strip().lower()
    hit = [x for x in doc.get("apps") or [] if str(x.get("app_id")) == ref or (x.get("name") or "").lower() == ref]
    if not hit:
        raise ScoutError("%s is not in %s" % (a.app, path), 1)
    entry = {"note": a.note.strip(), "source": a.source, "read": today_of(a.today).isoformat()}
    hit[0].setdefault("pricing", []).append(entry)
    print("%s pricing: %s (%s)" % (hit[0]["name"], entry["note"], entry["source"]))
    if a.write:
        write_json(path, doc)
        print("Wrote %s." % path)
    else:
        print("Not saved: add --write.")
    return 0


def cmd_show(a):
    path = os.path.join(seed_dir(a), "competitors.json")
    if not os.path.isfile(path):
        print("No %s yet. Run: scout.py compare APP_ID APP_ID --write" % path)
        return 1
    doc = read_json(path, "competitors")
    if a.json:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
        return 0
    print_compare(doc)
    for x in doc.get("apps") or []:
        for p in x.get("pricing") or []:
            print("  %s pricing: %s (%s)" % (x["name"], p["note"], p["source"]))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Competitor Scout (seed-scout): your rivals' weak points, from their reviews.")
    sub = ap.add_subparsers(dest="cmd")

    def common(p, net=True):
        p.add_argument("--dir", help="the seed folder (default ./seed)")
        p.add_argument("--json", action="store_true")
        p.add_argument("--today", help="YYYY-MM-DD for the dates written (default: today)")
        if net:
            p.add_argument("--offline", metavar="DIR", help="saved App Store responses instead of the network")
            p.add_argument("--country", default="us", help="App Store country (default us)")

    p = sub.add_parser("find", help="search the App Store for apps like yours")
    p.add_argument("term")
    p.add_argument("--limit", type=int, default=10)
    common(p)
    p = sub.add_parser("reviews", help="read an app's most recent reviews")
    p.add_argument("app", help="App Store id (547320928) or a name")
    p.add_argument("--pages", type=int, default=MAX_PAGES, help="pages of 50, 1 to 10 (default 10)")
    p.add_argument("--write", action="store_true", help="save to seed/reviews/<app_id>.json")
    common(p)
    p = sub.add_parser("themes", help="what the low reviews complain about")
    p.add_argument("app", help="App Store id, name, or a saved reviews file")
    p.add_argument("--pages", type=int, default=MAX_PAGES)
    p.add_argument("--stars", type=int, default=2, help="low = at or under this many stars (default 2)")
    p.add_argument("--examples", type=int, default=EXAMPLES)
    p.add_argument("--rules", help="a JSON file of extra or replacement themes")
    p.add_argument("--write", action="store_true", help="save the reviews it had to fetch")
    common(p)
    p = sub.add_parser("compare", help="the weak point of each rival -> seed/competitors.json")
    p.add_argument("apps", nargs="+")
    p.add_argument("--pages", type=int, default=MAX_PAGES)
    p.add_argument("--stars", type=int, default=2)
    p.add_argument("--by", choices=["gap", "count"], default="gap",
                   help="gap: what sets each app apart (default); count: the most mentioned")
    p.add_argument("--rules")
    p.add_argument("--write", action="store_true")
    common(p)
    p = sub.add_parser("pricing", help="record what a rival's pricing page says, with its URL")
    p.add_argument("app", help="app id or short name in competitors.json")
    p.add_argument("--note", required=True)
    p.add_argument("--source", required=True, help="the URL you read")
    p.add_argument("--write", action="store_true")
    common(p, net=False)
    p = sub.add_parser("show", help="print seed/competitors.json")
    common(p, net=False)
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 2
    if not a.cmd:
        ap.print_help()
        return 2
    try:
        return {"find": cmd_find, "reviews": cmd_reviews, "themes": cmd_themes, "compare": cmd_compare,
                "pricing": cmd_pricing, "show": cmd_show}[a.cmd](a)
    except ScoutError as e:
        print("scout.py: %s" % e, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
