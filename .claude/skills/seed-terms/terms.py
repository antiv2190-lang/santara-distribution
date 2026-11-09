#!/usr/bin/env python3
"""Term Sheet Reader for seed-terms. Standard library only, no network.

It does the math investors do before they send a SAFE or a term sheet, and
reads the document for the clauses founders regret. Not legal advice and not
investment advice: have a startup lawyer read anything before you sign it.

    python3 terms.py safe --investment 500k --cap 10m                     # 5.00% at the cap
    python3 terms.py safe --investment 500k --cap 10m --other 1m@10m      # with the rest of the round
    python3 terms.py safe --investment 500k --cap 10m --discount 20 --round-pre 24m --round-raise 6m --pool 10
    python3 terms.py round --pre 6m --raise 1.5m --pool 10 --shares 7000000     # the option-pool shuffle
    python3 terms.py round --pre 24m --raise 6m --pool 10 --safe Northlight=500k@10m --safe 1m@10m:20
    python3 terms.py scan term-sheet.txt                                   # the traps, each with a question
    ... add --write to save seed/terms/safe.json, seed/terms/round.json or seed/terms/scan-<name>.md

The SAFE math is the post-money SAFE (Y Combinator's standard form):
  ownership at the cap = investment / post-money valuation cap. The SAFE
  converts at the lower of the cap price (cap / company capitalization, which
  counts every share, option, the unissued pool and every converting SAFE,
  but not the new money or a pool top-up made for the round) and the
  discount price (the round's price x (1 - discount)). Uncapped, no-discount
  SAFEs convert at the round's price.

The priced round: price per share = pre-money / fully diluted pre-money
shares, where the pre-money count includes the converted SAFEs and the new
option pool. That is the option-pool shuffle: the pool is carved out before
the new money comes in, so it dilutes the existing holders only. The pool
target is the unissued pool as a share of the fully diluted post-money
count. Shares are rounded down to whole shares; real documents round the
price per share first, so expect a few shares of difference.

Amounts: 500k, 1.5m, $1,500,000. Percentages: 20 or 20%. A SAFE: [name=]
investment[@cap][:discount], e.g. 500k@10m, 250k@8m:20, 100k@:20.

scan flags (severity high / medium / low, with a plain-English note and a
question for the lawyer): liquidation preference over 1x, participating
preferred, full-ratchet anti-dilution, redemption rights, cumulative
dividends, board control, protective provisions and vetoes, pay-to-play,
drag-along, a no-shop over 30 days, an exploding deadline, a founder vesting
reset, super pro rata, MFN, and a new option pool in the pre-money. The
standard versions it recognises are listed as standard.

Exit codes: 0 done (scan: no high-severity flag), 1 refused or an error,
3 scan found at least one high-severity flag.
"""

import argparse
import json
import os
import re
import sys
from fractions import Fraction

NOTE = ("Not legal advice and not investment advice: a startup lawyer should read the documents before you sign. "
        "The numbers are only as good as the inputs.")
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2, "standard": 3}


class TermsError(Exception):
    pass


# ------------------------------------------------------------ inputs

def parse_money(text, what):
    s = str(text).strip().lower().replace(",", "").replace("$", "").replace(" ", "")
    m = re.match(r"^(\d+(?:\.\d+)?)([kmb]?)$", s)
    if not m:
        raise TermsError("%s wants an amount like 500k, 1.5m or 1500000, got %r" % (what, text))
    v = Fraction(m.group(1)) * {"": 1, "k": 1000, "m": 10 ** 6, "b": 10 ** 9}[m.group(2)]
    if v <= 0:
        raise TermsError("%s must be more than zero" % what)
    return v


def parse_pct(text, what, top=Fraction(99, 100)):
    s = str(text).strip()
    pct = s.endswith("%")
    m = re.match(r"^(\d+(?:\.\d+)?)%?$", s)
    if not m:
        raise TermsError("%s wants a percentage like 20 or 20%%, got %r" % (what, text))
    v = Fraction(m.group(1))
    if 0 < v < 1 and not pct:
        raise TermsError("%s: write 20 for 20%% (got %s)" % (what, s))
    v /= 100
    if not 0 <= v <= top:
        raise TermsError("%s must be between 0 and %d%%" % (what, int(top * 100)))
    return v


def parse_shares(text, what):
    s = str(text).strip().replace(",", "").replace("_", "")
    if not re.match(r"^\d+$", s):
        raise TermsError("%s wants a whole number of shares, got %r" % (what, text))
    return int(s)


def parse_safe(text):
    m = re.match(r"^(?:(?P<name>[^=@:]+)=)?(?P<inv>[^@:]+)(?:@(?P<cap>[^:]*))?(?::(?P<disc>.+))?$", str(text).strip())
    if not m:
        raise TermsError("a SAFE looks like [name=]investment[@cap][:discount], e.g. 500k@10m or 250k@8m:20, "
                         "got %r" % text)
    return make_safe(m.group("name"), m.group("inv"), m.group("cap") or None, m.group("disc"))


