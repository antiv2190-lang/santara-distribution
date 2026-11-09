#!/usr/bin/env python3
"""The Closer for seed-closer. Standard library only, no network.

It drafts personal outreach to investors, keeps the pipeline, schedules the
follow-ups, sorts the replies and writes the calendar invite. It never sends
an email and never opens an inbox. Claude sends through the USER'S OWN Gmail
connector, and only after the user said yes to that exact batch.

    python3 closer.py draft --top 20               # one .eml per investor, status "drafted"
    python3 closer.py draft --ids maya-chen --dry-run
    python3 closer.py batch                        # the recipients, the first email in full, the batch id
    python3 closer.py approve --batch 3f9a1c2e --reply "yes"   # the user's reply, word for word
    python3 closer.py outbox --json                # exactly what Claude sends: to, subject, body, thread
    python3 closer.py log --id maya-chen --event sent --thread-id 18c2f0a1
    python3 closer.py due --today 2026-10-29       # who gets a follow-up today
    python3 closer.py followup --due --today 2026-10-29
    python3 closer.py inbox --file replies.json --write
    python3 closer.py reply --id maya-chen --body-file answer.txt
    python3 closer.py book --id maya-chen --start "2026-11-05 10:00" --tz America/New_York \\
        --link https://meet.google.com/abc-defg-hij
    python3 closer.py status

Files, all under --dir (default ./seed): config.json and investors.json are
read; pipeline.json, outreach/<id>-<n>.eml and calls/<id>.ics are written.
The template is --template, else seed/template.txt if you made your own,
else template.txt next to this file: the intro and the two follow-ups.

The rules:
  - Every intro has a real personal line (generic, cut-off, duplicated or
    placeholder lines are refused), the sender's real name and the opt-out
    line "Not a fit? Reply 'no' and I won't follow up." Rows without an email
    or a public source are refused.
  - Nothing is sent by this tool. approve records the user's yes for one
    batch, matched by its id (a batch that changed after it was shown cannot
    be approved), and enforces the daily cap (default 20 cold emails a day,
    never more than 50). log --event sent only works on an approved email.
  - At most 3 touches: the intro on day 0, follow-ups on +3 and +7 business
    days (config outreach.followup_days), never sooner than the planned gap
    after the touch before, and never after a reply.
  - A no, an opt-out or a bounce ends that thread for good: no follow-up, no
    new draft, nothing more recorded. "Not now" is a soft pass: it ends the
    follow-ups too.

Statuses: drafted -> approved -> sent -> replied / interested -> booked, and
the three ends: passed, bounced, optout.

Exit codes: 0 done (due: something is due today; batch: a batch is waiting
for a yes), 1 refused, nothing to do, or an error.
"""

import argparse
import datetime
import email
import email.policy
import email.utils
import hashlib
import json
import os
import re
import string
import sys
from email.headerregistry import Address
from email.message import EmailMessage

HERE = os.path.dirname(os.path.abspath(__file__))
OPTOUT = "Not a fit? Reply 'no' and I won't follow up."
DEFAULTS = {"daily_cap": 20, "followup_days": [3, 7], "max_touches": 3, "business_days": True}
MAX_CAP = 50
MAX_TOUCHES = 3
COLD = ("intro", "followup")
TERMINAL = ("passed", "bounced", "optout")
CONVERSATION = ("replied", "interested", "booked")
ALLOWED = {
    None: ("drafted",),
    "drafted": ("drafted", "approved"),
    "approved": ("drafted", "sent"),
    "sent": ("sent", "replied", "interested", "passed", "bounced", "optout"),
    "replied": ("replied", "interested", "booked", "passed", "bounced", "optout"),
    "interested": ("interested", "booked", "passed", "bounced", "optout"),
    "booked": ("booked", "passed", "bounced", "optout"),
    "passed": (), "bounced": (), "optout": (),
}
RANK = {"replied": 1, "interested": 2, "booked": 3}
LABELS = {"interested": "Interested", "question": "Asked a question", "not_now": "Not now", "no": "No",
          "optout": "Opt-out", "bounce": "Bounced", "ooo": "Out of office", "unclear": "Replied"}
NEW_STATUS = {"interested": "interested", "question": "replied", "not_now": "passed", "no": "passed",
              "optout": "optout", "bounce": "bounced", "unclear": "replied"}
EVENT_CLASS = {"interested": "interested", "question": "question", "replied": "unclear", "notnow": "not_now",
               "passed": "no", "no": "no", "optout": "optout", "bounced": "bounce", "ooo": "ooo"}
EVENTS = ("sent", "denied", "note") + tuple(EVENT_CLASS)
DEFAULT_ASK = "would a 20-minute call next week work?"
PERSONAL_DOMAINS = ("gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
                    "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com")
PLACEHOLDER_NAMES = {"your name", "name", "founder", "you", "me", "first last", "firstname lastname",
                     "jane doe", "john doe", "todo", "tbd", "your full name"}
DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
PLACEHOLDER_RE = re.compile(r"[{}\[\]<>]|\b(todo|tbd|xxx|lorem|ipsum|placeholder|insert here)\b", re.I)


class CloserError(Exception):
    pass


# ------------------------------------------------------------ files

def read_json(path, what, required=True):
    if not os.path.exists(path):
        if required:
            raise CloserError("no %s at %s" % (what, path))
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise CloserError("%s is not valid JSON: %s" % (path, e))


def write_json(path, data):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def write_bytes(path, data):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")


# ------------------------------------------------------------ dates and business days

def parse_day(text, what="--today"):
    if isinstance(text, datetime.date):
        return text
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(text or "").strip())
    if not m:
        raise CloserError("%s wants a date like 2026-10-26, got %r" % (what, text))
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        raise CloserError("%s: %s is not a real date" % (what, text))


def get_today(a):
    return parse_day(a.today) if getattr(a, "today", None) else datetime.date.today()


def iso(d):
    return d.isoformat() if d else None


def short_day(d):
    """Mon 2026-10-26"""
    return "%s %s" % (DAY_NAMES[d.weekday()][:3], d.isoformat())


def spoken_day(d):
    """Monday, Oct 26"""
    return "%s, %s %d" % (DAY_NAMES[d.weekday()], MONTHS[d.month - 1][:3], d.day)


def is_workday(d, rules):
    if not rules["business_days"]:
        return True
    return d.weekday() < 5 and d.isoformat() not in rules["holidays"]


def add_days(d, n, rules):
    """n business days after d (weekends and config holidays skipped), or n calendar days."""
    if not rules["business_days"]:
        return d + datetime.timedelta(days=n)
    while n > 0:
        d += datetime.timedelta(days=1)
        if is_workday(d, rules):
            n -= 1
    return d


def next_workday(d, rules):
    while not is_workday(d, rules):
        d += datetime.timedelta(days=1)
    return d


# ------------------------------------------------------------ config

def load_config(seed_dir):
    return read_json(os.path.join(seed_dir, "config.json"),
                     "config (seed-plan writes it: plan.py init, then fill in your details)")


def outreach_rules(cfg):
    o = dict(DEFAULTS)
    o.update((cfg or {}).get("outreach") or {})
    cap = o.get("daily_cap")
    if not isinstance(cap, int) or isinstance(cap, bool) or cap < 1:
        raise CloserError("outreach.daily_cap must be a whole number of emails a day, like 20")
    if cap > MAX_CAP:
        raise CloserError("outreach.daily_cap is %d; the Closer allows at most %d a day. More than that from "
                          "one inbox looks like spam and hurts every email you send." % (cap, MAX_CAP))
    days = o.get("followup_days")
    if (not isinstance(days, list) or any(not isinstance(x, int) or isinstance(x, bool) or x < 1 for x in days)
            or days != sorted(set(days))):
        raise CloserError("outreach.followup_days must be rising whole days after the intro, like [3, 7]")
    touches = o.get("max_touches")
    if not isinstance(touches, int) or isinstance(touches, bool) or not 1 <= touches <= MAX_TOUCHES:
        raise CloserError("outreach.max_touches is %r; it is 1 to %d (the intro and up to two follow-ups)"
                          % (touches, MAX_TOUCHES))
    hol = o.get("holidays") or []
    if not isinstance(hol, list):
        raise CloserError("outreach.holidays must be a list of dates like [\"2026-11-26\"]")
    holidays = set(parse_day(h, "outreach.holidays").isoformat() for h in hol)
    follow = list(days[:touches - 1])
    return {"daily_cap": cap, "followup_days": follow, "max_touches": 1 + len(follow),
            "business_days": bool(o.get("business_days", True)), "holidays": holidays}


def valid_email(addr):
    return bool(EMAIL_RE.match(addr or "")) and ".." not in addr


def personal_mailbox(addr):
    return addr.lower().rsplit("@", 1)[-1] in PERSONAL_DOMAINS


def sender_of(cfg):
    f = (cfg or {}).get("founder") or {}
    name = " ".join(str(f.get("name") or "").split())
    addr = str(f.get("email") or "").strip()
    if not name or name.lower() in PLACEHOLDER_NAMES or PLACEHOLDER_RE.search(name):
        raise CloserError("seed/config.json founder.name is %r: put your real name there. Every email is "
                          "signed by a real person." % name)
    if not valid_email(addr):
        raise CloserError("seed/config.json founder.email must be the address you send from (your own inbox), "
                          "got %r" % addr)
    return {"name": name, "email": addr, "first": name.split()[0],
            "title": " ".join(str(f.get("title") or "Founder").split()),
            "address": " ".join(str(f.get("company_address") or "").split())}


def money_short(v):
    if v is None or v == "":
        return None
    if isinstance(v, str):
        return v.strip()
    x = float(v)
    for unit, div in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if abs(x) >= div:
            return "$%s%s" % (("%.2f" % (x / div)).rstrip("0").rstrip("."), unit)
    return "$%.0f" % x


def sentence_case(text):
    """'A dog-walking app.' -> 'a dog-walking app' (acronyms like 'AI ...' are left alone)."""
    s = str(text or "").strip().rstrip(".")
    first = s.split(" ", 1)[0]
    if first in ("A", "An", "The") or (len(first) > 1 and first[0].isupper() and first[1:].islower()):
        return s[0].lower() + s[1:]
    return s


def base_values(cfg, sender):
    st = (cfg or {}).get("startup") or {}
    name = str(st.get("name") or "").strip()
    one = str(st.get("one_liner") or "").strip()
    if not name or not one:
        raise CloserError("seed/config.json needs startup.name and startup.one_liner for the email")
    sig = "\n".join(x for x in (sender["name"], "%s, %s" % (sender["title"], name), sender["address"]) if x)
    return {"startup": name, "one_liner": one.rstrip("."), "one_liner_sentence": sentence_case(one),
            "tagline": sentence_case(st.get("tagline") or one), "raise": money_short(st.get("raise")),
            "stage": str(st.get("stage") or "seed").strip(), "instrument": st.get("instrument") or None,
            "sector": st.get("sector") or None, "geography": st.get("geography") or None,
            "sender": sender["name"], "sender_first": sender["first"], "title": sender["title"],
            "company_address": sender["address"] or None, "optout": OPTOUT, "signature": sig,
            "extra": "", "ask": DEFAULT_ASK}


# ------------------------------------------------------------ template

SECTION_RE = re.compile(r"^=== *(.+?) *=== *$")
NEEDED = ("intro", "followup 1", "followup 2")
MISSING_WHY = {"raise": "add startup.raise to seed/config.json", "company_address": "add founder.company_address",
               "instrument": "add startup.instrument", "sector": "add startup.sector",
               "geography": "add startup.geography"}


