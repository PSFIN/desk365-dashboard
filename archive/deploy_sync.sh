#!/usr/bin/env bash
# Installs the Desk365 -> in-house sync on the Lightsail server (runs every 10 minutes).
# Run from the Mac:   archive/deploy_sync.sh [ssh-key]
#
# * Copies sync_desk365.py + load_supabase.py to ~/desk365-sync on the server.
# * First time only: creates ~/desk365-sync/.env from the Supabase settings in ~/desk365-archive/.env on this Mac
#   (never printed) and points the sync at the server's own read-only Desk365 proxy, so the Desk365 key is not copied.
# * Installs a systemd service + timer. To stop the sync (the day Desk365 is switched off):
#     ssh ... 'sudo systemctl disable --now desk365-sync.timer'
set -euo pipefail
KEY="${1:-$HOME/.ssh/LightsailDefaultKey-us-east-1.pem}"
HOST="ubuntu@54.243.31.14"
cd "$(dirname "$0")"

ssh -i "$KEY" "$HOST" 'mkdir -p ~/desk365-sync && chmod 700 ~/desk365-sync'
scp -q -i "$KEY" sync_desk365.py load_supabase.py "$HOST:desk365-sync/"

if ! ssh -i "$KEY" "$HOST" 'test -f ~/desk365-sync/.env'; then
  { grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_KEY)=' "$HOME/desk365-archive/.env"
    echo 'DESK365_BASE=https://desk365.choosegulfcoast.com/desk365-api'; } \
    | ssh -i "$KEY" "$HOST" 'cat > ~/desk365-sync/.env && chmod 600 ~/desk365-sync/.env'
  echo "created ~/desk365-sync/.env on the server"
fi

ssh -i "$KEY" "$HOST" 'sudo tee /etc/systemd/system/desk365-sync.service >/dev/null <<UNIT
[Unit]
Description=Desk365 -> in-house ticket system sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/desk365-sync
ExecStart=/usr/bin/python3 -I /home/ubuntu/desk365-sync/sync_desk365.py
UNIT
sudo tee /etc/systemd/system/desk365-sync.timer >/dev/null <<UNIT
[Unit]
Description=Run the Desk365 sync every 10 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
AccuracySec=30s

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now desk365-sync.timer >/dev/null && systemctl list-timers desk365-sync.timer --no-pager | head -n 3'
