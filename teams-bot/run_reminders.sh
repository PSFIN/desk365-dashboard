#!/bin/bash
# Run by launchd (com.desk365.reminders) Mon/Wed/Fri at 9:00 local time. Lives in
# ~/desk365-bot-runtime/ next to the bot (launchd can't read iCloud Drive paths).
#
# Calls the bot on localhost instead of going through the Cloudflare tunnel and GitHub
# Actions — no tunnel URL to keep updating, no dependence on GitHub's cron, which has been
# firing hours late. Same script (send_overdue_reminders.py) as the GitHub workflow, so this
# moves to an always-on server (AWS etc.) unchanged: copy this folder, point launchd/cron at it.
#
# DRY_RUN=true ./run_reminders.sh   -> prints who would be messaged, sends nothing
cd "$(dirname "$0")" || exit 1

# Read only the vars we need from .env rather than executing the file as shell.
for v in REMINDER_WEBHOOK_SECRET DESK365_API_KEY PORT GRAPH_TENANT_ID GRAPH_APP_ID GRAPH_APP_SECRET TEAMS_APP_CATALOG_ID; do
  val=$(grep -m1 "^$v=" .env | cut -d= -f2-)
  [ -n "$val" ] && export "$v=$val"
done

export REMINDER_WEBHOOK_URL="http://localhost:${PORT:-3978}"
# A run delayed by the Mac being asleep at 9:00 still sends, up to noon ET.
export SEND_WINDOW_MINUTES="${SEND_WINDOW_MINUTES:-180}"

echo "=== $(date) ==="
exec .venv/bin/python send_overdue_reminders.py
