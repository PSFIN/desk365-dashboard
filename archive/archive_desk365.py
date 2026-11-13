#!/usr/bin/env python3
"""Phase 0 – archive every Desk365 ticket to a local JSONL file (resumable, rate-limit aware).

Raw output goes OUTSIDE the repo (default ~/desk365-archive/) because tickets contain personal
and HR data (custom fields such as salary and personal contact details). Never commit it.

  python3 -I archive/archive_desk365.py            # fetch / resume
  python3 -I archive/archive_desk365.py --verify   # check the dump, no API calls

The list endpoint returns custom fields (flattened as cf_*) and descriptions when asked, so no
per-ticket calls are needed for them. Conversations/activity are NOT available via the API.

Environment:
  DESK365_API_KEY      (or a line in ~/desk365-bot-runtime/.env)
  ARCHIVE_DIR          default ~/desk365-archive
  SECONDS_BETWEEN      default 120 -> ~30 calls/hour, leaving headroom for the dashboards/bot
  RESERVE              default 15  -> pause when fewer than this many calls remain in the hour
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://gulfcoast.desk365.io/apis/v3"
PAGE = 100
ARCHIVE_DIR = os.path.expanduser(os.environ.get("ARCHIVE_DIR", "~/desk365-archive"))
TICKETS = os.path.join(ARCHIVE_DIR, "tickets.jsonl")
STATE = os.path.join(ARCHIVE_DIR, "state.json")
SECONDS_BETWEEN = int(os.environ.get("SECONDS_BETWEEN", "120"))
RESERVE = int(os.environ.get("RESERVE", "15"))


def api_key():
    key = os.environ.get("DESK365_API_KEY")
    if key:
        return key
    path = os.path.expanduser("~/desk365-bot-runtime/.env")
    if os.path.exists(path):
        for line in open(path):
            if line.startswith("DESK365_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    sys.exit("DESK365_API_KEY not set")


def get(path, key):
    req = urllib.request.Request(API + path, headers={"Authorization": key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as res:
        remaining = res.headers.get("X-Rate-Limit-Remaining")
        return json.loads(res.read()), int(remaining) if remaining is not None else None


def load_state():
    if os.path.exists(STATE):
        return json.load(open(STATE))
    return {"next_offset": 0, "total": None, "pages": 0}


def save_state(state):
    tmp = STATE + ".tmp"
    json.dump(state, open(tmp, "w"))
    os.replace(tmp, STATE)


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def fetch():
    os.makedirs(ARCHIVE_DIR, mode=0o700, exist_ok=True)
    key = api_key()
    state = load_state()
    log(f"resuming at offset {state['next_offset']} (total {state['total']})")
    while state["total"] is None or state["next_offset"] < state["total"]:
        path = (f"/tickets?ticket_count={PAGE}&offset={state['next_offset']}"
                "&include_custom_fields=1&include_description=1&order_by=created_time&order_type=asc")
        try:
            data, remaining = get(path, key)
        except urllib.error.HTTPError as e:
            wait = 900 if e.code == 429 else 120
            log(f"HTTP {e.code}; sleeping {wait}s")
            time.sleep(wait)
            continue
        except (urllib.error.URLError, TimeoutError) as e:
            log(f"network error {e}; sleeping 60s")
            time.sleep(60)
            continue
        tickets = data.get("tickets", [])
        if not tickets:
            log("empty page; stopping")
            break
        with open(TICKETS, "a") as f:
            for t in tickets:
                f.write(json.dumps(t, separators=(",", ":")) + "\n")
        state["total"] = data.get("count", state["total"])
        state["next_offset"] += len(tickets)
        state["pages"] += 1
        save_state(state)
        log(f"offset {state['next_offset']}/{state['total']} (rate limit remaining: {remaining})")
        if state["next_offset"] >= state["total"]:
            break
        time.sleep(600 if remaining is not None and remaining < RESERVE else SECONDS_BETWEEN)
    log("fetch finished")
    verify()


def verify():
    if not os.path.exists(TICKETS):
        sys.exit("no dump yet")
    numbers, bad = [], 0
    for line in open(TICKETS):
        try:
            numbers.append(json.loads(line)["ticket_number"])
        except (ValueError, KeyError):
            bad += 1
    state = load_state()
    unique = set(numbers)
    log(f"lines={len(numbers)} unique={len(unique)} unparseable={bad} reported_total={state['total']}")
    if numbers:
        missing = [n for n in range(min(unique), max(unique) + 1) if n not in unique]
        log(f"ticket numbers {min(unique)}..{max(unique)}; gaps in sequence: {len(missing)}"
            + (f" e.g. {missing[:10]}" if missing else ""))
    if len(unique) != len(numbers):
        log("WARNING: duplicates in dump (loader upserts by ticket_number, so this is harmless)")


if __name__ == "__main__":
    verify() if "--verify" in sys.argv else fetch()