def make_safe(name, inv, cap=None, disc=None):
    s = {"name": (name or "").strip() or None, "investment": parse_money(inv, "SAFE investment"),
         "cap": parse_money(cap, "SAFE cap") if cap not in (None, "") else None,
         "discount": parse_pct(disc, "SAFE discount", Fraction(1, 2)) if disc not in (None, "") else Fraction(0)}
    if s["cap"] is not None and s["cap"] <= s["investment"]:
        raise TermsError("a %s cap with a %s investment would hand over the whole company: the post-money cap must "
                         "be bigger than the investment" % (money(s["cap"]), money(s["investment"])))
    return s


# ------------------------------------------------------------ formatting

def money(v):
    return "$" + "{:,.0f}".format(float(v)) if v == int(v) else "$" + "{:,.2f}".format(float(v))


def short(v):
    x = float(v)
    for unit, div in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if x >= div:
            return "$%s%s" % (("%.2f" % (x / div)).rstrip("0").rstrip("."), unit)
    return money(v)


def pct(v):
    return "%.2f%%" % (float(v) * 100)


def price(v):
    return "$%.4f" % float(v)


def whole(v):
    return "{:,}".format(int(v))


def floor_shares(v):
    return int(v // 1)


# ------------------------------------------------------------ the math

def safe_ownership(safes):
    """Post-money SAFEs before a priced round: each capped SAFE owns investment / cap of the company once it
    converts. Returns (rows, total). Uncapped SAFEs need a round price."""
    for s in safes:
        if s["cap"] is None:
            raise TermsError("%s has no cap, so what it owns depends on the next round's price: add --round-pre and "
                             "--round-raise" % (s["name"] or "a SAFE"))
    rows = [(s, s["investment"] / s["cap"]) for s in safes]
    total = sum(r for _, r in rows)
    if total >= 1:
        raise TermsError("these SAFEs would own %s of the company: that leaves nothing for you" % pct(total))
    return rows, total


def solve_round(S, U, safes, V, N, P):
    """Exact (Fraction) priced round with converting post-money SAFEs and the option-pool shuffle.

    S  fully diluted shares before the round, SAFEs not counted (common, issued options, unissued pool)
    U  the unissued pool inside S
    V  pre-money valuation (fully diluted: it includes the converted SAFEs and the new pool)
    N  new money, P  the unissued pool target after the round, as a share of the post-money count

    The unknowns are F (fully diluted pre-money shares), K (the SAFEs' company capitalization: F without the
    pool top-up) and which SAFEs convert at the cap. With R = sum(investment / cap) over the SAFEs at the cap
    and D = sum(investment / (V x (1 - discount))) over the rest:
        K (1 - R) = S + D F            (the SAFEs' own shares are part of K)
        F = K + top-up,  top-up = P F (V + N) / V - U   (or 0 if the existing pool already covers P)
    """
    at_cap = [s["cap"] is not None for s in safes]
    for _ in range(2 ** len(safes) + 2):
        R = sum((s["investment"] / s["cap"] for s, c in zip(safes, at_cap) if c), Fraction(0))
        D = sum((s["investment"] / (V * (1 - s["discount"])) for s, c in zip(safes, at_cap) if not c), Fraction(0))
        if R >= 1:
            raise TermsError("the SAFEs' caps add up to %s of the company" % pct(R))
        a = 1 - P * (V + N) / V
        den = a - D / (1 - R)
        if den <= 0:
            raise TermsError("a %s pool and these SAFEs leave nothing for the existing holders" % pct(P))
        F = (Fraction(S) / (1 - R) - U) / den
        K = (S + D * F) / (1 - R)
        top = F - K
        if top < 0 or P == 0:
            if 1 - R - D <= 0:
                raise TermsError("these SAFEs leave nothing for the existing holders")
            F = Fraction(S) / (1 - R - D)
            K, top = F, Fraction(0)
        pps = V / F
        new = [s["cap"] is not None and s["cap"] / K <= pps * (1 - s["discount"]) for s in safes]
        if new == at_cap:
            break
        at_cap = new
    else:
        raise TermsError("the SAFE conversion did not settle; check the inputs")
    conv = []
    for s, c in zip(safes, at_cap):
        cap_price = s["cap"] / K if s["cap"] is not None else None
        disc_price = pps * (1 - s["discount"])
        p = cap_price if c else disc_price
        conv.append(dict(s, cap_price=cap_price, discount_price=disc_price, price=p, via="cap" if c else
                         ("discount" if s["discount"] else "round price"), shares=s["investment"] / p))
    new_shares = N / pps
    return {"pps": pps, "fd_pre": F, "company_cap": K, "pool_topup": top, "new_shares": new_shares,
            "fd_post": F + new_shares, "post_money": V + N, "safes": conv,
            "pool_after": U + top}


def cap_table(holders, U, res, investor="New investors"):
    """Whole-share table: (name, before, after). SAFEs and the new investors have no shares before."""
    rows = [(h["name"], h["shares"], h["shares"]) for h in holders]
    if U or floor_shares(res["pool_topup"]):
        rows.append(("Option pool (unissued)", U, U + floor_shares(res["pool_topup"])))
    for i, s in enumerate(res["safes"], 1):
        rows.append(("SAFE: %s" % (s["name"] or "SAFE %d" % i), None, floor_shares(s["shares"])))
    rows.append((investor, None, floor_shares(res["new_shares"])))
    return rows


def render_table(rows):
    before_total = sum(r[1] or 0 for r in rows)
    after_total = sum(r[2] for r in rows)
    w = max(len(r[0]) for r in rows + [("Total", 0, 0)])
    out = ["  %-*s  %14s %8s  %14s %8s" % (w, "", "before", "", "after", "")]
    for name, b, af in rows:
        bs = ("%14s %8s" % (whole(b), pct(Fraction(b, before_total)) if before_total else "-")) if b is not None \
            else "%14s %8s" % ("-", "-")
        out.append("  %-*s  %s  %14s %8s" % (w, name, bs, whole(af), pct(Fraction(af, after_total))))
    out.append("  %-*s  %14s %8s  %14s %8s" % (w, "Total", whole(before_total), "100.00%", whole(after_total),
                                               "100.00%"))
    return out, before_total, after_total


def holders_from(a):
    if getattr(a, "cap_table", None):
        if not os.path.exists(a.cap_table):
            raise TermsError("no such file: %s" % a.cap_table)
        try:
            with open(a.cap_table, encoding="utf-8") as fh:
                doc = json.load(fh)
        except ValueError as e:
            raise TermsError("%s is not valid JSON: %s" % (a.cap_table, e))
        holders = []
        for h in doc.get("holders") or []:
            if not h.get("name") or not isinstance(h.get("shares"), int) or h["shares"] < 0:
                raise TermsError("%s: every holder needs a name and whole shares" % a.cap_table)
            holders.append({"name": h["name"], "shares": h["shares"]})
        if not holders:
            raise TermsError("%s has no holders" % a.cap_table)
        U = int(doc.get("pool_unissued") or 0)
        safes = [make_safe(s.get("name"), s.get("investment"), s.get("cap"), s.get("discount"))
                 for s in doc.get("safes") or []]
        return holders, U, safes
    S = parse_shares(a.shares, "--shares")
    if S <= 0:
        raise TermsError("--shares must be more than zero")
    return [{"name": "Founders and existing holders", "shares": S}], parse_shares(a.pool_now, "--pool-now"), []


def num(v, places=6):
    return round(float(v), places)


def write_out(a, name, data, text=None):
    folder = os.path.join(a.dir, "terms")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    if text is not None:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    return path


def round_lines(holders, U, safes, V, N, P, res):
    S = sum(h["shares"] for h in holders) + U
    lines = ["Priced round: %s of new money at %s pre-money (%s post-money)" % (money(N), money(V), money(V + N)),
             "  Price per share  %s  (%s / %s fully diluted pre-money shares)" % (price(res["pps"]), money(V),
                                                                                 whole(floor_shares(res["fd_pre"]))),
             "  New shares       %s for the new investors (%s of the company after)"
             % (whole(floor_shares(res["new_shares"])), pct(res["new_shares"] / res["fd_post"]))]
    if P:
        lines.append("  Option pool      %s new shares, so the unissued pool is %s after the round"
                     % (whole(floor_shares(res["pool_topup"])), pct(P)))
    for i, s in enumerate(res["safes"], 1):
        cap = "cap %s a share" % price(s["cap_price"]) if s["cap_price"] is not None else "no cap"
        disc = "discount %s a share" % price(s["discount_price"]) if s["discount"] else "round price %s" % price(res["pps"])
        lines.append("  %s, %s: %s vs %s, converts at the %s: %s shares (%s after)"
                     % (s["name"] or "SAFE %d" % i, money(s["investment"]), cap, disc, s["via"],
                        whole(floor_shares(s["shares"])), pct(s["shares"] / res["fd_post"])))
    lines.append("")
    table, _, _ = render_table(cap_table(holders, U, res))
    lines += table
    lines.append("")
    existing = sum(h["shares"] for h in holders)
    before = Fraction(existing, S)
    after = existing / res["fd_post"]
    if res["pool_topup"]:
        cost = res["pool_topup"] * res["pps"]
        lines.append("The option-pool shuffle: the new pool is counted in the pre-money, so its %s shares (%s at "
                     "the round price) come out of the existing holders' side, not the new investors'. Effective "
                     "pre-money: %s - %s = %s." % (whole(floor_shares(res["pool_topup"])), money(round(cost)),
                                                    money(V), money(round(cost)), money(V - round(cost))))
        lines.append("Ask for the pool to be sized to a real 18-month hiring plan, not a round number.")
    if res["safes"]:
        lines.append("The SAFEs convert into %s shares worth %s at the round price, also inside the pre-money."
                     % (whole(sum(floor_shares(s["shares"]) for s in res["safes"])),
                        money(round(sum(s["shares"] for s in res["safes"]) * res["pps"]))))
    lines.append("Existing holders go from %s to %s (diluted by %s of what they had)."
                 % (pct(before), pct(after), pct(1 - after / before)))
    return lines


def round_json(holders, U, V, N, P, res):
    return {"pre_money": num(V, 2), "new_money": num(N, 2), "post_money": num(V + N, 2), "pool_target": num(P),
            "price_per_share": num(res["pps"]), "fd_pre_money_shares": floor_shares(res["fd_pre"]),
            "pool_topup_shares": floor_shares(res["pool_topup"]), "new_investor_shares": floor_shares(res["new_shares"]),
            "fd_post_money_shares": floor_shares(res["fd_post"]),
            "effective_pre_money": num(V - res["pool_topup"] * res["pps"], 2),
            "safes": [{"name": s["name"], "investment": num(s["investment"], 2),
                       "cap": num(s["cap"], 2) if s["cap"] is not None else None, "discount": num(s["discount"]),
                       "converts_at": s["via"], "price": num(s["price"]), "shares": floor_shares(s["shares"]),
                       "ownership_after": num(s["shares"] / res["fd_post"])} for s in res["safes"]],
            "table": [{"holder": n, "before": b, "after": af} for n, b, af in cap_table(holders, U, res)],
            "note": NOTE}


# ------------------------------------------------------------ commands

def cmd_safe(a):
    mine = make_safe(a.name or "This SAFE", a.investment, a.cap, a.discount)
    others = [parse_safe(x) for x in a.other or []]
    safes = [mine] + others
    out = {"instrument": "post-money SAFE", "safes": [], "note": NOTE}
    lines = ["Post-money SAFE: %s%s%s" % (money(mine["investment"]),
                                          " at a %s post-money cap" % money(mine["cap"]) if mine["cap"] else ", no cap",
                                          ", %s discount" % pct(mine["discount"]) if mine["discount"] else "")]
    if all(s["cap"] is not None for s in safes):
        rows, total = safe_ownership(safes)
        r = rows[0][1]
        lines.append("  At the cap: %s / %s = %s of the company when it converts, before the next round's new "
                     "money and any new option pool dilute everyone." % (money(mine["investment"]),
                                                                        money(mine["cap"]), pct(r)))
        if others:
            lines.append("All SAFEs together: %s for %s:" % (money(sum(s["investment"] for s in safes)), pct(total)))
            for s, own in rows:
                lines.append("  %-14s %s at %s = %s" % (s["name"] or "SAFE", money(s["investment"]),
                                                        short(s["cap"]), pct(own)))
        lines.append("Existing holders keep %s of the company (from 100.00%%) once %s convert%s."
                     % (pct(1 - total), "they" if others else "it", "" if others else "s"))
        lines.append("With post-money caps each SAFE's percentage is fixed, so every SAFE you add dilutes you, not "
                     "the other SAFE holders.")
        out.update({"ownership_at_cap": num(r), "all_safes": num(total), "existing_after_safes": num(1 - total),
                    "safes": [{"name": s["name"], "investment": num(s["investment"], 2), "cap": num(s["cap"], 2),
                               "discount": num(s["discount"]), "ownership_at_cap": num(o)} for s, o in rows]})
    elif not a.round_pre:
        raise TermsError("a SAFE with no cap owns whatever the next round's price gives it: add --round-pre and "
                         "--round-raise to see it")
    if a.round_pre or a.round_raise:
        if not (a.round_pre and a.round_raise):
            raise TermsError("a priced round needs both --round-pre and --round-raise")
        V = parse_money(a.round_pre, "--round-pre")
        N = parse_money(a.round_raise, "--round-raise")
        P = parse_pct(a.pool, "--pool", Fraction(1, 2)) if a.pool else Fraction(0)
        holders, U, _ = holders_from(a)
        res = solve_round(sum(h["shares"] for h in holders) + U, U, safes, V, N, P)
        lines.append("")
        lines += round_lines(holders, U, safes, V, N, P, res)
        out["round"] = round_json(holders, U, V, N, P, res)
    lines.append(NOTE)
    print("\n".join(lines))
    if a.write:
        print("Wrote %s." % write_out(a, "safe.json", out))
    return 0


def cmd_round(a):
    V = parse_money(a.pre, "--pre")
    N = parse_money(a.raise_, "--raise")
    P = parse_pct(a.pool, "--pool", Fraction(1, 2)) if a.pool is not None else Fraction(0)
    holders, U, table_safes = holders_from(a)
    safes = table_safes + [parse_safe(x) for x in a.safe or []]
    res = solve_round(sum(h["shares"] for h in holders) + U, U, safes, V, N, P)
    lines = round_lines(holders, U, safes, V, N, P, res)
    lines.append(NOTE)
    print("\n".join(lines))
    if a.write:
        print("Wrote %s." % write_out(a, "round.json", round_json(holders, U, V, N, P, res)))
    return 0


# ------------------------------------------------------------ the clause scanner

NUMWORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
            "ten": 10, "fourteen": 14, "fifteen": 15, "twenty": 20, "twenty-one": 21, "twenty-four": 24,
            "thirty": 30, "thirty-one": 31, "forty": 40, "forty-five": 45, "forty-eight": 48, "sixty": 60,
            "seventy-two": 72, "ninety": 90, "one hundred twenty": 120}
