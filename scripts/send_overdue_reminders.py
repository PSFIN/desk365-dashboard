"""
Runs on a schedule via .github/workflows/overdue-reminders.yml.

1. Fetches open/pending tickets from Desk365 (same auth pattern as main.py).
2. Filters to overdue ones, using the same rule as filterOverdue() in dashboard.html:
   due_date is set, due_date is in the past, and status isn't Closed/Archived.
3. Groups them by assignee email.
4. Makes sure the reminder bot is installed for each assignee (Graph app-only call,
   idempotent — harmless if already installed).
5. POSTs the grouped tickets to the PC-hosted bot's webhook, which sends each
   assignee their own Teams message.

Required environment variables (all provided as GitHub Actions secrets):
  DESK365_API_KEY, GRAPH_TENANT_ID, GRAPH_APP_ID, GRAPH_APP_SECRET,
  TEAMS_APP_CATALOG_ID, REMINDER_WEBHOOK_URL, REMINDER_WEBHOOK_SECRET

Optional:
  SKIP_TIME_CHECK=true      bypass the 9am ET window check (used for manual test runs)
  TEST_ASSIGNEE_EMAIL=...   only send to this one assignee, for a safe end-to-end test
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

API_KEY = os.environ["DESK365_API_KEY"]
API_BASE = "https://gulfcoast.desk365.io/apis/v3"
TICKET_URL_TMPL = "https://gulfcoast.desk365.io/app/tickets/ticketdetails?viewNumber=1&tktNum={n}"
EASTERN = ZoneInfo("America/New_York")


def fetch_json(url, method="GET", data=None, headers=None):
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=req_headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_open_pending_tickets():
    # NOTE: Desk365's documented `status=[...]` filter param is silently ignored by the API
    # (confirmed empirically — it returns the full unfiltered ticket set regardless). The
    # working param, taken from dashboard.html's loadData(), is `filters={"status": [...]}`.
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


def parse_due_date_et(due: str):
    """Desk365 due_date values (e.g. '2026-06-15 19:04:15') carry no timezone marker.
    They're treated as already being in America/New_York (matching how dashboard.html's
    browser-side `new Date(t.due_date)` renders them for these Eastern-based users), rather
    than assumed to be UTC — the two differ by several hours and would shift which tickets
    count as overdue right around midnight."""
    parsed = datetime.fromisoformat(due.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=EASTERN)
    return parsed.astimezone(EASTERN)


def is_overdue(ticket):
    due = ticket.get("due_date")
    if not due or ticket.get("status") in ("Closed", "Archived"):
        return False
    try:
        return parse_due_date_et(due).date() < datetime.now(EASTERN).date()
    except ValueError:
        return False


def build_payload(tickets):
    today = datetime.now(EASTERN).date()
    grouped = defaultdict(list)
    for t in tickets:
        if not is_overdue(t):
            continue
        email = (t.get("assigned_to") or "").strip().lower()
        if not email:
            continue
        due_date = parse_due_date_et(t["due_date"]).date()
        grouped[email].append({
            "ticket_number": t.get("ticket_number"),
            "subject": t.get("subject") or "(no subject)",
            "days_overdue": (today - due_date).days,
            "url": TICKET_URL_TMPL.format(n=t.get("ticket_number")),
        })
    return grouped


def get_graph_token():
    tenant_id = os.environ["GRAPH_TENANT_ID"]
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": os.environ["GRAPH_APP_ID"],
        "client_secret": os.environ["GRAPH_APP_SECRET"],
        "scope": "https://graph.microsoft.com/.default",
    }).encode()
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["access_token"]


def ensure_bot_installed(token, catalog_app_id, email):
    url = f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(email)}/teamwork/installedApps"
    body = {"teamsApp@odata.bind": f"https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/{catalog_app_id}"}
    try:
        fetch_json(url, method="POST", data=body, headers={"Authorization": f"Bearer {token}"})
        return True, "installed"
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return True, "already installed"
        return False, f"{e.code}: {e.read().decode(errors='ignore')[:200]}"


def in_send_window():
    now_et = datetime.now(EASTERN)
    return now_et.hour == 9 and now_et.minute < 30


def send_reminders(grouped):
    url = os.environ["REMINDER_WEBHOOK_URL"].rstrip("/") + "/api/send-overdue"
    req = urllib.request.Request(
        url,
        data=json.dumps(grouped).encode(),
        method="POST",
        headers={
            "Authorization": f'Bearer {os.environ["REMINDER_WEBHOOK_SECRET"]}',
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


REQUIRED_SETUP_VARS = [
    "GRAPH_TENANT_ID", "GRAPH_APP_ID", "GRAPH_APP_SECRET",
    "TEAMS_APP_CATALOG_ID", "REMINDER_WEBHOOK_URL", "REMINDER_WEBHOOK_SECRET",
]


def main():
    skip_time_check = os.environ.get("SKIP_TIME_CHECK", "false").lower() == "true"
    if not skip_time_check and not in_send_window():
        print(f"Current time in America/New_York is {datetime.now(EASTERN).strftime('%H:%M')} — outside the 9am send window, skipping.")
        return

    missing = [v for v in REQUIRED_SETUP_VARS if not os.environ.get(v)]
    if missing:
        print(f"::warning::Setup isn't finished yet — missing GitHub secret(s): {', '.join(missing)}. See teams-bot/README.md.")
        print("Still checking what Desk365 currently looks like, for visibility:")

    print("Fetching open/pending tickets from Desk365…")
    tickets = fetch_open_pending_tickets()
    print(f"Fetched {len(tickets)} tickets")

    grouped = build_payload(tickets)
    total_overdue = sum(len(v) for v in grouped.values())
    print(f"{total_overdue} overdue ticket(s) across {len(grouped)} assignee(s)")

    test_email = os.environ.get("TEST_ASSIGNEE_EMAIL", "").strip().lower()
    if test_email:
        grouped = {test_email: grouped.get(test_email, [])}
        print(f"TEST MODE: only sending to {test_email} ({len(grouped[test_email])} overdue ticket(s))")

    if not grouped:
        print("No overdue tickets to remind anyone about today.")
        return

    if missing:
        print("Stopping here — can't reach Graph or the bot webhook until the secrets above are set.")
        return

    print("Ensuring the reminder bot is installed for each assignee…")
    token = get_graph_token()
    catalog_app_id = os.environ["TEAMS_APP_CATALOG_ID"]
    for email in grouped:
        ok, info = ensure_bot_installed(token, catalog_app_id, email)
        print(f"  {email}: {'ok' if ok else 'FAILED'} ({info})")
        if not ok:
            print(f"::warning::Could not install reminder bot for {email}: {info}")

    print("Sending reminders via the PC webhook…")
    try:
        result = send_reminders(grouped)
    except urllib.error.HTTPError as e:
        print(f"::error::Webhook call failed: {e.code} {e.read().decode(errors='ignore')}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"::error::Could not reach the PC webhook (is the PC/tunnel up?): {e}")
        sys.exit(1)

    print("Webhook response:")
    print(json.dumps(result, indent=2))
    failures = [k for k, v in result.items() if v != "sent"]
    if failures:
        print(f"::warning::{len(failures)} assignee(s) did not get a reminder: {failures}")


if __name__ == "__main__":
    main()