def template_path(a):
    if getattr(a, "template", None):
        return a.template
    mine = os.path.join(a.dir, "template.txt")
    return mine if os.path.exists(mine) else os.path.join(HERE, "template.txt")


def load_template(path):
    if not os.path.exists(path):
        raise CloserError("no template at %s" % path)
    with open(path, encoding="utf-8") as fh:
        text = fh.read().replace("\r\n", "\n")
    sections, name, buf = {}, None, []
    for line in text.split("\n"):
        m = SECTION_RE.match(line)
        if m:
            if name:
                sections[name] = buf
            name, buf = m.group(1).strip().lower(), []
        elif name is not None:
            buf.append(line)
    if name:
        sections[name] = buf
    out = {}
    for n, lines in sections.items():
        while lines and not lines[0].strip():
            lines.pop(0)
        if not lines or not lines[0].lower().startswith("subject:"):
            raise CloserError("template %s: the '%s' section must start with a Subject: line" % (path, n))
        out[n] = (lines[0].split(":", 1)[1].strip(), "\n".join(lines[1:]).strip("\n"))
    for n in NEEDED:
        if n not in out:
            raise CloserError("template %s has no '=== %s ===' section" % (path, n))
    return out


def tidy(text):
    s = "\n".join(line.rstrip() for line in text.split("\n"))
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def fill(text, values, where):
    used = set()
    try:
        parsed = list(string.Formatter().parse(text))
    except ValueError as e:
        raise CloserError("%s: %s (write a literal brace as {{ or }})" % (where, e))
    for _, field, _, _ in parsed:
        if field is not None:
            if not re.match(r"^\w+$", field):
                raise CloserError("%s: {%s} is not a placeholder the Closer knows" % (where, field))
            used.add(field)
    unknown = sorted(f for f in used if f not in values)
    if unknown:
        raise CloserError("%s uses {%s}, which the Closer does not fill. It knows: %s"
                          % (where, unknown[0], ", ".join(sorted(values))))
    empty = sorted(f for f in used if values[f] is None)
    if empty:
        raise CloserError("%s uses {%s} but it is empty: %s"
                          % (where, empty[0], MISSING_WHY.get(empty[0], "fill it in")))
    return tidy(text.format_map(values))


def words(text):
    return len(re.findall(r"\S+", text))


# ------------------------------------------------------------ the personal line

GENERIC = [
    r"hope (this|my|the) (email|e-mail|note|message) finds you",
    r"hope you('re| are) (doing )?(well|good|great)",
    r"hope all is well",
    r"\b(big|huge|long[- ]time|longtime) fan\b",
    r"\bi('m| am) (a|such a) fan\b",
    r"\b(love|loved|admire|admired|respect|appreciate)( all)? (what|the work|your work|everything)\b",
    r"\b(impressive|amazing|great|incredible|stellar|fantastic|strong|awesome) (portfolio|track record|firm|"
    r"fund|work|team|career|background|experience)\b",
    r"\bcame across your (profile|firm|fund|website|name|page|linkedin|work)\b",
    r"\b(found|saw) your (profile|firm|fund|website|name|page) (on|online|and)\b",
    r"\bwanted to (reach out|connect|introduce myself|get in touch)\b",
    r"\bi('m| am) reaching out\b",
    r"\byou('re| are) (a|an|such a) (great|amazing|top|leading|respected|successful|smart|experienced|"
    r"legendary|well[- ]known) (investor|vc|partner|angel)\b",
    r"\byou invest in (startups|companies|founders|great|early[- ]stage|the best)\b",
    r"\bthought leader",
    r"\bi know you('re| are) (busy|swamped)\b",
    r"\b(perfect|great|good) fit for your (fund|firm|portfolio)\b",
    r"\bi think you('d| would) (love|like|be interested|be excited)\b",
    r"\byour (fund|firm|portfolio) (is|looks) (great|amazing|interesting|impressive)\b",
]
STOP = set("a an the and or but so of to in on at for with from by as is are was were be been being it its "
           "this that these those you your yours yourself i me my we our us they them their he she his her "
           "about into over than then just very more most also how what who when why which all any some can "
           "will would should could has have had do does did not no yes one get got make made".split())
SOFT = set("startup startups invest invests invested investing investor investors investment investments fund "
           "funds firm firms venture ventures capital partner partners seed round rounds company companies "
           "founder founders portfolio vc vcs team teams work great space sector industry market markets "
           "thesis focus early stage angel love like".split())
NUMBER_WORDS = {"two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
                "dozen", "twenty", "thirty", "fifty", "hundred", "thousand", "million", "billion"}


def tokens(text):
    out = set()
    for w in re.findall(r"[a-z0-9]+(?:['-][a-z0-9]+)*", str(text).lower().replace("’", "'")):
        out.add(w)
        if "-" in w:
            out.update(w.split("-"))
    return out


def flat_strings(v):
    if isinstance(v, str):
        return [v]
    if isinstance(v, dict):
        return [s for x in v.values() for s in flat_strings(x)]
    if isinstance(v, (list, tuple)):
        return [s for x in v for s in flat_strings(x)]
    return []