NUM = r"(\d+(?:\.\d+)?|%s)" % "|".join(sorted((re.escape(k) for k in NUMWORDS), key=len, reverse=True))
HEADING = re.compile(r"^\s*(\d+(\.\d+)*[.)]\s+[A-Z]|[A-Z][A-Za-z0-9 /&'()-]{2,48}:\s)")


def to_num(s):
    s = s.lower()
    return float(NUMWORDS[s]) if s in NUMWORDS else float(s)


def amount_before(unit, text):
    """The number before a unit ('forty-five (45) days', '48 hours', 'two times (2x)'), or None."""
    m = re.search(r"\b%s\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\)\s*)?(?:business\s+|calendar\s+)?%s" % (NUM, unit), text)
    if not m:
        return None
    return float(m.group(2)) if m.group(2) else to_num(m.group(1))


def chunks(text):
    """Clauses: split at blank lines and at lines that start a new heading ('Liquidation Preference: ...')."""
    out, cur = [], []
    for line in text.replace("\r\n", "\n").split("\n"):
        if not line.strip() or (HEADING.match(line) and cur):
            if cur:
                out.append(" ".join(" ".join(cur).split()))
            cur = [line] if line.strip() else []
        else:
            cur.append(line)
    if cur:
        out.append(" ".join(" ".join(cur).split()))
    return [c for c in out if c]


