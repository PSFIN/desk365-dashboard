"""
One-off: installs the Desk365 Reminders Teams app into a specific team (e.g. "All Staff"),
so the bot can post channel announcements there (see /api/post-channel in
teams-bot/bot_service.py). This is separate from send_overdue_reminders.py's per-person
install, which uses a different Graph permission.

Run via the "Install Reminder Bot Into a Team" GitHub Actions workflow, passing the
target team's Group ID.

Requires the Graph app registration (GRAPH_APP_ID) to have been granted the
TeamsAppInstallation.ReadWriteForTeam.All *application* permission — Azure Portal >
Entra ID > App registrations > (the Graph app) > API permissions > Add a permission >
Microsoft Graph > Application permissions > search it > Add > Grant admin consent.
This is the same kind of step already done once for TeamsAppInstallation.ReadWriteForUser.All.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


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
        raw = r.read()
        return json.loads(raw) if raw else {}


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


def main():
    team_id = os.environ["TEAM_ID"].strip()
    catalog_app_id = os.environ["TEAMS_APP_CATALOG_ID"]
    token = get_graph_token()

    url = f"https://graph.microsoft.com/v1.0/teams/{team_id}/installedApps"
    body = {"teamsApp@odata.bind": f"https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/{catalog_app_id}"}
    try:
        fetch_json(url, method="POST", data=body, headers={"Authorization": f"Bearer {token}"})
        print(f"Installed for team {team_id}. Check bot_service.log for the conversationUpdate "
              f"callback that stores its channel_refs.json entry.")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="ignore")
        if e.code == 409:
            print(f"Already installed for team {team_id}")
            return
        print(f"::error::Install failed: {e.code}: {body_text[:500]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
