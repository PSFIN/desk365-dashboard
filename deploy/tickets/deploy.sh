#!/usr/bin/env bash
# Publishes tickets/index.html to tickets.choosegulfcoast.com (Lightsail, 54.243.31.14).
# Usage:  deploy/tickets/deploy.sh [ssh-key]
# First time only, the Caddy block in Caddyfile.block must be added to /etc/caddy/Caddyfile (see README).
set -euo pipefail
KEY="${1:-$HOME/.ssh/LightsailDefaultKey-us-east-1.pem}"
HOST="ubuntu@54.243.31.14"
cd "$(dirname "$0")/../.."
scp -i "$KEY" tickets/index.html "$HOST:/var/www/tickets/index.html"
echo "Published. Hard-refresh the page (Cmd+Shift+R) to see it."