def excerpt(chunk, pattern, width=240):
    """The sentence that triggered the flag; a long one is cut to a window around the trigger."""
    for sentence in re.split(r"(?<=\.)\s+(?=[A-Z(])", chunk) + [chunk]:
        m = re.search(pattern, sentence.lower())
        if not m:
            continue
        if len(sentence) <= width:
            return sentence
        start = max(0, min(m.start() - width // 3, len(sentence) - width))
        out = sentence[start:start + width].strip()
        return ("..." if start else "") + out + ("..." if start + width < len(sentence) else "")
    return chunk[:width]


def finding(key, clause, severity, note, ask, chunk, pattern):
    return {"key": key, "clause": clause, "severity": severity, "note": note, "ask": ask,
            "excerpt": excerpt(chunk, pattern)}


def scan_chunk(c):
    low = c.lower()
    out = []
    pref = re.search(r"liquidation|preference", low)
    if pref:
        m = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:x|×)(?![a-z])", low)
        mult = float(m.group(1)) if m else amount_before(r"times", low)
        if mult is None and re.search(r"original (purchase|issue) price", low) and "liquidation" in low:
            mult = 1.0
        if mult is not None and "liquidation" in low:
            if mult > 1:
                out.append(finding("liquidation_preference", "Liquidation preference %gx" % mult, "high",
                                   "In a sale, the investors take back %g times their money before common holders "
                                   "(you) see a dollar. 1x is the norm at seed." % mult,
                                   "Can we get this to 1x non-participating, and what would %gx leave us in a sale "
                                   "at a modest price?" % mult, c, r"\d\s*x|times|liquidation"))
            else:
                out.append(finding("liquidation_preference", "Liquidation preference 1x", "standard",
                                   "1x: investors get their money back first, then the rest is shared. Standard.",
                                   "", c, r"liquidation"))
        if re.search(r"non[- ]?participating|shall not participate|will not participate|does not participate", low):
            out.append(finding("participating", "Non-participating preferred", "standard",
                               "They take the preference or convert to common, not both. Standard.", "", c,
                               r"participat"))
        elif re.search(r"participat", low) and ("liquidation" in low or "as-converted" in low or "as converted" in low):
            capped = re.search(r"cap(ped)?\s+(at\s+)?(\d+(\.\d+)?)\s*(x|times)|until .{0,40}(\d+(\.\d+)?)\s*(x|times)",
                               low)
            out.append(finding("participating", "Participating preferred%s" % (" (capped)" if capped else ""),
                               "medium" if capped else "high",
                               "They get their money back AND a share of what is left, as if they had converted: "
                               "paid twice in a sale.%s" % (" A cap limits it, but it is still unusual at seed."
                                                            if capped else ""),
                               "Can this be non-participating? If not, how big must a sale be before participation "
                               "stops mattering?", c, r"participat"))
    if "dividend" in low:
        if re.search(r"non[- ]?cumulative", low) or re.search(r"(when|if),? as,? and (if|when) declared", low):
            out.append(finding("dividends", "Non-cumulative dividends", "standard",
                               "Dividends only if the board declares them. Standard.", "", c, r"dividend"))
        elif re.search(r"cumulative|accru", low):
            out.append(finding("dividends", "Cumulative dividends", "high",
                               "A dividend that piles up every year whether or not it is paid, and is owed before "
                               "common holders get anything in a sale.",
                               "Can the dividends be non-cumulative, payable only when declared by the board?", c,
                               r"cumulative|accru"))
    if re.search(r"dilution|ratchet|conversion price", low):
        if re.search(r"full[- ]ratchet", low):
            out.append(finding("anti_dilution", "Full-ratchet anti-dilution", "high",
                               "If you ever raise at a lower price, their price drops all the way to it, however "
                               "few shares are sold. The dilution lands on you.",
                               "Can we use broad-based weighted average anti-dilution instead of full ratchet?", c,
                               r"ratchet"))
        elif re.search(r"narrow[- ]based", low):
            out.append(finding("anti_dilution", "Narrow-based weighted average anti-dilution", "medium",
                               "A weighted average that counts fewer shares, so a down round hits you harder than "
                               "the usual broad-based version.",
                               "Can this be broad-based weighted average?", c, r"narrow"))
        elif re.search(r"broad[- ]based", low):
            out.append(finding("anti_dilution", "Broad-based weighted average anti-dilution", "standard",
                               "The usual protection against a down round. Standard.", "", c, r"broad"))
    if re.search(r"redemption|redeem", low):
        if re.search(r"no redemption|not (be )?redeemable|non[- ]?redeemable|shall not be redeem|redemption( rights)?"
                     r":?\s*none", low):
            out.append(finding("redemption", "No redemption rights", "standard",
                               "Investors cannot force the company to buy their shares back. Standard.", "", c,
                               r"redempt|redeem"))
        else:
            out.append(finding("redemption", "Redemption rights", "high",
                               "After a set time the investors can make the company buy their shares back for "
                               "cash, money a young company rarely has. Rare at seed.",
                               "Can we strike redemption rights? If not, what happens if the company cannot pay?",
                               c, r"redempt|redeem"))
    if "board" in low and re.search(r"director|seat|member|consist|compos", low):
        out += board_findings(c, low)
    if re.search(r"protective provision|veto", low) or (
            re.search(r"(consent|approval|vote) of (the )?(holders of )?(at least )?(a majority|\d+%|"
                      r"[a-z-]+ percent)", low) and re.search(r"preferred|investor|series", low)
            and re.search(r"(shall|will) not|without", low)):
        ops = re.search(r"\b(budget|hir(e|ing)|terminat\w* any employee|salar|compensation|capital expenditure|"
                        r"indebtedness|debt in excess|operating plan|any contract|key employee|change (the|its) "
                        r"business)", low)
        if ops:
            out.append(finding("protective_provisions", "Protective provisions with operating vetoes", "high",
                               "The investors' consent is needed for day-to-day decisions (%s), not just for "
                               "selling the company or issuing new senior shares." % ops.group(0),
                               "Can the vetoes be limited to the standard list (charter changes, new senior "
                               "shares, a sale, dividends) and leave running the business to the board?", c,
                               ops.group(0)))
        else:
            out.append(finding("protective_provisions", "Protective provisions (vetoes)", "low",
                               "The investors can block certain big moves: a sale, new senior shares, charter "
                               "changes. Normal, but know the list.",
                               "Is this the standard list, and does the vote need a majority of the preferred "
                               "together (not each series on its own)?", c, r"protective|consent|veto|approval"))
    if re.search(r"pay[- ]to[- ]play", low):
        out.append(finding("pay_to_play", "Pay-to-play", "medium",
                           "Investors who do not join later rounds lose rights or get converted to common. It "
                           "mostly protects you, but it can make the next round harder to put together.",
                           "Who does this apply to, and what exactly do non-participating investors lose?", c,
                           r"pay[- ]to[- ]play"))
    if re.search(r"drag[- ]?along", low):
        common = re.search(r"common|founder|board", low)
        out.append(finding("drag_along", "Drag-along", "medium" if common else "high",
                           "A big enough group can force everyone, you included, to vote for a sale."
                           + ("" if common else " Here the preferred alone seem to be able to trigger it."),
                           "Who has to approve a drag (the board, the common, the founders)? Is there a minimum "
                           "price, and is it limited to the same price per share for everyone?", c, r"drag"))
    if re.search(r"no[- ]shop|exclusiv", low):
        days = amount_before(r"days?", low)
        if days is None:
            out.append(finding("no_shop", "No-shop with no end date", "medium",
                               "You agree not to talk to other investors, and no end date was found.",
                               "Can the no-shop end after 30 days, and end early if they walk away?", c,
                               r"no[- ]shop|exclusiv"))
        elif days > 30:
            out.append(finding("no_shop", "No-shop of %g days" % days, "high" if days >= 60 else "medium",
                               "%g days of not talking to anyone else gives them time and you no leverage. 30 days "
                               "or less is usual." % days,
                               "Can the no-shop be 30 days, ending early if they walk away?", c, r"no[- ]shop|exclusiv"))
        else:
            out.append(finding("no_shop", "No-shop of %g days" % days, "standard",
                               "30 days or less. Standard.", "", c, r"no[- ]shop|exclusiv"))
    if re.search(r"(offer|term sheet|terms?|proposal)\s+(\w+\s+){0,3}(expire|lapse|terminate|be void|be withdrawn)|"
                 r"exploding|(must|is to) be (signed|accepted|executed) (by|within|no later)|"
                 r"unless (signed|accepted|executed)", low):
        hours = amount_before(r"hours?", low)
        days = amount_before(r"(business\s+)?days?", low)
        if hours is not None and hours <= 48 or days is not None and days <= 2:
            sev, how = "high", "%g hours" % (hours if hours is not None else days * 24)
        elif hours is not None or days is not None and days <= 7:
            sev, how = "medium", "%g %s" % ((hours, "hours") if hours is not None else (days, "days"))
        elif days is not None:
            sev, how = "low", "%g days" % days
        else:
            sev, how = "medium", "a fixed date"
        out.append(finding("exploding", "Exploding deadline (%s)" % how, sev,
                           "A short deadline is pressure to sign before you have shopped the terms or had a lawyer "
                           "read them." if sev != "low" else "A deadline of %s: workable, but the clock runs while "
                           "you compare offers and your lawyer reads it." % how,
                           "Can we have a week or two to review this with counsel and the other investors?", c,
                           r"expire|lapse|exploding|signed|accepted|executed"))
    if re.search(r"vest", low) and re.search(r"founder|common", low) and re.search(
            r"re-?vest|reset|(subject to|become subject to|be subject to) (a )?(new |four[- ]year |4[- ]year |"
            r"forty-eight[- ]month )?vesting|vesting (schedule )?(shall |will )?(commenc\w*|start\w*|begin\w*) (on|at|"
            r"upon|from) (the )?(initial )?closing|(shall|will) be (treated as )?unvested", low):
        credit = re.search(r"credit for|vesting credit|(excluding|except|other than) (shares |any shares )?already "
                           r"vested|time (already )?served", low)
        out.append(finding("vesting_reset", "Founder vesting reset", "medium" if credit else "high",
                           "Shares you already earned go back on a vesting clock that starts at the closing."
                           + (" Some credit for time served is mentioned: check how much." if credit else ""),
                           "Can we keep credit for the time already served (or the part already vested), with "
                           "double-trigger acceleration if we are acquired and let go?", c, r"vest"))
    if re.search(r"super[- ]pro[- ]rata|more than (its|their) pro[- ]rata|(\d+(\.\d+)?|two|three)\s*(x|times) "
                 r"(its|their) pro[- ]rata", low):
        out.append(finding("super_pro_rata", "Super pro rata", "medium",
                           "The right to buy MORE than their share of later rounds. It can crowd out the next lead "
                           "investor.",
                           "Can this be a standard pro rata right, limited to major investors?", c, r"pro[- ]rata"))
    if re.search(r"most[- ]favou?red[- ]nation|\bmfn\b", low):
        out.append(finding("mfn", "Most favored nation (MFN)", "low",
                           "If you later give someone better terms (a lower cap, a bigger discount), this holder "
                           "can take them too. Common in SAFEs; know it before you price the next one.",
                           "Which later terms does the MFN reach, and does it end at the next priced round?", c,
                           r"most[- ]favou?red|mfn"))
    if re.search(r"option pool|equity incentive pool|available pool|stock option plan|unallocated pool", low) and \
            re.search(r"pre[- ]?money", low):
        size = re.search(r"(\d+(?:\.\d+)?)\s*%", low)
        out.append(finding("pool_shuffle", "New option pool in the pre-money%s" % (" (%s%%)" % size.group(1) if size
                                                                                  else ""), "medium",
                           "The pool is counted before the new money, so it dilutes only you: the option-pool "
                           "shuffle. Run terms.py round to see what it costs.",
                           "Can the pool be sized to our real 18-month hiring plan, or counted in the post-money?",
                           c, r"pool"))
    return out


WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}


