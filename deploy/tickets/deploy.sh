#!/usr/bin/env bash
# Publishes the ticket page (index.html, logo, fonts) to tickets.choosegulfcoast.com (Lightsail, 54.243.31.14).
# Usage:  deploy/tickets/deploy.sh [ssh-key]
# First time only, the Caddy block in Caddyfile.block must be added to /etc/caddy/Caddyfile (see README).
set -euo pipefail
KEY="${1:-$HOME/.ssh/LightsailDefaultKey-us-east-1.pem}"
HOST="ubuntu@54.243.31.14"
cd "$(dirname "$0")/../.."
ssh -i "$KEY" "$HOST" 'mkdir -p /var/www/tickets/fonts'
scp -q -i "$KEY" tickets/index.html tickets/gulf-coast-logo.png "$HOST:/var/www/tickets/"
scp -q -i "$KEY" tickets/fonts/*.woff2 "$HOST:/var/www/tickets/fonts/"
echo "Published. Hard-refresh the page (Cmd+Shift+R) to see it."
