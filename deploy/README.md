# Server deploy files (Lightsail / Caddy, 54.243.31.14)

These are the server variants of the pages (they call the server-side `/api/workorders` and
`/desk365-api` proxies instead of holding API keys in the browser). Regenerated from the repo
pages; no secrets inside.

| Local file                          | Goes to (site)                         | Notes |
|-------------------------------------|----------------------------------------|-------|
| `workorders/work-orders.html`       | workorders.choosegulfcoast.com         | Lynx Locks tab included |
| `workorders/index.html`             | workorders.choosegulfcoast.com         | same file, served at `/` |
| `desk365/dashboard.html`            | desk365.choosegulfcoast.com            | adds the "Work Orders" header button |

Copy each file over the existing one in that site's web root (the Caddy `root` for the site;
the desk365 root file may be named `index.html` rather than `dashboard.html` — check what is
already there and overwrite that name). Caddy serves static files, so no restart is needed.

## tickets.choosegulfcoast.com (in-house ticket system)

| Local file                    | Goes to                                  | Notes |
|-------------------------------|------------------------------------------|-------|
| `../tickets/index.html`       | `/var/www/tickets/index.html`            | published with `deploy/tickets/deploy.sh` |
| `tickets/Caddyfile.block`     | bottom of `/etc/caddy/Caddyfile`         | added once; then `caddy validate` and `systemctl reload caddy` |

The page holds only Supabase's public key. Sign-in is Microsoft: see "one-time Microsoft sign-in setup" in `tickets/README.md`.