def _n(s):
    return WORD_NUM.get(s, None) if not s.isdigit() else int(s)


def board_findings(c, low):
    seat = (r"\b(\d|one|two|three|four|five|six|seven)\s*(?:\(\d\)\s*)?(?:(?:directors?|members?|seats?|persons?|"
            r"individuals?)\s+)?(?:shall be |to be |will be |who shall be |who will be )?(?:designated|elected|"
            r"appointed|nominated|chosen|selected)\s+by\s+(?:the\s+)?((?:(?! and )[a-z -]){0,50})")
    inv = fnd = ind = 0
    for m in re.finditer(seat, low):
        n = _n(m.group(1)) or 0
        who = m.group(2)
        if re.search(r"common|founder", who):
            fnd += n
        elif re.search(r"mutual|both|independent|board", who):
            ind += n
        elif re.search(r"investor|preferred|series|lead|purchaser", who):
            inv += n
    for m in re.finditer(r"\b(\d|one|two|three)\s*(?:\(\d\)\s*)?independent", low):
        ind = max(ind, _n(m.group(1)) or 0)
    tm = re.search(r"(?:consist of|comprise|composed of|size of|fixed at)\s+(\d|one|two|three|four|five|six|seven)\b", low)
    total = (_n(tm.group(1)) if tm else 0) or (inv + fnd + ind)
    if not total or not (inv or fnd):
        return [finding("board", "Board composition", "medium",
                        "The board decides most things, including hiring and firing the CEO. The seats could not be "
                        "counted from the text.",
                        "Who designates each seat, and who controls the board after this round?", c, r"board")]
    if inv * 2 > total:
        return [finding("board", "Board control: investors %d of %d seats" % (inv, total), "high",
                        "The investors would hold a majority of the board, so they could replace you as CEO.",
                        "Can the founders keep a majority (or at least parity) at seed, with an independent "
                        "seat chosen by both sides?", c, r"board|director")]
    if inv * 2 == total or (inv + ind) * 2 > total and fnd * 2 <= total:
        return [finding("board", "Board: investors %d, founders %d, independent %d of %d" % (inv, fnd, ind, total),
                        "medium", "The founders do not hold a majority on their own; the independent seat or a tie "
                        "decides.", "Who picks the independent director, and can the founders keep a majority at "
                        "seed?", c, r"board|director")]
    return [finding("board", "Board: founders %d of %d seats" % (fnd, total), "standard",
                    "The founders keep a majority of the board. Standard at seed.", "", c, r"board|director")]


