# Daily overdue-ticket Teams reminders — setup guide

Everything in this repo (manifest, `bot_service.py`, the GitHub Action) is already written.
This guide is only the steps **you** need to do in the Azure Portal, Teams Admin Center, and
on your Windows PC — none of this can be done from a coding session, since it needs your own
admin login.

Do these roughly in order; later steps depend on IDs/secrets from earlier ones.

## 1. Create the Azure Bot resource (free)

1. In the [Azure Portal](https://portal.azure.com), create a resource → search **"Azure Bot"**.
2. Pricing tier: **F0 (Free)**.
3. Type of App: **Multi Tenant** is fine unless your org requires otherwise.
4. This auto-creates an app registration for the bot. Open it (**Bot → Configuration → Manage
   Microsoft App ID**) and note:
   - **App ID** (a GUID) → this is `BOT_APP_ID`
   - Create a **client secret** (Certificates & secrets → New client secret) → this is
     `BOT_APP_PASSWORD`
5. **Bot → Channels** → add the **Microsoft Teams** channel.
6. **Bot → Configuration → Messaging endpoint** — leave a placeholder for now
   (`https://example.com/api/messages`); you'll come back and set the real tunnel URL in step 4.

## 2. Create a separate Graph app registration for GitHub Actions

Kept separate from the bot's own credentials (least privilege — this one can install apps for
users, the bot's credentials can only send messages).

1. Azure Portal → **Entra ID → App registrations → New registration**. Name it something like
   `desk365-reminder-installer`. No redirect URI needed.
2. Note the **Application (client) ID** → `GRAPH_APP_ID`, and **Directory (tenant) ID** →
   `GRAPH_TENANT_ID`.
3. **Certificates & secrets → New client secret** → `GRAPH_APP_SECRET`.
4. **API permissions → Add a permission → Microsoft Graph → Application permissions** → add
   `TeamsAppInstallation.ReadWriteForUser.All`.
5. Click **Grant admin consent** (needs a Global Admin or Privileged Role Admin — that may be
   you, or you may need to ask IT).

## 3. Upload the Teams app

1. First edit [`manifest/manifest.json`](manifest/manifest.json) in this repo: replace both
   `REPLACE_WITH_BOT_APP_ID` values with the **App ID** from step 1. Optionally swap
   `color.png`/`outline.png` for a nicer icon (the current ones are plain placeholders).
2. Zip the three files (`manifest.json`, `color.png`, `outline.png`) — the zip's *contents*
   must be the files directly, not a wrapping folder.
3. [Teams Admin Center](https://admin.teams.microsoft.com) → **Teams apps → Setup policies** →
   confirm custom/sideloaded apps are allowed (may already be on).
4. **Teams apps → Manage apps → Upload new app → Upload** → select the zip. This publishes it
   to your org's app catalog.
5. Click into the uploaded app and copy its **catalog app ID** from the URL or app details page
   → this is `TEAMS_APP_CATALOG_ID` (different from the Bot App ID from step 1 — this is the ID
   Teams assigned to the *catalog entry*).

## 4. Set up the Windows PC

1. Install [Python 3.11+](https://www.python.org/downloads/) and
   [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Copy this repo (or just the `teams-bot/` folder) onto the PC.
3. `cd teams-bot`, then:
   ```
   pip install -r requirements.txt
   copy .env.example .env
   ```
   Edit `.env` and fill in `BOT_APP_ID`, `BOT_APP_PASSWORD` (from step 1), and pick a random
   `REMINDER_WEBHOOK_SECRET` (any long random string — you'll put the same value in a GitHub
   secret later).
4. Test it runs: `python bot_service.py` — should print `Starting bot_service on port 3978…`
   with no errors. Ctrl+C to stop for now.
5. Start a tunnel: `cloudflared tunnel --url http://localhost:3978`. It prints a stable-ish
   `https://xxxxx.trycloudflare.com` URL — that's your public endpoint.
   - For a permanent setup, use a [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)
     instead (needs a free Cloudflare account + a domain, but gives a fixed URL that survives
     restarts instead of a new random one each time).
6. Go back to **Azure Bot → Configuration → Messaging endpoint** and set it to
   `https://<your-tunnel-url>/api/messages`.
7. Make both `bot_service.py` and `cloudflared tunnel …` start automatically and restart on
   crash/reboot — e.g. via **Task Scheduler** (trigger: at log on / at startup, with "restart
   task if it fails" configured), or wrap them as Windows services with
   [NSSM](https://nssm.cc/). Two long-running processes: the Python service and the tunnel.

## 5. Add GitHub repo secrets

**Settings → Secrets and variables → Actions → New repository secret**, one for each:

| Secret | Value |
|---|---|
| `GRAPH_TENANT_ID` | from step 2 |
| `GRAPH_APP_ID` | from step 2 |
| `GRAPH_APP_SECRET` | from step 2 |
| `TEAMS_APP_CATALOG_ID` | from step 3 |
| `REMINDER_WEBHOOK_URL` | your tunnel URL, e.g. `https://xxxxx.trycloudflare.com` (no trailing path) |
| `REMINDER_WEBHOOK_SECRET` | the same random string you put in the PC's `.env` |

(`DESK365_API_KEY` already exists from the ticket-fetch workflow.)

## 6. Get everyone signed up

The GitHub Action installs the bot for each assignee automatically the first time they show up
with an overdue ticket — no action needed from them beyond having a Teams account. The first
message they get from the bot is a one-time "you're set up" confirmation, then daily reminders
after that.

## 7. Test before trusting the schedule

Go to **Actions → Send Overdue Ticket Reminders → Run workflow**, and put your own email in
`test_assignee_email`. This bypasses the 9am time check and only messages you, so you can
confirm the whole chain works — Desk365 fetch → Graph install → PC webhook → Teams DM — without
spamming everyone. Check the workflow's logs for the webhook's response and any `::warning::`
lines.
