#!/usr/bin/env python3
"""Load the local Desk365 dump (~/desk365-archive/tickets.jsonl) into Supabase.

  python3 -I archive/load_supabase.py --dry-run   # map and validate only, no network
  python3 -I archive/load_supabase.py             # upsert into public.desk365_tickets

Credentials are read from the environment or from ~/desk365-archive/.env (never from the repo):
  SUPABASE_URL=https://<project>.supabase.co
  SUPABASE_SERVICE_KEY=<service_role key>     # server-side only; bypasses RLS
Safe to re-run: rows are upserted by ticket_number.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

ARCHIVE_DIR = os.path.expanduser(os.environ.get("ARCHIVE_DIR", "~/desk365-archive"))
TICKETS = os.path.join(ARCHIVE_DIR, "tickets.jsonl")
BATCH = 300
TS = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}")


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(ARCHIVE_DIR, ".env")
    if os.path.exists(path):
        for line in open(path):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return None


def ts(v):
    return v if isinstance(v, str) and TS.match(v) else None


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def row(t):
    # The list endpoint returns custom fields as a nested object {"cf_Name": value, ...} (every slot
    # present, mostly empty); keep only non-empty values and drop the cf_ prefix.
    nested = t.get("custom_fields") if isinstance(t.get("custom_fields"), dict) else {}
    custom = {k[3:] if k.startswith("cf_") else k: v for k, v in nested.items() if v not in (None, "", [])}
    return {
        "ticket_number": t["ticket_number"],
        "subject": t.get("subject"),
        "status": t.get("status"),
        "priority": num(t.get("priority")),
        "type": t.get("type"),
        "source": num(t.get("source")),
        "assigned_to": t.get("assigned_to"),
        "group_name": t.get("group"),
        "category": t.get("category"),
        "subcategory": t.get("subcategory"),
        "contact_name": t.get("contact_name"),
        "contact_email": t.get("contact_email"),
        "company_name": t.get("company_name"),
        "form_name": t.get("form_name"),
        "sla": t.get("sla"),
        "completed_within_sla": t.get("completed_within_sla") if isinstance(t.get("completed_within_sla"), bool) else None,
        "conversation_count": num(t.get("conversation_count")),
        "created_on": ts(t.get("created_on")),
        "updated_on": ts(t.get("updated_on")),
        "due_date": ts(t.get("due_date")),
        "resolved_on": ts(t.get("resolved_on")),
        "closed_on": ts(t.get("closed_on")),
        "first_response_time": ts(t.get("first_response_time")),
        "first_assigned_time": ts(t.get("first_assigned_time")),
        "closed_duration": num(t.get("closed_duration")),
        "resolved_duration": num(t.get("resolved_duration")),
        "first_replied_duration": num(t.get("first_replied_duration")),
        "first_assigned_duration": num(t.get("first_assigned_duration")),
        "watchers": t.get("watchers"),
        "share_to": t.get("share_to"),
        "custom_fields": custom or None,
        "description": t.get("description"),
        "description_text": t.get("description_text"),
        "raw": t,
    }


def post(url, key, rows):
    req = urllib.request.Request(
        url + "/rest/v1/desk365_tickets?on_conflict=ticket_number",
        data=json.dumps(rows).encode(),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120):
        pass


def main():
    dry = "--dry-run" in sys.argv
    rows, seen = [], set()
    for line in open(TICKETS):
        t = json.loads(line)
        if t["ticket_number"] in seen:
            continue
        seen.add(t["ticket_number"])
        rows.append(row(t))
    print(f"{len(rows)} unique tickets mapped")
    if dry:
        nonnull = {k: sum(1 for r in rows if r[k] is not None) for k in rows[0] if k != "raw"}
        print("non-null counts:", nonnull)
        return
    url, key = env("SUPABASE_URL"), env("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY in ~/desk365-archive/.env")
    url = url.rstrip("/")
    for i in range(0, len(rows), BATCH):
        try:
            post(url, key, rows[i:i + BATCH])
        except urllib.error.HTTPError as e:
            sys.exit(f"batch at {i} failed: HTTP {e.code} {e.read()[:300]!r}")
        print(f"loaded {min(i + BATCH, len(rows))}/{len(rows)}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