def scan_text(text):
    found, seen = [], set()
    for c in chunks(text):
        for f in scan_chunk(c):
            sig = (f["key"], f["severity"])
            if sig in seen:
                continue
            seen.add(sig)
            found.append(f)
    flagged = {f["key"] for f in found if f["severity"] != "standard"}
    found = [f for f in found if not (f["severity"] == "standard" and f["key"] in flagged)]
    found.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["clause"]))
    return found


def scan_report(name, found):
    flags = [f for f in found if f["severity"] != "standard"]
    count = {s: sum(1 for f in flags if f["severity"] == s) for s in ("high", "medium", "low")}
    lines = ["Term sheet scan: %s" % name,
             "%d flag%s: %d high, %d medium, %d low. %d standard term%s recognised." % (
                 len(flags), "" if len(flags) == 1 else "s", count["high"], count["medium"], count["low"],
                 len(found) - len(flags), "" if len(found) - len(flags) == 1 else "s"),
             NOTE, ""]
    for f in flags:
        lines.append("%-6s %s" % (f["severity"].upper(), f["clause"]))
        lines.append("       \"%s\"" % f["excerpt"])
        lines.append("       What it means: %s" % f["note"])
        lines.append("       Ask your lawyer: \"%s\"" % f["ask"])
        lines.append("")
    std = [f for f in found if f["severity"] == "standard"]
    if std:
        lines.append("Standard: " + "; ".join(f["clause"] for f in std) + ".")
    if not found:
        lines.append("No clause this scanner knows was found. That is not a clean bill of health: read it with a "
                     "lawyer.")
    lines.append("The scanner reads words, not intent: a clause it does not know is not flagged. Read the whole "
                 "document with a startup lawyer before you sign.")
    return lines, count