def norm_line(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def check_personal_line(line, inv, startup=""):
    """Is this a real personal line for THIS investor? Returns (ok, why)."""
    s = " ".join(str(line or "").split())
    if not s:
        return False, ("no personal_line: write one real sentence about this investor from their public "
                       "record (a deal they led, a post, a talk), with the source in the row")
    if PLACEHOLDER_RE.search(s):
        return False, "the personal line still has a placeholder in it: %r" % s
    if "…" in s or s.endswith("..."):
        return False, "the personal line is cut off (it ends in an ellipsis): finish the sentence"
    n = words(s)
    if n < 7:
        return False, "the personal line is %d words: a real one says what they did and why it matters to you" % n
    if n > 45:
        return False, "the personal line is %d words: keep it to one sentence (45 words at most)" % n
    low = s.lower().replace("’", "'")
    for pat in GENERIC:
        m = re.search(pat, low)
        if m:
            return False, ("the personal line is generic (\"%s\"): it could go to any investor. Say what this "
                           "one actually did, from a source" % m.group(0))
    who = tokens(inv.get("name", "")) | tokens(inv.get("firm", "")) | tokens(startup)
    record = set()
    for field in ("last_relevant_deal", "reasons", "sectors", "geo", "role", "focus", "why", "notes"):
        for text in flat_strings(inv.get(field)):
            record |= tokens(text)
    anchors = (record - STOP - SOFT - who) & tokens(s)
    if anchors:
        return True, "specific: mentions %s from their record" % ", ".join(sorted(anchors)[:3])
    if re.search(r"\d", s) or (tokens(s) & NUMBER_WORDS):
        return True, "specific: has a number"
    for sentence in re.split(r"[.!?;:]\s+", s):
        for w in re.findall(r"[A-Za-z][\w&'.-]*", sentence)[1:]:
            if w[0].isupper() and w.lower().strip(".'") not in who and w not in ("I", "I'm", "I've", "I'd"):
                return True, "specific: names %s" % w.strip(".")
    return False, ("the personal line mentions nothing from this investor's record (a deal, a post, a sector, "
                   "a number): it reads like it could go to anyone")


# ------------------------------------------------------------ .eml

def domain_of(addr):
    return addr.rsplit("@", 1)[-1].lower()


def message_id(rec_id, n, subject, day, sender):
    h = hashlib.sha1(("%s|%d|%s|%s" % (rec_id, n, subject, day)).encode("utf-8")).hexdigest()[:12]
    return "<%s-%d.%s@%s>" % (rec_id, n, h, domain_of(sender["email"]))


def build_eml(sender, to_name, to_email, subject, body, day, mid, in_reply_to=None):
    """A valid RFC 5322 message: CRLF line endings, From / To / Subject / Date / Message-ID, plain text."""
    msg = EmailMessage(policy=email.policy.SMTP)
    msg["From"] = Address(display_name=sender["name"], addr_spec=sender["email"])
    msg["To"] = Address(display_name=to_name, addr_spec=to_email)
    msg["Subject"] = subject
    msg["Date"] = email.utils.format_datetime(datetime.datetime(day.year, day.month, day.day, 13, 0, 0,
                                                                tzinfo=datetime.timezone.utc))
    msg["Message-ID"] = mid
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    text = body.rstrip("\n") + "\n"
    plain = all(ord(c) < 128 for c in text) and max(len(x) for x in text.split("\n")) <= 78
    msg.set_content(text, charset="utf-8", cte="7bit" if plain else "quoted-printable")
    return msg.as_bytes(policy=email.policy.SMTP)


def read_eml(seed_dir, rel):
    path = os.path.join(seed_dir, rel)
    if not os.path.exists(path):
        raise CloserError("the draft %s is missing: run draft (or followup) again" % path)
    with open(path, "rb") as fh:
        data = fh.read()
    return email.message_from_bytes(data, policy=email.policy.default), data


def eml_body(msg):
    return msg.get_content().replace("\r\n", "\n").rstrip("\n")


# ------------------------------------------------------------ pipeline

def pipe_path(seed_dir):
    return os.path.join(seed_dir, "pipeline.json")


def load_pipe(seed_dir):
    doc = read_json(pipe_path(seed_dir), "pipeline", required=False) or {"investors": []}
    if not isinstance(doc.get("investors"), list):
        raise CloserError("%s has no investors list" % pipe_path(seed_dir))
    return doc


def save_pipe(seed_dir, pipe, today):
    pipe["updated"] = today.isoformat()
    write_json(pipe_path(seed_dir), pipe)


def find(pipe, rec_id, required=True):
    for rec in pipe["investors"]:
        if rec.get("id") == rec_id:
            return rec
    if required:
        raise CloserError("%s is not in the pipeline (draft them first)" % rec_id)
    return None


def set_status(rec, new):
    old = rec.get("status")
    if new not in ALLOWED.get(old, ()):
        raise CloserError("%s cannot go from %s to %s" % (rec.get("id"), old or "nothing", new))
    rec["status"] = new


def history(rec, day, event, note=""):
    rec.setdefault("history", []).append({"date": iso(day), "event": event, "note": note})


def out_touches(rec, kinds=None):
    return [t for t in rec.get("touches", []) if t.get("from") == "us" and (kinds is None or t.get("kind") in kinds)]


def in_touches(rec):
    return [t for t in rec.get("touches", []) if t.get("from") == "them"]


def next_due(rec, rules):
    """The day the next follow-up is due, or None (not sent yet, replied, stopped, or all touches used)."""
    if rec.get("status") != "sent" or in_touches(rec):
        return None
    cold = out_touches(rec, COLD)
    offs = rules["followup_days"]
    k = len(cold)
    if not k or k > len(offs):
        return None
    due = add_days(parse_day(cold[0]["date"], "touch date"), offs[k - 1], rules)
    if k >= 2:
        due = max(due, add_days(parse_day(cold[-1]["date"], "touch date"), offs[k - 1] - offs[k - 2], rules))
    if rec.get("hold_until"):
        due = max(due, add_days(parse_day(rec["hold_until"], "hold_until"), 1, rules))
    return due


def add_label(rec, label):
    labels = [x for x in rec.get("labels") or [] if x != label]
    if label != "Out of office":
        labels = [x for x in labels if x != "Out of office"]
    labels.append(label)
    rec["labels"] = labels


def cold_used(pipe, today):
    """Cold emails (intros and follow-ups) sent today plus every approved one not sent yet."""
    n = 0
    for rec in pipe["investors"]:
        n += sum(1 for t in out_touches(rec, COLD) if t.get("date") == today.isoformat())
        d = rec.get("draft")
        if d and d.get("state") == "approved" and d.get("kind") in COLD:
            n += 1
    return n


# ------------------------------------------------------------ draft

def load_investors(seed_dir):
    path = os.path.join(seed_dir, "investors.json")
    doc = read_json(path, "investors file (seed-investors writes it: investors.py rank)")
    rows = doc.get("investors") if isinstance(doc, dict) else doc
    if not isinstance(rows, list):
        raise CloserError("%s has no investors list" % path)
    out = []
    for r in rows:
        if isinstance(r, dict):
            r = dict(r)
            r["id"] = str(r.get("id") or slug(r.get("name")))
            out.append(r)
    return out


def fit_of(r):
    try:
        return float(r.get("fit") or 0)
    except (TypeError, ValueError):
        return 0.0


def row_problem(inv):
    if not ID_RE.match(inv["id"]):
        return "its id %r is not a short lowercase slug like maya-chen" % inv["id"]
    if not str(inv.get("name") or "").strip():
        return "it has no name"
    if not valid_email(str(inv.get("email") or "").strip()):
        return "it has no valid email (add the address they publish, never a guessed one)"
    src = [u for u in inv.get("sources") or [] if re.match(r"^https?://\S+$", str(u))]
    if not src:
        return ("it has no public source URL: the Closer only writes to people found in public sources "
                "(seed-investors keeps the link for every row)")
    return None


def intro_values(base, inv, line):
    v = dict(base)
    name = " ".join(str(inv.get("name")).split())
    v.update({"first_name": str(inv.get("first_name") or name.split()[0]), "name": name,
              "firm": str(inv.get("firm") or name), "personal_line": line,
              "intro_subject": "", "intro_day": ""})
    return v


def cmd_draft(a):
    today = get_today(a)
    cfg = load_config(a.dir)
    rules = outreach_rules(cfg)
    sender = sender_of(cfg)
    base = base_values(cfg, sender)
    tpl = load_template(template_path(a))
    rows = load_investors(a.dir)
    pipe = load_pipe(a.dir)
    by_id = {r["id"]: r for r in rows}
    refused, skipped = [], []
    if a.ids:
        picked = []
        for i in [x.strip() for x in a.ids.split(",") if x.strip()]:
            if i not in by_id:
                raise CloserError("%s is not in investors.json" % i)
            picked.append(by_id[i])
    else:
        picked = []
        for r in sorted(rows, key=lambda r: (-fit_of(r), r["id"])):
            rec = find(pipe, r["id"], required=False)
            if rec and rec.get("status") != "drafted":
                skipped.append(r["id"])
                continue
            if a.min_fit is not None and fit_of(r) < a.min_fit:
                continue
            picked.append(r)
        if a.top:
            picked = picked[:a.top]
    if not picked:
        print("Nobody to draft%s." % (" (%d already in the pipeline)" % len(skipped) if skipped else ""))
        return 1
    blocked = {}
    for rec in pipe["investors"]:
        if rec.get("status") in TERMINAL:
            blocked[str(rec.get("email", "")).lower()] = rec.get("status")
    taken_email = {str(r.get("email", "")).lower(): r["id"] for r in pipe["investors"]}
    taken_line = {norm_line(r.get("personal_line", "")): r["id"] for r in pipe["investors"] if r.get("personal_line")}
    drafted, notes, writes = [], [], []
    for inv in picked:
        rid = inv["id"]
        rec = find(pipe, rid, required=False)
        status = rec.get("status") if rec else None
        if status in TERMINAL:
            refused.append((rid, "the thread is closed for good (%s): never contacted again" % status))
            continue
        if status not in (None, "drafted", "approved"):
            refused.append((rid, "already contacted (status %s): use followup or reply, not a new intro" % status))
            continue
        prob = row_problem(inv)
        if prob:
            refused.append((rid, prob))
            continue
        addr = str(inv["email"]).strip()
        if addr.lower() in blocked:
            refused.append((rid, "%s is on a closed thread (%s): never emailed again" % (addr, blocked[addr.lower()])))
            continue
        if taken_email.get(addr.lower(), rid) != rid:
            refused.append((rid, "%s is already in the pipeline as %s" % (addr, taken_email[addr.lower()])))
            continue
        line = " ".join(str(inv.get("personal_line") or "").split())
        ok, why = check_personal_line(line, inv, base["startup"])
        if not ok:
            refused.append((rid, why))
            continue
        key = norm_line(line)
        if taken_line.get(key, rid) != rid:
            refused.append((rid, "the same personal line is already used for %s: a line written for one person, "
                                 "used twice, is a template" % taken_line[key]))
            continue
        values = intro_values(base, inv, line)
        subject = fill(tpl["intro"][0], values, "template intro subject")
        body = fill(tpl["intro"][1], values, "template intro")
        for must, what in ((line, "{personal_line}"), (OPTOUT, "{optout}"), (sender["name"], "{signature}")):
            if must not in body:
                raise CloserError("the template's intro lost %s: every intro keeps the personal line, the "
                                  "opt-out line and your name" % what)
        mid = message_id(rid, 1, subject, today, sender)
        data = build_eml(sender, values["name"], addr, subject, body, today, mid)
        rel = "outreach/%s-1.eml" % rid
        if status == "approved":
            notes.append("%s: re-drafted, so the earlier yes no longer counts; it needs a new yes" % rid)
        if personal_mailbox(addr):
            notes.append("%s: %s is a personal mailbox; use the work address they publish if there is one"
                         % (rid, addr))
        if words(body.split(OPTOUT)[0]) > 130:
            notes.append("%s: the email is %d words before the opt-out line; under 125 reads best"
                         % (rid, words(body.split(OPTOUT)[0])))
        if len(subject) > 60:
            notes.append("%s: the subject is %d characters; under 60 shows in full on a phone" % (rid, len(subject)))
        if rec is None:
            rec = {"id": rid, "email": addr, "name": values["name"], "firm": values["firm"], "fit": inv.get("fit"),
                   "status": None, "touches": [], "next_due": None, "labels": [], "notes": "",
                   "personal_line": line, "sources": list(inv.get("sources") or []), "thread_id": None,
                   "call": None, "draft": None, "history": []}
            pipe["investors"].append(rec)
        rec.update({"email": addr, "name": values["name"], "firm": values["firm"], "fit": inv.get("fit"),
                    "personal_line": line, "sources": list(inv.get("sources") or [])})
        rec["draft"] = {"n": 1, "kind": "intro", "file": rel, "subject": subject, "message_id": mid,
                        "state": "drafted", "drafted_on": today.isoformat()}
        set_status(rec, "drafted")
        history(rec, today, "drafted", "intro")
        taken_email[addr.lower()] = rid
        taken_line[key] = rid
        writes.append((os.path.join(a.dir, rel), data))
        drafted.append((rec, subject, body))
    if not sender["address"]:
        notes.append("founder.company_address is empty: anti-spam laws such as CAN-SPAM expect a postal address "
                     "in commercial email, and it reads more trustworthy")
    if drafted and not a.dry_run:
        for path, data in writes:
            write_bytes(path, data)
        save_pipe(a.dir, pipe, today)
    verb = "Would draft" if a.dry_run else "Drafted"
    print("%s %d intro%s from %s <%s>, %s. Nothing is sent." % (verb, len(drafted), "" if len(drafted) == 1 else "s",
                                                                sender["name"], sender["email"], short_day(today)))
    for rec, subject, _ in drafted:
        print("  %-18s %s, %s <%s>%s" % (rec["id"], rec["name"], rec["firm"], rec["email"],
                                         "" if a.dry_run else "  -> %s" % os.path.join(a.dir, rec["draft"]["file"])))
    if drafted:
        print("The first one:")
        print("  Subject: %s" % drafted[0][1])
        print("")
        for line in drafted[0][2].split("\n"):
            print(("  " + line).rstrip())
    for rid, why in refused:
        print("REFUSED %s: %s" % (rid, why))
    for n in notes:
        print("note: " + n)
    if skipped and not a.ids:
        print("%d already in the pipeline were left alone." % len(skipped))
    if drafted and not a.dry_run:
        print("Wrote %s. Next: closer.py batch, show it to the user, and wait for a yes." % pipe_path(a.dir))
    return 0 if drafted and not refused else 1


# ------------------------------------------------------------ batch and the yes

YES_WORDS = ("yes", "y")
DOUBT = {"no", "not", "dont", "don't", "wait", "hold", "stop", "cancel", "but", "except", "without", "only",
         "maybe", "later", "tomorrow", "tonight", "if", "unless", "change", "edit", "fix", "after", "before",
         "instead", "remove", "drop", "skip", "minus", "monday", "tuesday", "wednesday", "thursday", "friday",
         "saturday", "sunday"}
COUNT_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
               "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20}
FIRM_SOFT = {"ventures", "venture", "capital", "partners", "partner", "fund", "funds", "seed", "vc", "investor",
             "investors", "angel", "group", "labs", "holdings", "the", "and", "of", "llc", "lp", "inc",
             "management", "advisors", "growth", "equity"}


def parse_batch_yes(reply, items):
    """Is this reply an explicit yes for THIS whole batch? Returns (ok, why)."""
    raw = (reply or "").strip()
    if not raw:
        return False, "the reply is empty"
    if "?" in raw:
        return False, "the reply is a question, not a yes"
    ws = re.findall(r"[a-z']+", raw.lower().replace("’", "'"))
    if not ws or ws[0] not in YES_WORDS:
        return False, "only a reply that starts with \"yes\" counts (not ok, sure, go, send it)"
    bad = DOUBT & set(ws[1:])
    if bad:
        return False, "the reply has a condition or a change in it (%s): ask again" % ", ".join(sorted(bad))
    names = set()
    for rec in items:
        names |= {w for w in re.findall(r"[a-z']+", str(rec.get("name", "")).lower()) if len(w) > 1}
        names |= {w for w in re.findall(r"[a-z']+", str(rec.get("firm", "")).lower()) if w not in FIRM_SOFT and len(w) > 2}
    named = names & set(ws)
    if named:
        return False, ("the reply names %s: a yes covers the whole batch you were shown. To send to fewer people, "
                       "show a smaller batch (batch --ids ...)" % ", ".join(sorted(named)))
    nums = [int(n) for n in re.findall(r"\d+", raw)] + [COUNT_WORDS[w] for w in ws if w in COUNT_WORDS]
    wrong = [n for n in nums if n != len(items)]
    if wrong:
        return False, "the reply says %s, but this batch is %d email%s" % (
            wrong[0], len(items), "" if len(items) == 1 else "s")
    return True, "explicit yes for %d email%s" % (len(items), "" if len(items) == 1 else "s")


def check_draft(seed_dir, rec, sender):
    d = rec["draft"]
    msg, data = read_eml(seed_dir, d["file"])
    to = msg["To"].addresses if msg["To"] is not None else ()
    if len(to) != 1 or to[0].addr_spec.lower() != rec["email"].lower():
        raise CloserError("%s is not addressed to %s alone: draft it again" % (d["file"], rec["email"]))
    frm = msg["From"].addresses if msg["From"] is not None else ()
    if len(frm) != 1 or frm[0].addr_spec.lower() != sender["email"].lower():
        raise CloserError("%s is not from %s (founder.email): draft it again" % (d["file"], sender["email"]))
    if msg["Cc"] is not None or msg["Bcc"] is not None:
        raise CloserError("%s has a Cc or Bcc: one investor per email" % d["file"])
    body = eml_body(msg)
    if d["kind"] in COLD and OPTOUT not in body:
        raise CloserError("%s lost the opt-out line (%s): put it back or draft it again" % (d["file"], OPTOUT))
    if sender["name"] not in body:
        raise CloserError("%s lost your name: every email is signed by you" % d["file"])
    return msg, data, body


def select_batch(pipe, rules, today, ids=None, limit=None):
    cands = [r for r in pipe["investors"] if (r.get("draft") or {}).get("state") == "drafted"]
    if ids:
        want = [x.strip() for x in ids.split(",") if x.strip()]
        for i in want:
            rec = find(pipe, i)
            if (rec.get("draft") or {}).get("state") != "drafted":
                raise CloserError("%s has no draft waiting for a yes" % i)
        cands = [r for r in cands if r["id"] in want]
    cands.sort(key=lambda r: (0 if r["draft"]["kind"] == "reply" else 1, -fit_of(r), r["id"]))
    used = cold_used(pipe, today)
    room = max(0, rules["daily_cap"] - used)
    if limit is not None:
        room = min(room, limit)
    items, held, n = [], [], 0
    for rec in cands:
        if rec["draft"]["kind"] in COLD:
            if n >= room:
                held.append(rec)
                continue
            n += 1
        items.append(rec)
    return items, held, used


def batch_id(seed_dir, items):
    h = hashlib.sha256()
    for rec in sorted(items, key=lambda r: r["id"]):
        d = rec["draft"]
        _, data = read_eml(seed_dir, d["file"])
        h.update(("%s|%d|%s|%s\n" % (rec["id"], d["n"], d["kind"], sha(data))).encode("utf-8"))
    return h.hexdigest()[:8]


def touch_label(rec, rules):
    d = rec["draft"]
    if d["kind"] == "reply":
        return "reply in the conversation"
    if d["kind"] == "intro":
        return "intro (touch 1 of %d)" % rules["max_touches"]
    return "follow-up %d of %d" % (d["n"] - 1, rules["max_touches"] - 1)


def batch_flags(a):
    out = ""
    if a.ids:
        out += " --ids %s" % a.ids
    if a.limit is not None:
        out += " --limit %d" % a.limit
    return out


def cmd_batch(a):
    today = get_today(a)
    cfg = load_config(a.dir)
    rules = outreach_rules(cfg)
    sender = sender_of(cfg)
    pipe = load_pipe(a.dir)
    items, held, used = select_batch(pipe, rules, today, a.ids, a.limit)
    if not items:
        if held:
            print("Today's cap of %d cold emails is used (%d sent or approved). %d draft%s wait for the next day."
                  % (rules["daily_cap"], used, len(held), "" if len(held) == 1 else "s"))
        else:
            print("Nothing is waiting for a yes. Draft first: closer.py draft, followup or reply.")
        return 1
    shown = [check_draft(a.dir, r, sender) for r in items]
    bid = batch_id(a.dir, items)
    cold = sum(1 for r in items if r["draft"]["kind"] in COLD)
    if a.json:
        print(json.dumps({"batch": bid, "date": today.isoformat(), "emails": len(items), "cold": cold,
                          "cap": rules["daily_cap"], "used_today": used, "held": [r["id"] for r in held],
                          "recipients": [{"id": r["id"], "name": r["name"], "firm": r["firm"], "email": r["email"],
                                          "touch": touch_label(r, rules), "personal_line": r.get("personal_line")
                                          if r["draft"]["kind"] == "intro" else None} for r in items],
                          "first": {"to": str(shown[0][0]["To"]), "subject": str(shown[0][0]["Subject"]),
                                    "body": shown[0][2]},
                          "approve": "closer.py approve --batch %s%s --reply \"<the reply, word for word>\""
                                     % (bid, batch_flags(a))}, indent=2, ensure_ascii=False))
        return 0
    print("BATCH %s: %d email%s from %s <%s>, %s" % (bid, len(items), "" if len(items) == 1 else "s",
                                                    sender["name"], sender["email"], short_day(today)))
    print("Daily cap: %d cold emails. %d sent or approved today, %d in this batch."
          % (rules["daily_cap"], used, cold))
    for i, r in enumerate(items, 1):
        print("  %d. %s, %s <%s>  %s" % (i, r["name"], r["firm"], r["email"], touch_label(r, rules)))
        if r["draft"]["kind"] == "intro":
            print("     \"%s\"" % r.get("personal_line", ""))
    msg, _, body = shown[0]
    print("The first email, in full:")
    print("  To: %s" % msg["To"])
    print("  Subject: %s" % msg["Subject"])
    print("")
    for line in body.split("\n"):
        print(("  " + line).rstrip())
    print("")
    if held:
        print("%d more draft%s wait for the next day (the daily cap)." % (len(held), "" if len(held) == 1 else "s"))
    print("Every email is in %s (open any of them before you answer)."
          % os.path.join(a.dir, "outreach"))
    print("Ask: \"Send these %d email%s from your Gmail? Reply yes or no.\"" % (len(items), "" if len(items) == 1 else "s"))
    print("Then: closer.py approve --batch %s%s --reply \"<the reply, word for word>\"" % (bid, batch_flags(a)))
    return 0


def outbox_row(seed_dir, rec, sender):
    d = rec["draft"]
    msg, data, body = check_draft(seed_dir, rec, sender)
    if d.get("sha") and sha(data) != d["sha"]:
        raise CloserError("%s changed after the yes: show it again (batch) before it goes anywhere" % d["file"])
    return {"id": rec["id"], "kind": d["kind"], "touch": d["n"], "to": str(msg["To"]), "to_email": rec["email"],
            "subject": str(msg["Subject"]), "body": body, "thread_id": rec.get("thread_id"),
            "in_reply_to": d.get("in_reply_to"), "eml": os.path.join(seed_dir, d["file"])}


def cmd_approve(a):
    today = get_today(a)
    cfg = load_config(a.dir)
    rules = outreach_rules(cfg)
    sender = sender_of(cfg)
    pipe = load_pipe(a.dir)
    items, held, used = select_batch(pipe, rules, today, a.ids, a.limit)
    if not items:
        raise CloserError("nothing is waiting for a yes (or today's cap is used): run batch")
    for r in items:
        check_draft(a.dir, r, sender)
    bid = batch_id(a.dir, items)
    if a.batch != bid:
        raise CloserError("batch %s is not the batch waiting now (%s): it changed since it was shown. Run batch "
                          "again and show it to the user" % (a.batch, bid))
    ok, why = parse_batch_yes(a.reply, items)
    if not ok:
        print("Not recorded: %s. Show the batch again and ask." % why)
        return 1
    cold = sum(1 for r in items if r["draft"]["kind"] in COLD)
    if used + cold > rules["daily_cap"]:
        raise CloserError("this batch has %d cold emails and the daily cap leaves %d" % (cold, rules["daily_cap"] - used))
    for r in items:
        d = r["draft"]
        _, data = read_eml(a.dir, d["file"])
        d.update({"state": "approved", "approved_on": today.isoformat(), "reply": a.reply, "batch": bid,
                  "sha": sha(data)})
        if d["kind"] == "intro":
            set_status(r, "approved")
        history(r, today, "approved", "batch %s, reply %r" % (bid, a.reply))
    save_pipe(a.dir, pipe, today)
    rows = [outbox_row(a.dir, r, sender) for r in items]
    print("Recorded your yes for batch %s: %d email%s (%d of today's %d cold emails)."
          % (bid, len(items), "" if len(items) == 1 else "s", used + cold, rules["daily_cap"]))
    print("Now send each one through the user's own Gmail connector, one tool call per email. A follow-up or a "
          "reply goes into its thread_id. Claude's card asks Allow once or Deny every time:")
    print(json.dumps(rows, indent=2, ensure_ascii=False))
    print("After each send: closer.py log --id <id> --event sent --thread-id <the Gmail thread id>.")
    print("If one is denied on the card: closer.py log --id <id> --event denied (it goes back to drafted).")
    return 0


def cmd_outbox(a):
    cfg = load_config(a.dir)
    sender = sender_of(cfg)
    pipe = load_pipe(a.dir)
    rows = [outbox_row(a.dir, r, sender) for r in pipe["investors"]
            if (r.get("draft") or {}).get("state") == "approved"]
    if a.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0 if rows else 1
    if not rows:
        print("Nothing is approved and waiting to be sent.")
        return 1
    print("%d approved email%s, not sent yet:" % (len(rows), "" if len(rows) == 1 else "s"))
    for r in rows:
        print("  %-18s %s  %s%s" % (r["id"], r["to"], r["subject"],
                                    "  (thread %s)" % r["thread_id"] if r["thread_id"] else ""))
    return 0


# ------------------------------------------------------------ log

def record_reply(rec, cls, day, rules, note="", back=None, excerpt=""):
    if not out_touches(rec):
        raise CloserError("nothing was sent to %s yet, so there is no reply to record" % rec["id"])
    st = rec.get("status")
    if st in TERMINAL:
        raise CloserError("%s is %s: that thread ended for good, nothing more is recorded or sent" % (rec["id"], st))
    label = LABELS[cls]
    if cls == "ooo":
        voided = ""
        if back:
            rec["hold_until"] = back.isoformat()
            d = rec.get("draft")
            if d and d["kind"] == "followup":
                voided = " The waiting follow-up (%s) is void; it is drafted again when it is due." % d["file"]
                history(rec, day, "voided", d["file"])
                rec["draft"] = None
        add_label(rec, label)
        rec["next_due"] = iso(next_due(rec, rules))
        history(rec, day, "out of office", note or ("back %s" % back.isoformat() if back else "no return date"))
        return "%s: out of office%s. Status stays %s%s.%s" % (
            rec["id"], " until %s" % back.isoformat() if back else "", st,
            ", next follow-up %s" % rec["next_due"] if rec["next_due"] else "", voided)
    new = NEW_STATUS[cls]
    if new in RANK and st in RANK and RANK[st] >= RANK[new]:
        new = st
    set_status(rec, new)
    if cls != "bounce":
        t = {"date": iso(day), "kind": "reply", "from": "them", "class": cls}
        if excerpt:
            t["excerpt"] = excerpt[:240]
        rec["touches"].append(t)
    add_label(rec, label)
    voided = ""
    d = rec.get("draft")
    if d and (d["kind"] == "followup" or new in TERMINAL):
        voided = " The waiting %s draft (%s) is void: it will not be sent." % (d["kind"], d["file"])
        history(rec, day, "voided", d["file"])
        rec["draft"] = None
    rec["next_due"] = None
    rec.pop("hold_until", None)
    history(rec, day, cls, note)
    end = {"passed": " The thread is closed: no more follow-ups.", "bounced": " The thread is closed for good.",
           "optout": " Never emailed again."}.get(new, " Follow-ups stop: this is a conversation now.")
    return "%s: %s, status %s.%s%s" % (rec["id"], label, new, end, voided)


def cmd_log(a):
    today = get_today(a)
    day = parse_day(a.date, "--date") if a.date else today
    cfg = load_config(a.dir)
    rules = outreach_rules(cfg)
    pipe = load_pipe(a.dir)
    ids = [x.strip() for x in a.id.split(",") if x.strip()]
    if not ids:
        raise CloserError("say who: --id maya-chen (or several, comma separated)")
    if a.event == "note" and not a.note:
        raise CloserError("--event note needs --note \"...\"")
    out = []
    for rid in ids:
        rec = find(pipe, rid)
        st = rec.get("status")
        if a.event == "note":
            rec["notes"] = ("%s; %s" % (rec["notes"], a.note)) if rec.get("notes") else a.note
            history(rec, day, "note", a.note)
            out.append("%s: note added." % rid)
            continue
        if st in TERMINAL:
            raise CloserError("%s is %s: that thread ended for good, nothing more is recorded or sent" % (rid, st))
        if a.event == "sent":
            d = rec.get("draft")
            if not d or d.get("state") != "approved":
                raise CloserError("%s has no approved email to mark sent: the yes comes first (batch, then approve)"
                                  % rid)
            if day < parse_day(d["approved_on"], "approved_on"):
                raise CloserError("%s: the send date %s is before the yes (%s)" % (rid, day, d["approved_on"]))
            rec["touches"].append({"n": d["n"], "date": iso(day), "kind": d["kind"], "from": "us",
                                   "subject": d["subject"], "message_id": d["message_id"], "file": d["file"]})
            rec["draft"] = None
            if a.thread_id:
                rec["thread_id"] = a.thread_id
            if d["kind"] == "intro":
                set_status(rec, "sent")
            rec["next_due"] = iso(next_due(rec, rules))
            history(rec, day, "sent", "%s %d" % (d["kind"], d["n"]))
            out.append("%s: %s sent %s.%s" % (rid, d["kind"] if d["kind"] != "followup" else "follow-up %d" % (d["n"] - 1),
                                              short_day(day), " Next follow-up due %s." % rec["next_due"]
                                              if rec["next_due"] else ""))
        elif a.event == "denied":
            d = rec.get("draft")
            if not d or d.get("state") != "approved":
                raise CloserError("%s has no approved email to put back" % rid)
            d["state"] = "drafted"
            for k in ("approved_on", "reply", "batch", "sha"):
                d.pop(k, None)
            if d["kind"] == "intro":
                set_status(rec, "drafted")
            history(rec, day, "denied", d["file"])
            out.append("%s: back to drafted. It needs a new yes before it goes anywhere." % rid)
        else:
            out.append(record_reply(rec, EVENT_CLASS[a.event], day, rules, note=a.note or ""))
    save_pipe(a.dir, pipe, today)
    for line in out:
        print(line)
    return 0


# ------------------------------------------------------------ due and follow-ups

def cmd_due(a):
    today = get_today(a)
    cfg = load_config(a.dir)
    rules = outreach_rules(cfg)
    pipe = load_pipe(a.dir)
    due, later, waiting = [], [], []
    for rec in pipe["investors"]:
        nd = next_due(rec, rules)
        if nd is None:
            continue
        if rec.get("draft"):
            waiting.append((rec, nd))
        elif nd <= today:
            due.append((rec, nd))
        else:
            later.append((rec, nd))
    due.sort(key=lambda x: (x[1], -fit_of(x[0]), x[0]["id"]))
    later.sort(key=lambda x: (x[1], x[0]["id"]))
    workday = is_workday(today, rules)

    def row(rec, nd):
        k = len(out_touches(rec, COLD))
        return {"id": rec["id"], "name": rec["name"], "firm": rec["firm"], "due": nd.isoformat(),
                "followup": k, "of": rules["max_touches"] - 1, "intro_sent": out_touches(rec, COLD)[0]["date"]}
    if a.json:
        print(json.dumps({"today": today.isoformat(), "business_day": workday, "due": [row(*x) for x in due],
                          "drafted": [row(*x) for x in waiting], "later": [row(*x) for x in later]}, indent=2))
        return 0 if due and workday else 1
    kind = "business days" if rules["business_days"] else "calendar days"
    if not workday:
        print("%s is not a business day: nothing goes out today. Next business day: %s."
              % (short_day(today), short_day(next_workday(today, rules))))
    if due:
        print("Follow-ups due %s (%s, at most %d touches, never after a reply):" % (short_day(today), kind,
                                                                                    rules["max_touches"]))
        for rec, nd in due:
            r = row(rec, nd)
            print("  %-18s %s, %s  follow-up %d of %d, intro sent %s%s" % (
                rec["id"], rec["name"], rec["firm"], r["followup"], r["of"],
                short_day(parse_day(r["intro_sent"])), "" if nd == today else " (due since %s)" % short_day(nd)))
        if workday:
            print("Next: closer.py followup --due, then batch and the user's yes.")
    else:
        print("No follow-ups due %s." % short_day(today))
    for rec, nd in waiting:
        print("  waiting: %s has a %s draft (%s)" % (rec["id"], rec["draft"]["kind"], rec["draft"]["state"]))
    for rec, nd in later[:10]:
        print("  later: %s %s, follow-up %d" % (short_day(nd), rec["id"], len(out_touches(rec, COLD))))
    return 0 if due and workday else 1


def clean_extra(text, what, limit):
    s = " ".join(str(text or "").split())
    if not s:
        return ""
    if PLACEHOLDER_RE.search(s):
        raise CloserError("%s still has a placeholder in it: %r" % (what, s))
    if words(s) > limit:
        raise CloserError("%s is %d words; keep it under %d (follow-ups are short)" % (what, words(s), limit))
    return s


def cmd_followup(a):
    today = get_today(a)
    cfg = load_config(a.dir)
    rules = outreach_rules(cfg)
    sender = sender_of(cfg)
    base = base_values(cfg, sender)
    tpl = load_template(template_path(a))
    pipe = load_pipe(a.dir)
    extra = clean_extra(a.extra, "--extra", 30)
    ask = clean_extra(a.ask, "--ask", 25) or DEFAULT_ASK
    if not ask.endswith("?"):
        raise CloserError("--ask is a question: end it with a question mark")
    if a.due:
        if not is_workday(today, rules):
            print("%s is not a business day: no follow-ups today." % short_day(today))
            return 1
        targets = [r for r in pipe["investors"] if not r.get("draft") and next_due(r, rules)
                   and next_due(r, rules) <= today]
        targets.sort(key=lambda r: (-fit_of(r), r["id"]))
        if not targets:
            print("No follow-ups due %s." % short_day(today))
            return 1
    elif a.id:
        targets = [find(pipe, a.id)]
    else:
        raise CloserError("say who: --id maya-chen, or --due for everyone due today")
    made, writes = [], []
    for rec in targets:
        st = rec.get("status")
        if st in TERMINAL:
            raise CloserError("%s is %s: that thread ended for good" % (rec["id"], st))
        if st in CONVERSATION:
            raise CloserError("%s replied: follow-ups stop after a reply. Answer in the thread instead "
                              "(closer.py reply)" % rec["id"])
        if st != "sent":
            raise CloserError("%s: the intro has not gone out yet (status %s)" % (rec["id"], st))
        if rec.get("draft"):
            raise CloserError("%s already has a %s draft waiting (%s)" % (rec["id"], rec["draft"]["kind"],
                                                                         rec["draft"]["state"]))
        nd = next_due(rec, rules)
        if nd is None:
            raise CloserError("%s has had all %d touches: the thread ends here unless they reply"
                              % (rec["id"], rules["max_touches"]))
        if nd > today:
            raise CloserError("%s: the next follow-up is not due until %s" % (rec["id"], short_day(nd)))
        cold = out_touches(rec, COLD)
        k = len(cold)
        intro = cold[0]
        values = dict(base)
        values.update({"first_name": rec["name"].split()[0], "name": rec["name"], "firm": rec["firm"],
                       "personal_line": rec.get("personal_line", ""), "intro_subject": intro["subject"],
                       "intro_day": spoken_day(parse_day(intro["date"])), "extra": extra, "ask": ask})
        sec = "followup %d" % k
        subject = fill(tpl[sec][0], values, "template %s subject" % sec)
        body = fill(tpl[sec][1], values, "template %s" % sec)
        if OPTOUT not in body or sender["name"] not in body:
            raise CloserError("the template's %s lost {optout} or {signature}" % sec)
        n_words = words(body.split(OPTOUT)[0])
        if n_words > 80:
            raise CloserError("%s: this follow-up is %d words before the opt-out line; keep follow-ups under 80"
                              % (rec["id"], n_words))
        n = len(out_touches(rec)) + 1
        mid = message_id(rec["id"], n, subject, today, sender)
        last = out_touches(rec)[-1]
        data = build_eml(sender, rec["name"], rec["email"], subject, body, today, mid, last.get("message_id"))
        rel = "outreach/%s-%d.eml" % (rec["id"], n)
        rec["draft"] = {"n": n, "kind": "followup", "file": rel, "subject": subject, "message_id": mid,
                        "in_reply_to": last.get("message_id"), "state": "drafted", "drafted_on": today.isoformat()}
        history(rec, today, "drafted", "follow-up %d" % k)
        writes.append((os.path.join(a.dir, rel), data))
        made.append((rec, k, subject, body))
    for path, data in writes:
        write_bytes(path, data)
    save_pipe(a.dir, pipe, today)
    for rec, k, subject, body in made:
        print("Drafted follow-up %d of %d for %s (%s) -> %s" % (k, rules["max_touches"] - 1, rec["name"], rec["id"],
                                                                os.path.join(a.dir, rec["draft"]["file"])))
    rec, k, subject, body = made[0]
    print("  Subject: %s" % subject)
    print("")
    for line in body.split("\n"):
        print(("  " + line).rstrip())
    print("Nothing is sent. Next: closer.py batch, then the user's yes. Send it in the intro's thread%s."
          % (" (%s)" % rec["thread_id"] if rec.get("thread_id") else ""))
    return 0


def cmd_reply(a):
    today = get_today(a)
    cfg = load_config(a.dir)
    sender = sender_of(cfg)
    base = base_values(cfg, sender)
    pipe = load_pipe(a.dir)
    rec = find(pipe, a.id)
    st = rec.get("status")
    if st not in CONVERSATION:
        raise CloserError("%s is %s: a reply answers a conversation they started (it is not a follow-up)"
                          % (a.id, st))
    if rec.get("draft"):
        raise CloserError("%s already has a %s draft waiting (%s)" % (a.id, rec["draft"]["kind"], rec["draft"]["state"]))
    if a.body_file:
        with open(a.body_file, encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = a.body or ""
    text = tidy(text.replace("\r\n", "\n"))
    if not text:
        raise CloserError("the reply is empty: give --body or --body-file")
    if PLACEHOLDER_RE.search(text):
        raise CloserError("the reply still has a placeholder in it")
    if words(text) > 250:
        raise CloserError("the reply is %d words: keep it under 250 and offer a call for the rest" % words(text))
    body = text + "\n\n" + base["signature"]
    outs = out_touches(rec)
    intro = out_touches(rec, ("intro",))[0]
    subject = intro["subject"] if intro["subject"].lower().startswith("re:") else "Re: " + intro["subject"]
    n = len(outs) + 1
    mid = message_id(rec["id"], n, subject, today, sender)
    data = build_eml(sender, rec["name"], rec["email"], subject, body, today, mid, outs[-1].get("message_id"))
    rel = "outreach/%s-%d.eml" % (rec["id"], n)
    write_bytes(os.path.join(a.dir, rel), data)
    rec["draft"] = {"n": n, "kind": "reply", "file": rel, "subject": subject, "message_id": mid,
                    "in_reply_to": outs[-1].get("message_id"), "state": "drafted", "drafted_on": today.isoformat()}
    history(rec, today, "drafted", "reply")
    save_pipe(a.dir, pipe, today)
    print("Drafted a reply to %s -> %s" % (rec["name"], os.path.join(a.dir, rel)))
    for line in body.split("\n"):
        print(("  " + line).rstrip())
    print("Nothing is sent. Next: closer.py batch, then the user's yes; it goes into the same thread.")
    return 0


# ------------------------------------------------------------ inbox: sorting replies

BOUNCE = [r"delivery status notification", r"undeliverable", r"delivery has failed", r"address not found",
          r"could ?n[o']t be delivered", r"was ?n[o']t delivered", r"wasn't delivered", r"mailbox (unavailable|not found|full)",
          r"user unknown", r"no such user", r"recipient address rejected", r"\b550[ -]5\.1\.\d\b",
          r"message not delivered", r"returned mail", r"delivery failure"]
OOO = [r"out of (the )?office", r"\booo\b", r"\bon (vacation|holiday|leave|parental leave|paternity leave|"
       r"maternity leave|pto)\b", r"automatic reply", r"auto[- ]?reply", r"\baway (from (my desk|the office) )?until\b",
       r"limited access to (my )?(email|e-mail)", r"currently travel", r"\breturning on\b",
       r"\bback in the office\b"]
OPTOUT_PAT = [r"unsubscribe", r"\bremove me\b", r"\btake me off\b", r"\bstop (emailing|contacting|sending|writing)\b",
              r"\b(do not|don't|dont) (contact|email|e-mail|reach out to|write to) me\b", r"\bno more emails\b",
              r"\bopt(ing)?[- ]?out\b", r"\bremove my (email|address)\b", r"\boff your (list|mailing list)\b"]
NO_PAT = [r"\bnot (a|the right) (fit|match)\b", r"\b(is ?n[o']t|is not|isn't) a (fit|match)\b", r"\bno,? thank(s| you)\b",
          r"\bpass on (this|it)\b", r"\b(we|i)('ll| will| are going to| have to|'re going to| must) pass\b",
          r"\b(we're|we are|i'm|i am) passing\b", r"\bnot for (us|me)\b", r"\bnot interested\b",
          r"\boutside (of )?(our|my) (thesis|focus|scope|mandate|remit)\b", r"\b(don't|do not|dont) invest in\b",
          r"\b(aren't|are not|not) investing in\b", r"\b(doesn't|does not|dont|don't) fit\b",
          r"\bnot something (we|i)\b", r"\bdecline\b", r"\bgoing to pass\b"]
NOT_NOW = [r"\bnot (right )?now\b", r"\bfor now\b", r"\bnot this (quarter|year|round|time)\b", r"\bnot at this time\b",
           r"\b(too|a bit|a little) early\b", r"\bcome back\b", r"\bcircle back\b", r"\bkeep me (posted|updated|in the loop)\b",
           r"\b(keep|stay) in touch\b", r"\bcheck back\b", r"\breach out again\b", r"\brevisit\b",
           r"\bin a (few|couple of) months\b", r"\bnext (quarter|year)\b", r"\b(when|once) you have (more )?traction\b",
           r"\b(once|after) you('ve| have)? launch", r"\btiming (isn't|is not|isnt) right\b", r"\bbandwidth\b",
           r"\bnot ready\b", r"\bupdate me\b", r"\bsend (me )?updates\b"]
INTERESTED = [r"\bhappy to (chat|talk|connect|meet|hop on|jump on|take a look)\b",
              r"\b(love|like) to (chat|talk|learn|hear|see|meet|connect)\b",
              r"\bwould (like|love) to (chat|talk|learn|meet|see|hear)\b",
              r"\blet's (chat|talk|meet|connect|find|set|grab|do|schedule|get)\b",
              r"\b(set|setting) up (a |some )?(call|time|meeting|chat)\b",
              r"\b(grab|find|book|schedule) (some )?(time|a time|a call|a slot|a meeting)\b",
              r"\bsend (me |over |us )?(the |your )?deck\b", r"\bdeck over\b", r"\bshare (the |your )?deck\b",
              r"\bworks for (me|us)\b", r"\bthat works\b", r"\b(monday|tuesday|wednesday|thursday|friday|tomorrow|"
              r"next week)[^.?!]{0,20}\bworks\b", r"\bsend (me |us )?(an |the )?invite\b", r"calendly|cal\.com",
              r"\bi'm in\b", r"\binterested in (learning|hearing|chatting|talking|seeing)\b",
              r"\b(i am|i'm|we're|we are) (very |really )?interested\b", r"\bcount (me|us) in\b",
              r"\bsounds (great|good|interesting)\b", r"\blove this\b", r"\bintrigued\b", r"\btell me more\b",
              r"\bkeen to\b"]
QUESTION_START = re.compile(r"^(what|how|who|when|why|which|where|can|could|do|does|is|are|have|has|would|will)\b")
MONTH_KEYS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
              "oct": 10, "nov": 11, "dec": 12}
MONTH_RE = r"(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|" \
           r"apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?"
RETURN_LEAD = r"(?:until|till|back|return|returning|through|thru|on leave until|away until)"


def strip_quoted(text):
    """The new part of a reply: quoted lines, the 'On ... wrote:' block and signatures are dropped."""
    lines = (text or "").replace("\r\n", "\n").split("\n")
    out = []
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith(">"):
            continue
        low = s.lower()
        if low.startswith("on ") and ("wrote:" in low or (i + 1 < len(lines) and "wrote:" in lines[i + 1].lower())):
            break
        if re.match(r"^-{2,}\s*(original message|forwarded message)", low):
            break
        if re.match(r"^(from|sent|date):\s", low) and out and any(
                re.match(r"^\s*(sent|to|subject|date):\s", x.lower()) for x in lines[i + 1:i + 4]):
            break
        if s in ("--", "-- "):
            break
        out.append(line)
    return "\n".join(out).strip()


def _year_for(m, d, today):
    try:
        cand = datetime.date(today.year, m, d)
    except ValueError:
        return None
    if cand < today:
        try:
            cand = datetime.date(today.year + 1, m, d)
        except ValueError:
            return None
    return cand


def find_return_date(text, today):
    low = " ".join((text or "").lower().split())
    m = re.search(r"\b(20\d\d)-(\d\d)-(\d\d)\b", low)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    m = re.search(RETURN_LEAD + r"[^.\n]{0,30}?\b" + MONTH_RE + r"\s+(\d{1,2})(?:st|nd|rd|th)?\b", low)
    if m:
        return _year_for(MONTH_KEYS[m.group(1)[:3]], int(m.group(2)), today)
    m = re.search(RETURN_LEAD + r"[^.\n]{0,30}?\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?" + MONTH_RE, low)
    if m:
        return _year_for(MONTH_KEYS[m.group(2)[:3]], int(m.group(1)), today)
    m = re.search(RETURN_LEAD + r"[^.\n]{0,20}?\b(\d{1,2})/(\d{1,2})\b", low)
    if m:
        return _year_for(int(m.group(1)), int(m.group(2)), today)
    m = re.search(RETURN_LEAD + r"\s+(?:on\s+)?(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
                  low)
    if m:
        want = [d.lower() for d in DAY_NAMES].index(m.group(1))
        ahead = (want - today.weekday()) % 7 or 7
        return today + datetime.timedelta(days=ahead)
    return None


def _any(patterns, text):
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(0)
    return None


def classify(text, subject="", sender="", today=None):
    """Sort one reply by rules: interested / question / not_now / no / ooo / optout / bounce / unclear."""
    today = today or datetime.date.today()
    raw = (text or "").replace("’", "'")
    whole = " ".join((raw + " " + (subject or "")).lower().split())
    if re.search(r"mailer-daemon|postmaster", (sender or "").lower()) or _any(BOUNCE, whole):
        return {"class": "bounce", "why": _any(BOUNCE, whole) or "from the mail system", "back": None, "deck": False}
    body = strip_quoted(raw)
    low = " ".join(body.lower().split())
    subj = " ".join((subject or "").lower().split())
    hit = _any(OOO, low) or _any(OOO, subj)
    if hit:
        return {"class": "ooo", "why": hit, "back": find_return_date(body, today), "deck": False}
    hit = _any(OPTOUT_PAT, low)
    if hit:
        return {"class": "optout", "why": hit, "back": None, "deck": False}
    later = _any(NOT_NOW, low)
    bare = re.sub(r"[^a-z ]", "", low).strip()
    no = _any(NO_PAT, low) or (bare if bare in ("no", "nope", "pass", "no thanks", "no thank you") else None)
    deck = bool(re.search(r"\bdeck\b", low))
    if later:
        return {"class": "not_now", "why": later, "back": None, "deck": False}
    if no:
        return {"class": "no", "why": no, "back": None, "deck": False}
    hit = _any(INTERESTED, low)
    if hit:
        return {"class": "interested", "why": hit, "back": None, "deck": deck}
    if "?" in body or QUESTION_START.match(low):
        return {"class": "question", "why": "asks a question", "back": None, "deck": deck}
    return {"class": "unclear", "why": "no rule matched", "back": None, "deck": deck}


def next_action(cls, info, rec_id):
    rid = rec_id or "<id>"
    if cls == "interested":
        s = ("Offer two times from the user's calendar (or ask what suits them). When they agree on one: closer.py "
             "book --id %s --start \"YYYY-MM-DD HH:MM\" --tz ... --link <video link>." % rid)
        if info.get("deck"):
            s += " They asked for the deck: reply with the deck (seed/deck.html printed to PDF, or a link), after the yes."
        return s
    if cls == "question":
        return ("Answer it in the thread. Claude drafts the answer from seed/plan.json and seed/model.json, never a "
                "number that is not in them: closer.py reply --id %s --body-file answer.txt, then batch and the yes."
                % rid)
    if cls == "not_now":
        return ("Soft pass: no more follow-ups. If they asked to be kept posted, seed-updates --to prospects sends "
                "them the monthly update.")
    if cls == "no":
        return "A no. The thread is closed for good: no follow-ups, nothing more is sent."
    if cls == "optout":
        return "Opted out. Never emailed again, from any batch."
    if cls == "bounce":
        return ("Bounced. The thread stops. Find their published address with seed-investors; never guess one.")
    if cls == "ooo":
        if info.get("back"):
            return "An auto-reply, not an answer. The next follow-up waits until after %s." % info["back"].isoformat()
        return "An auto-reply, not an answer. No return date found, so the follow-up keeps its date."
    return "The rules could not sort it. Read it yourself and tell Claude what to answer; nothing goes out without a yes."


def load_replies(a):
    if a.text is not None:
        return [{"id": a.id, "from": a.sender or "", "subject": a.subject or "", "text": a.text, "date": a.date}]
    if not a.file:
        raise CloserError("give the replies: --file replies.json (or a .txt with --id), or --text \"...\"")
    if not os.path.exists(a.file):
        raise CloserError("no such file: %s" % a.file)
    with open(a.file, encoding="utf-8") as fh:
        raw = fh.read()
    if a.file.lower().endswith(".json"):
        try:
            doc = json.loads(raw)
        except ValueError as e:
            raise CloserError("%s is not valid JSON: %s" % (a.file, e))
        rows = doc.get("replies") if isinstance(doc, dict) else doc
        if not isinstance(rows, list):
            raise CloserError("%s needs a list of replies: [{\"id\" or \"from\", \"text\", ...}]" % a.file)
        return [r for r in rows if isinstance(r, dict)]
    return [{"id": a.id, "from": a.sender or "", "subject": a.subject or "", "text": raw, "date": a.date}]


def match_reply(pipe, r, cls):
    if r.get("id"):
        return find(pipe, r["id"])
    addr = email.utils.parseaddr(str(r.get("from") or r.get("email") or ""))[1].lower()
    for rec in pipe["investors"]:
        if addr and rec.get("email", "").lower() == addr:
            return rec
    if cls == "bounce":
        text = str(r.get("text") or "").lower()
        for rec in pipe["investors"]:
            if rec.get("email") and rec["email"].lower() in text:
                return rec
    return None


def cmd_inbox(a):
    today = get_today(a)
    cfg = load_config(a.dir) if a.write else (read_json(os.path.join(a.dir, "config.json"), "config", False) or {})
    rules = outreach_rules(cfg)
    pipe = load_pipe(a.dir)
    rows = load_replies(a)
    if not rows:
        raise CloserError("no replies to sort")
    results = []
    for r in rows:
        info = classify(r.get("text", ""), r.get("subject", ""), r.get("from", ""), today)
        cls = info["class"]
        rec = match_reply(pipe, r, cls)
        body = " ".join(strip_quoted(str(r.get("text", ""))).split())
        res = {"id": rec["id"] if rec else None, "name": rec["name"] if rec else (r.get("from") or "unknown sender"),
               "class": cls, "label": LABELS[cls], "why": info["why"],
               "back": iso(info["back"]), "excerpt": body[:160], "next": next_action(cls, info, rec["id"] if rec else None)}
        if a.write and rec:
            day = parse_day(r["date"], "reply date") if r.get("date") else today
            res["recorded"] = record_reply(rec, cls, day, rules, note=info["why"], back=info["back"], excerpt=body)
        results.append(res)
    if a.write:
        save_pipe(a.dir, pipe, today)
    if a.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
        return 0
    for res in results:
        print("%s%s: %s (%s)" % (res["name"], " [%s]" % res["id"] if res["id"] else " [not in the pipeline]",
                                 res["label"].upper(), res["why"]))
        print("  \"%s\"" % res["excerpt"])
        print("  next: " + res["next"])
        if res.get("recorded"):
            print("  recorded: " + res["recorded"])
    if not a.write:
        print("Nothing recorded yet. Check the labels with the user, then run it again with --write.")
    return 0


# ------------------------------------------------------------ time zones (no tz files) and the invite

ZONES = {
    "UTC": (0, None), "Europe/London": (0, "eu"), "Europe/Dublin": (0, "eu"), "Europe/Lisbon": (0, "eu"),
    "Europe/Paris": (60, "eu"), "Europe/Berlin": (60, "eu"), "Europe/Madrid": (60, "eu"),
    "Europe/Amsterdam": (60, "eu"), "Europe/Stockholm": (60, "eu"), "Europe/Zurich": (60, "eu"),
    "Europe/Rome": (60, "eu"), "Europe/Athens": (120, "eu"), "Europe/Helsinki": (120, "eu"),
    "America/New_York": (-300, "us"), "America/Toronto": (-300, "us"), "America/Detroit": (-300, "us"),
    "America/Chicago": (-360, "us"), "America/Denver": (-420, "us"), "America/Phoenix": (-420, None),
    "America/Los_Angeles": (-480, "us"), "America/Vancouver": (-480, "us"), "America/Anchorage": (-540, "us"),
    "Pacific/Honolulu": (-600, None), "America/Mexico_City": (-360, None), "America/Sao_Paulo": (-180, None),
    "Asia/Dubai": (240, None), "Asia/Kolkata": (330, None), "Asia/Singapore": (480, None),
    "Asia/Shanghai": (480, None), "Asia/Hong_Kong": (480, None), "Asia/Tokyo": (540, None),
    "Australia/Sydney": (600, "au"), "Australia/Melbourne": (600, "au"), "Australia/Brisbane": (600, None),
    "Pacific/Kiritimati": (840, None), "Pacific/Pago_Pago": (-660, None),
}
ZONE_ALIASES = {"ET": "America/New_York", "EST": "America/New_York", "EDT": "America/New_York",
                "CT": "America/Chicago", "CST": "America/Chicago", "CDT": "America/Chicago",
                "MT": "America/Denver", "PT": "America/Los_Angeles", "PST": "America/Los_Angeles",
                "PDT": "America/Los_Angeles", "GMT": "UTC", "Z": "UTC"}


def zone_name(tz):
    z = ZONE_ALIASES.get(str(tz).strip().upper(), str(tz).strip())
    if z not in ZONES:
        raise CloserError("unknown time zone %r. Use one of: %s, or give the start with an offset, like "
                          "2026-11-05T10:00-05:00" % (tz, ", ".join(sorted(ZONES))))
    return z


def _nth_sunday(y, m, n):
    d = datetime.date(y, m, 1)
    d += datetime.timedelta(days=(6 - d.weekday()) % 7)
    return d + datetime.timedelta(weeks=n - 1)


def _last_sunday(y, m):
    d = datetime.date(y + (m == 12), m % 12 + 1, 1) - datetime.timedelta(days=1)
    return d - datetime.timedelta(days=(d.weekday() + 1) % 7)


def zone_offset(zone, utc):
    """Minutes ahead of UTC in this zone at this UTC moment (naive datetime in UTC)."""
    std, rule = ZONES[zone]
    if rule is None:
        return std
    y = utc.year
    at = datetime.datetime.combine
    if rule == "us":   # 2:00 local on the 2nd Sunday of March to 2:00 local on the 1st Sunday of November
        start = at(_nth_sunday(y, 3, 2), datetime.time(2)) - datetime.timedelta(minutes=std)
        end = at(_nth_sunday(y, 11, 1), datetime.time(2)) - datetime.timedelta(minutes=std + 60)
        return std + 60 if start <= utc < end else std
    if rule == "eu":   # 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October
        start = at(_last_sunday(y, 3), datetime.time(1))
        end = at(_last_sunday(y, 10), datetime.time(1))
        return std + 60 if start <= utc < end else std
    # au: 2:00 standard on the 1st Sunday of October to 3:00 daylight on the 1st Sunday of April
    end = at(_nth_sunday(y, 4, 1), datetime.time(3)) - datetime.timedelta(minutes=std + 60)
    start = at(_nth_sunday(y, 10, 1), datetime.time(2)) - datetime.timedelta(minutes=std)
    return std + 60 if (utc < end or utc >= start) else std


def local_to_utc(local, zone):
    """(naive UTC, offset minutes). The earlier moment wins when the clocks fall back; a time that does not
    exist because the clocks jumped forward is refused."""
    std, rule = ZONES[zone]
    found = []
    for off in ((std + 60, std) if rule else (std,)):
        utc = local - datetime.timedelta(minutes=off)
        if zone_offset(zone, utc) == off:
            found.append((utc, off))
    if not found:
        raise CloserError("%s does not exist in %s: the clocks jump forward that night" % (local, zone))
    return min(found)


def fmt_offset(minutes):
    sign = "+" if minutes >= 0 else "-"
    return "%s%02d:%02d" % (sign, abs(minutes) // 60, abs(minutes) % 60)


def parse_start(text, tz):
    """'2026-11-05 10:00' in --tz, or an ISO time with Z or an offset. Returns (utc, zone, offset, local)."""
    s = str(text or "").strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?$", s)
    if not m:
        raise CloserError("--start wants a time like \"2026-11-05 10:00\" (in --tz) or 2026-11-05T15:00Z")
    day = parse_day(m.group(1), "--start")
    hh, mm, ss = int(m.group(2)), int(m.group(3)), int(m.group(4) or 0)
    if hh > 23 or mm > 59 or ss > 59:
        raise CloserError("--start: %s is not a real time" % s)
    local = datetime.datetime(day.year, day.month, day.day, hh, mm, ss)
    if m.group(5):
        z = m.group(5)
        off = 0 if z == "Z" else (1 if z[0] == "+" else -1) * (int(z[1:3]) * 60 + int(z[-2:]))
        return local - datetime.timedelta(minutes=off), ("UTC" if off == 0 else "UTC" + fmt_offset(off)), off, local
    zone = zone_name(tz)
    utc, off = local_to_utc(local, zone)
    return utc, zone, off, local


def ics_text(s):
    return (str(s).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\n").replace("\n", "\\n"))


def ics_param(v):
    v = " ".join(str(v).replace('"', "'").split())
    return '"%s"' % v if re.search(r"[:;,]", v) else v


def fold(line):
    """RFC 5545 3.1: lines over 75 octets are folded with CRLF + a space, never inside a UTF-8 character."""
    out, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > 75:
            out.append(cur)
            cur, size = " ", 1
        cur += ch
        size += n
    out.append(cur)
    return "\r\n".join(out)


def utc_stamp(dt):
    return dt.strftime("%Y%m%dT%H%M%SZ")


def human_time(dt):
    h = dt.hour % 12 or 12
    return "%d:%02d %s" % (h, dt.minute, "AM" if dt.hour < 12 else "PM")


def build_ics(uid, seq, stamp, start, end, title, desc, location, url, organizer, attendee, zone):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//seed-skill//seed-closer 1.0//EN", "CALSCALE:GREGORIAN",
             "METHOD:REQUEST"]
    if "/" in zone or zone == "UTC":
        lines.append("X-WR-TIMEZONE:%s" % zone)
    lines += ["BEGIN:VEVENT", "UID:%s" % uid, "SEQUENCE:%d" % seq, "DTSTAMP:%s" % utc_stamp(stamp),
              "DTSTART:%s" % utc_stamp(start), "DTEND:%s" % utc_stamp(end), "SUMMARY:%s" % ics_text(title),
              "DESCRIPTION:%s" % ics_text(desc), "LOCATION:%s" % ics_text(location)]
    if url:
        lines.append("URL:%s" % url)
    lines += ["ORGANIZER;CN=%s:mailto:%s" % (ics_param(organizer[0]), organizer[1]),
              "ATTENDEE;CN=%s;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:%s"
              % (ics_param(attendee[0]), attendee[1]),
              "ATTENDEE;CN=%s;CUTYPE=INDIVIDUAL;ROLE=CHAIR;PARTSTAT=ACCEPTED:mailto:%s"
              % (ics_param(organizer[0]), organizer[1]),
              "STATUS:CONFIRMED", "TRANSP:OPAQUE",
              "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:%s" % ics_text(title), "TRIGGER:-PT10M", "END:VALARM",
              "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(fold(x) for x in lines) + "\r\n"


def parse_stamp(text):
    if not text:
        return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$", text.strip())
    if not m:
        raise CloserError("--stamp wants a UTC time like 2026-11-02T15:04:00Z")
    return datetime.datetime(*[int(x or 0) for x in m.groups()])


def cmd_book(a):
    today = get_today(a)
    cfg = load_config(a.dir)
    sender = sender_of(cfg)
    base = base_values(cfg, sender)
    pipe = load_pipe(a.dir)
    rec = find(pipe, a.id)
    st = rec.get("status")
    if st not in CONVERSATION:
        raise CloserError("%s is %s: book a call only after they replied and agreed to a time (record the reply "
                          "with inbox --write or log first)" % (a.id, st))
    start, zone, off, local = parse_start(a.start, a.tz)
    if local.date() < today:
        raise CloserError("%s is in the past (today is %s)" % (a.start, today.isoformat()))
    if a.end:
        m = re.match(r"^(\d{1,2}):(\d{2})$", a.end.strip())
        if not m:
            raise CloserError("--end wants a time like 10:30 (same day, same zone)")
        local_end = local.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0)
        minutes = int((local_end - local).total_seconds() // 60)
    else:
        minutes = a.minutes
    if not 10 <= minutes <= 240:
        raise CloserError("the call is %d minutes; book 10 to 240" % minutes)
    end = start + datetime.timedelta(minutes=minutes)
    local_end = local + datetime.timedelta(minutes=minutes)
    if a.link and not re.match(r"^https://\S+$", a.link):
        raise CloserError("--link must be a full https:// video link (Google Meet, Zoom, ...)")
    if not a.link and not a.location:
        raise CloserError("say where: --link https://meet.google.com/... (or --location \"Phone: ...\")")
    where = a.link or " ".join(a.location.split())
    who = rec["firm"] if rec.get("firm") and rec["firm"] != rec["name"] and "angel" not in rec["firm"].lower() \
        else rec["name"]
    title = a.title or "%s × %s · Intro call" % (base["startup"], who)
    when = "%s, %s %d, %d, %s to %s %s (UTC%s)" % (DAY_NAMES[local.weekday()], MONTHS[local.month - 1], local.day,
                                                  local.year, human_time(local), human_time(local_end), zone,
                                                  fmt_offset(off))
    desc = "Intro call: %s (%s) and %s (%s).\n%s.\n%s" % (rec["name"], rec["firm"], sender["name"], base["startup"],
                                                          when, ("Join: " + a.link) if a.link else where)
    old = rec.get("call") or {}
    uid = old.get("uid") or "seed-%s@%s" % (hashlib.sha1(("%s|%s|%s" % (rec["id"], rec["email"], base["startup"]))
                                                         .encode("utf-8")).hexdigest()[:16], domain_of(sender["email"]))
    seq = int(old.get("sequence", 0)) + (1 if old and old.get("start_utc") != utc_stamp(start) else 0)
    text = build_ics(uid, seq, parse_stamp(a.stamp), start, end, title, desc, where, a.link,
                     (sender["name"], sender["email"]), (rec["name"], rec["email"]), zone)
    rel = "calls/%s.ics" % rec["id"]
    path = os.path.join(a.dir, rel)
    write_bytes(path, text.encode("utf-8"))
    set_status(rec, "booked")
    add_label(rec, "Booked")
    if rec.get("draft") and rec["draft"]["kind"] == "followup":
        history(rec, today, "voided", rec["draft"]["file"])
        rec["draft"] = None
    rec["next_due"] = None
    rec["call"] = {"title": title, "start_utc": utc_stamp(start), "end_utc": utc_stamp(end),
                   "local": local.strftime("%Y-%m-%d %H:%M"), "tz": zone, "offset": fmt_offset(off),
                   "minutes": minutes, "link": a.link, "location": where, "uid": uid, "sequence": seq, "file": rel}
    history(rec, today, "booked", "%s %s" % (rec["call"]["local"], zone))
    save_pipe(a.dir, pipe, today)
    print("Booked: %s (%s), %s." % (rec["name"], rec["firm"], when))
    print("  %s to %s UTC. Wrote %s (UID %s, sequence %d)." % (utc_stamp(start), utc_stamp(end), path, uid, seq))
    if local.weekday() >= 5:
        print("  note: that is a %s." % DAY_NAMES[local.weekday()])
    print("Nothing was sent. Show the invite and ask: \"Send this invite to %s? Reply yes or no.\"" % rec["name"])
    print("After the yes: create the event in the user's own calendar with %s as a guest (the Google Calendar "
          "connector sends the invite), or attach %s to a reply in the thread." % (rec["email"], rel))
    print("Then prepare the call: seed-coach agenda for %s." % rec["id"])
    return 0


# ------------------------------------------------------------ status

def funnel(pipe):
    recs = pipe["investors"]
    return {"drafted": len(recs),
            "sent": sum(1 for r in recs if out_touches(r)),
            "replied": sum(1 for r in recs if in_touches(r)),
            "interested": sum(1 for r in recs if r.get("status") in ("interested", "booked")
                              or "Interested" in (r.get("labels") or [])),
            "booked": sum(1 for r in recs if r.get("status") == "booked")}


def cmd_status(a):
    today = get_today(a)
    cfg = read_json(os.path.join(a.dir, "config.json"), "config", required=False) or {}
    rules = outreach_rules(cfg)
    pipe = load_pipe(a.dir)
    if a.id:
        rec = find(pipe, a.id)
        if a.json:
            print(json.dumps(rec, indent=2, ensure_ascii=False))
            return 0
        print("%s, %s <%s>: %s%s" % (rec["name"], rec["firm"], rec["email"], rec["status"],
                                     " (%s)" % ", ".join(rec["labels"]) if rec.get("labels") else ""))
        for h in rec.get("history", []):
            print("  %s  %-14s %s" % (h["date"], h["event"], h.get("note", "")))
        if rec.get("next_due"):
            print("  next follow-up: %s" % rec["next_due"])
        if rec.get("call"):
            print("  call: %s %s (%s UTC)" % (rec["call"]["local"], rec["call"]["tz"], rec["call"]["start_utc"]))
        return 0
    f = funnel(pipe)
    recs = pipe["investors"]
    by = {}
    for r in recs:
        by[r.get("status")] = by.get(r.get("status"), 0) + 1
    waiting = sum(1 for r in recs if (r.get("draft") or {}).get("state") == "drafted")
    approved = sum(1 for r in recs if (r.get("draft") or {}).get("state") == "approved")
    due = sum(1 for r in recs if not r.get("draft") and next_due(r, rules) and next_due(r, rules) <= today)
    calls = [r for r in recs if r.get("status") == "booked" and r.get("call")]
    rate = (100.0 * f["replied"] / f["sent"]) if f["sent"] else 0.0
    if a.json:
        print(json.dumps({"date": today.isoformat(), "funnel": f, "reply_rate_pct": round(rate, 1),
                          "by_status": {str(k): v for k, v in sorted(by.items(), key=lambda x: str(x[0]))},
                          "waiting_for_yes": waiting, "approved_not_sent": approved, "followups_due": due,
                          "calls": [dict(r["call"], id=r["id"], name=r["name"], firm=r["firm"]) for r in calls]},
                         indent=2, ensure_ascii=False))
        return 0
    name = ((cfg.get("startup") or {}).get("name") or "Outreach")
    print("%s outreach, %s" % (name, short_day(today)))
    for k in ("drafted", "sent", "replied", "interested", "booked"):
        extra = "  (%.0f%% of sent)" % rate if k == "replied" and f["sent"] else ""
        print("  %-11s %4d%s" % (k, f[k], extra))
    stopped = [(s, by.get(s, 0)) for s in TERMINAL if by.get(s)]
    if stopped:
        soft = sum(1 for r in recs if r.get("status") == "passed" and "Not now" in (r.get("labels") or []))
        print("  stopped: %s" % ", ".join("%d %s%s" % (n, s, " (%d not now)" % soft if s == "passed" and soft else "")
                                          for s, n in stopped))
    print("  waiting for a yes: %d   approved, not sent: %d   follow-ups due today: %d" % (waiting, approved, due))
    for r in calls:
        print("  call: %s (%s) %s %s" % (r["name"], r["firm"], r["call"]["local"], r["call"]["tz"]))
    return 0


# ------------------------------------------------------------ main

def main(argv=None):
    ap = argparse.ArgumentParser(description="The Closer: investor outreach drafts, the pipeline, follow-ups and "
                                             "the invite. It never sends anything.")
    sub = ap.add_subparsers(dest="cmd")

    def base(p, today=True):
        p.add_argument("--dir", default="seed", help="the seed folder (default ./seed)")
        if today:
            p.add_argument("--today", help="YYYY-MM-DD (default: today on this computer)")
        return p

    p = base(sub.add_parser("draft", help="one .eml intro per investor from investors.json + the template"))
    p.add_argument("--ids", help="comma-separated investor ids (default: everyone not yet in the pipeline)")
    p.add_argument("--top", type=int, help="the N best fits")
    p.add_argument("--min-fit", type=float)
    p.add_argument("--template")
    p.add_argument("--dry-run", action="store_true", help="show what would be drafted, write nothing")
    for name in ("batch", "approve"):
        p = base(sub.add_parser(name, help="show the batch waiting for a yes" if name == "batch"
                                else "record the user's yes for one batch"))
        p.add_argument("--ids")
        p.add_argument("--limit", type=int)
        if name == "batch":
            p.add_argument("--json", action="store_true")
        else:
            p.add_argument("--batch", required=True, help="the batch id that batch printed")
            p.add_argument("--reply", required=True, help="the user's reply, word for word")
    p = base(sub.add_parser("outbox", help="the approved emails, exactly as Claude sends them"), today=False)
    p.add_argument("--json", action="store_true")
    p = base(sub.add_parser("log", help="record sent / denied / a reply / a note"))
    p.add_argument("--id", required=True, help="an id, or several comma separated")
    p.add_argument("--event", required=True, choices=EVENTS)
    p.add_argument("--date", help="YYYY-MM-DD (default --today)")
    p.add_argument("--thread-id")
    p.add_argument("--note")
    p = base(sub.add_parser("due", help="who gets a follow-up today"))
    p.add_argument("--json", action="store_true")
    p = base(sub.add_parser("followup", help="draft the next touch"))
    p.add_argument("--id")
    p.add_argument("--due", action="store_true", help="everyone due today")
    p.add_argument("--extra", help="one short extra line for follow-up 1, like a demo link")
    p.add_argument("--ask", help="the question for follow-up 2, like \"would Thursday at 10 work for 20 minutes?\"")
    p.add_argument("--template")
    p = base(sub.add_parser("reply", help="draft an answer in an ongoing conversation"))
    p.add_argument("--id", required=True)
    p.add_argument("--body")
    p.add_argument("--body-file")
    p = base(sub.add_parser("inbox", help="sort pasted replies by rules, and record them with --write"))
    p.add_argument("--file")
    p.add_argument("--text")
    p.add_argument("--id")
    p.add_argument("--from", dest="sender")
    p.add_argument("--subject")
    p.add_argument("--date")
    p.add_argument("--write", action="store_true")
    p.add_argument("--json", action="store_true")
    p = base(sub.add_parser("book", help="write calls/<id>.ics, a calendar invite"))
    p.add_argument("--id", required=True)
    p.add_argument("--start", required=True, help="\"2026-11-05 10:00\" in --tz, or 2026-11-05T15:00Z")
    p.add_argument("--tz", default="America/New_York")
    p.add_argument("--minutes", type=int, default=30)
    p.add_argument("--end", help="HH:MM, instead of --minutes")
    p.add_argument("--link")
    p.add_argument("--location")
    p.add_argument("--title")
    p.add_argument("--stamp", help="DTSTAMP in UTC, like 2026-11-02T15:04:00Z (default: now)")
    p = base(sub.add_parser("status", help="the funnel"))
    p.add_argument("--id")
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"draft": cmd_draft, "batch": cmd_batch, "approve": cmd_approve, "outbox": cmd_outbox,
                "log": cmd_log, "due": cmd_due, "followup": cmd_followup, "reply": cmd_reply,
                "inbox": cmd_inbox, "book": cmd_book, "status": cmd_status}[a.cmd](a)
    except CloserError as e:
        print("closer.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
