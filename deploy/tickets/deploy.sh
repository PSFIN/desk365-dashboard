#!/usr/bin/env bash
# Publishes the ticket page (index.html, style.css, app.js, charts.js, dashboard.js, meetings.js, logo, fonts; never tickets/dev/) to tickets.choosegulfcoast.com (Lightsail, 54.243.31.14).
# Usage:  deploy/tickets/deploy.sh [ssh-key]
# First time only, the Caddy block in Caddyfile.block must be added to /etc/caddy/Caddyfile (see README).
set -euo pipefail
KEY="${1:-$HOME/.ssh/LightsailDefaultKey-us-east-1.pem}"
HOST="ubuntu@54.243.31.14"
cd "$(dirname "$0")/../.."
ssh -i "$KEY" "$HOST" 'mkdir -p /var/www/tickets/fonts'
scp -q -i "$KEY" tickets/index.html tickets/style.css tickets/app.js tickets/charts.js tickets/dashboard.js tickets/meetings.js tickets/gulf-coast-logo.png "$HOST:/var/www/tickets/"
scp -q -i "$KEY" tickets/fonts/*.woff2 "$HOST:/var/www/tickets/fonts/"
echo "Published. Hard-refresh the page (Cmd+Shift+R) to see it."