def cmd_scan(a):
    if not os.path.exists(a.file):
        raise TermsError("no such file: %s" % a.file)
    with open(a.file, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    if not text.strip():
        raise TermsError("%s is empty" % a.file)
    found = scan_text(text)
    name = os.path.basename(a.file)
    lines, count = scan_report(name, found)
    if a.json:
        print(json.dumps({"file": name, "flags": found, "counts": count, "note": NOTE}, indent=2))
    else:
        print("\n".join(lines))
    if a.write:
        stem = re.sub(r"[^a-z0-9]+", "-", os.path.splitext(name)[0].lower()).strip("-") or "document"
        md = ["# Term sheet scan: %s" % name, "", NOTE, ""]
        for f in found:
            if f["severity"] == "standard":
                continue
            md += ["## %s: %s" % (f["severity"].upper(), f["clause"]), "", "> %s" % f["excerpt"], "",
                   "What it means: %s" % f["note"], "", "Ask your lawyer: \"%s\"" % f["ask"], ""]
        std = [f["clause"] for f in found if f["severity"] == "standard"]
        if std:
            md += ["## Standard terms", ""] + ["- %s" % s for s in std] + [""]
        print("Wrote %s." % write_out(a, "scan-%s.md" % stem, None, "\n".join(md)))
    return 3 if count["high"] else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Term Sheet Reader: SAFE and priced-round math, and a clause scanner. "
                                             "Not legal advice.")
    sub = ap.add_subparsers(dest="cmd")

    def common(p):
        p.add_argument("--dir", default="seed", help="the seed folder, for --write (default ./seed)")
        p.add_argument("--write", action="store_true", help="save the result in seed/terms/")

    def shares(p):
        p.add_argument("--shares", default="10000000", help="fully diluted shares before the round, without the "
                       "pool (default 10,000,000; the percentages do not depend on it)")
        p.add_argument("--pool-now", default="0", help="unissued option pool shares today")
        p.add_argument("--cap-table", help="JSON: {\"holders\": [{\"name\", \"shares\"}], \"pool_unissued\", "
                       "\"safes\": [{\"name\", \"investment\", \"cap\", \"discount\"}]}")

    p = sub.add_parser("safe", help="post-money SAFE ownership, and its conversion at a priced round")
    common(p)
    p.add_argument("--investment", required=True)
    p.add_argument("--cap", help="post-money valuation cap")
    p.add_argument("--discount", help="e.g. 20 for 20%%")
    p.add_argument("--name")
    p.add_argument("--other", action="append", help="another SAFE in the round: [name=]amount@cap[:discount]")
    p.add_argument("--round-pre")
    p.add_argument("--round-raise")
    p.add_argument("--pool", help="unissued pool target after the round, e.g. 10")
    shares(p)
    p = sub.add_parser("round", help="a priced round's cap table, with the option-pool shuffle")
    common(p)
    p.add_argument("--pre", required=True, help="pre-money valuation")
    p.add_argument("--raise", dest="raise_", required=True, help="new money")
    p.add_argument("--pool", help="unissued pool target after the round, e.g. 10")
    p.add_argument("--safe", action="append", help="a converting SAFE: [name=]amount@cap[:discount]")
    shares(p)
    p = sub.add_parser("scan", help="flag the clauses to ask a lawyer about")
    common(p)
    p.add_argument("file")
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"safe": cmd_safe, "round": cmd_round, "scan": cmd_scan}[a.cmd](a)
    except TermsError as e:
        print("terms.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
