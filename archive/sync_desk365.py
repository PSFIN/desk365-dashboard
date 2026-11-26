#!/usr/bin/env python3
"""Keep the in-house system in step with Desk365 until Desk365 is switched off.

Every run asks Desk365 for the tickets changed recently (newest update first), and upserts them into
Supabase `public.desk365_tickets` (the table the ticket page reads Desk365 tickets from). New Desk365
tickets and changes to old ones (status, assignee, ...) therefore show up in the new system within minutes.

  python3 -I archive/sync_desk365.py --dry-run             # show what would change, write nothing
  python3 -I archive/sync_desk365.py                       # normal run (what the timer does)
  python3 -I archive/sync_desk365.py --since "2026-11-13 09:00:00"   # catch up from an earlier point

How it avoids losing changes
  * The starting point is the newest `updated_on` already stored, minus OVERLAP_MINUTES (re-sending a
    ticket is harmless: rows are upserted by ticket number).
  * ALL pages are fetched first and written afterwards, oldest first, so a failure halfway can never move
    the starting point past tickets that were not saved.
  * Stops early when Desk365's hourly call allowance runs low, and never makes more than MAX_PAGES calls.

Settings (environment, or a .env file next to this script, or ~/desk365-archive/.env):
  SUPABASE_URL, SUPABASE_SERVICE_KEY        required
  DESK365_API_KEY                           direct Desk365 access, or instead
  DESK365_BASE                              e.g. https://desk365.choosegulfcoast.com/desk365-api (the server's
                                            read-only proxy, which adds the key; no key needed here)

Limits: conversations/replies are not available from Desk365's API, so they are not copied. Tickets deleted or
merged in Desk365 are not removed here.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load_supabase as ls  # row mapping + upsert (same code as the one-off load)

DEFAULT_BASE = "https://gulfcoast.desk365.io/apis/v3"
PAGE = 100            # Desk365 allows 30, 50 or 100
MAX_PAGES = 20        # at most 2,000 tickets per run
OVERLAP_MINUTES = 60
MIN_REMAINING = 8     # stop when Desk365 says fewer calls than this remain this hour


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def read_env_files():
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, ".env"), os.path.expanduser("~/desk365-archive/.env")):
        if os.path.exists(path):
            for line in open(path):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def desk365_get(path):
    base = os.environ.get("DESK365_BASE") or DEFAULT_BASE
    headers = {"Accept": "application/json"}
    if os.environ.get("DESK365_API_KEY"):
        headers["Authorization"] = os.environ["DESK365_API_KEY"]
    req = urllib.request.Request(base.rstrip("/") + path, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as res:
        rem = res.headers.get("X-Rate-Limit-Remaining")
        return json.loads(res.read()), int(rem) if rem is not None else None


def supabase_get(path):
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(url + "/rest/v1/" + path, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def minus_minutes(ts, minutes):
    t = time.strptime(ts[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.mktime(t) - minutes * 60))


def main():
    dry = "--dry-run" in sys.argv
    since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else None
    read_env_files()
    for need in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        if not os.environ.get(need):
            sys.exit(f"{need} is not set")
    if not (os.environ.get("DESK365_API_KEY") or os.environ.get("DESK365_BASE")):
        sys.exit("Set DESK365_API_KEY or DESK365_BASE")

    top = supabase_get("desk365_tickets?select=ticket_number,updated_on&order=updated_on.desc&limit=1")
    if not top:
        sys.exit("desk365_tickets is empty: run the one-off archive first")
    max_number = supabase_get("desk365_tickets?select=ticket_number&order=ticket_number.desc&limit=1")[0]["ticket_number"]
    cutoff = since or minus_minutes(top[0]["updated_on"], OVERLAP_MINUTES)
    log(f"newest stored update {top[0]['updated_on']}; fetching tickets updated since {cutoff}")

    collected, pages = {}, 0
    while pages < MAX_PAGES:
        q = urllib.parse.urlencode({
            "ticket_count": PAGE, "offset": pages * PAGE, "order_by": "updated_time", "order_type": "desc",
            "include_custom_fields": 1, "include_description": 1,
        })
        try:
            data, remaining = desk365_get("/tickets?" + q)
        except urllib.error.HTTPError as e:
            sys.exit(f"Desk365 returned HTTP {e.code}; nothing was written")
        pages += 1
        tickets = data.get("tickets", [])
        for t in tickets:
            if (t.get("updated_on") or "") >= cutoff:
                collected[t["ticket_number"]] = t
        done = not tickets or len(tickets) < PAGE or (tickets[-1].get("updated_on") or "") < cutoff
        if done:
            break
        if remaining is not None and remaining < MIN_REMAINING:
            sys.exit(f"Desk365 call allowance is low ({remaining} left); stopping without writing. Try again later.")
    else:
        log(f"reached the {MAX_PAGES}-page limit; the next run continues from the newest stored update")

    rows = [ls.row(t) for t in sorted(collected.values(), key=lambda t: t.get("updated_on") or "")]  # oldest first
    new = sum(1 for r in rows if r["ticket_number"] > max_number)
    log(f"{len(rows)} changed ticket(s) in {pages} call(s); {new} new (above #{max_number})")
    if dry:
        log("dry run: nothing written")
        return
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_KEY"]
    for i in range(0, len(rows), ls.BATCH):
        ls.post(url, key, rows[i:i + ls.BATCH])
    log("done")


if __name__ == "__main__":
    main()
