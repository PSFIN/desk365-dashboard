"""
Runs on a schedule via .github/workflows/track-activity.yml.

Desk365's API has no audit/history endpoint — confirmed by testing every plausible
endpoint pattern (activities, conversations, history, audit, timeline, logs) against a
real ticket, all 404, and cross-checked against Desk365's own public API docs, which list
no such endpoint either. So there's no way to pull "who assigned/reassigned/updated what"
retroactively. This script is the only real alternative: snapshot ticket state each run,
diff it against the previous snapshot, and log whatever changed. It only sees change from
the point this started running onward — nothing before that is recoverable.

1. Fetches current open/pending tickets from Desk365.
2. Loads the last snapshot (data/ticket_snapshot.json) and diffs it against the current
   state: assignee, status, due date, priority changes; new tickets; tickets that dropped
   out of the open/pending set (most likely closed or resolved).
3. Appends any detected changes to data/activity_log.json (capped at MAX_LOG_ENTRIES,
   oldest trimmed first) and overwrites the snapshot for next run's comparison.

Required environment variables:
  DESK365_API_KEY
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ["DESK365_API_KEY"]
API_BASE = "https://gulfcoast.desk365.io/apis/v3"

DATA_DIR = Path(__file__).parent.parent / "data"
SNAPSHOT_FILE = DATA_DIR / "ticket_snapshot.json"
LOG_FILE = DATA_DIR / "activity_log.json"
MAX_LOG_ENTRIES = 1000

TRACKED_FIELDS = ["assigned_to", "status", "due_date", "priority"]


def fetch_json(url, headers=None):
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def fetch_open_pending_tickets():
    tickets = []
    offset = 0
    per_page = 100
    filter_param = urllib.parse.quote(json.dumps({"status": ["Open", "Pending"]}))
    while True:
        url = f"{API_BASE}/tickets?ticket_count={per_page}&offset={offset}&filters={filter_param}"
        data = fetch_json(url, headers={"Authorization": API_KEY})
        batch = data.get("tickets") or data.get("data") or []
        if not batch:
            break
        tickets.extend(batch)
        offset += per_page
        if len(batch) < per_page:
            break
    return tickets


def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default


def build_snapshot(tickets):
    snap = {}
    for t in tickets:
        num = t.get("ticket_number")
        if num is None:
            continue
        snap[str(num)] = {
            "subject": t.get("subject") or "(no subject)",
            "assigned_to": t.get("assigned_to"),
            "status": t.get("status"),
            "due_date": t.get("due_date"),
            "priority": t.get("priority"),
        }
    return snap


def diff_snapshots(prev, curr, now_iso):
    events = []

    for num, cur in curr.items():
        old = prev.get(num)
        if old is None:
            events.append({
                "ts": now_iso, "ticket_number": int(num), "subject": cur["subject"],
                "type": "created",
                "detail": f"Created — assigned to {cur['assigned_to'] or 'nobody yet'}, status {cur['status']}",
            })
            continue

        if old.get("assigned_to") != cur.get("assigned_to"):
            was, now = old.get("assigned_to"), cur.get("assigned_to")
            if not was and now:
                etype, detail = "assigned", f"Assigned to {now}"
            elif was and not now:
                etype, detail = "unassigned", f"Unassigned (was {was})"
            else:
                etype, detail = "reassigned", f"Reassigned from {was} to {now}"
            events.append({"ts": now_iso, "ticket_number": int(num), "subject": cur["subject"],
                            "type": etype, "detail": detail, "from": was, "to": now})

        if old.get("status") != cur.get("status"):
            events.append({
                "ts": now_iso, "ticket_number": int(num), "subject": cur["subject"],
                "type": "status_changed", "detail": f"Status changed from {old.get('status')} to {cur.get('status')}",
                "from": old.get("status"), "to": cur.get("status"),
            })

        if old.get("due_date") != cur.get("due_date"):
            events.append({
                "ts": now_iso, "ticket_number": int(num), "subject": cur["subject"],
                "type": "due_date_changed",
                "detail": f"Due date changed from {old.get('due_date') or 'none'} to {cur.get('due_date') or 'none'}",
                "from": old.get("due_date"), "to": cur.get("due_date"),
            })

        if old.get("priority") != cur.get("priority"):
            events.append({
                "ts": now_iso, "ticket_number": int(num), "subject": cur["subject"],
                "type": "priority_changed",
                "detail": f"Priority changed from {old.get('priority')} to {cur.get('priority')}",
                "from": old.get("priority"), "to": cur.get("priority"),
            })

    for num, old in prev.items():
        if num not in curr:
            events.append({
                "ts": now_iso, "ticket_number": int(num), "subject": old["subject"],
                "type": "closed", "detail": f"Left the open/pending list (last status: {old.get('status')}) — likely closed or resolved",
            })

    return events


def main():
    DATA_DIR.mkdir(exist_ok=True)
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

    print("Fetching open/pending tickets from Desk365…")
    tickets = fetch_open_pending_tickets()
    print(f"Fetched {len(tickets)} tickets")

    curr_snapshot = build_snapshot(tickets)
    prev_snapshot = load_json(SNAPSHOT_FILE, None)

    if prev_snapshot is None:
        print("No previous snapshot found — this is the first run. Saving baseline, nothing to log yet.")
        SNAPSHOT_FILE.write_text(json.dumps(curr_snapshot, indent=2))
        return

    events = diff_snapshots(prev_snapshot, curr_snapshot, now_iso)
    print(f"{len(events)} change(s) detected")
    for e in events:
        print(f"  #{e['ticket_number']}: {e['detail']}")

    if events:
        log = load_json(LOG_FILE, [])
        log = events + log  # newest first
        log = log[:MAX_LOG_ENTRIES]
        LOG_FILE.write_text(json.dumps(log, indent=2))

    SNAPSHOT_FILE.write_text(json.dumps(curr_snapshot, indent=2))


if __name__ == "__main__":
    main()
