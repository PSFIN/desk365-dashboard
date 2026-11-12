#!/usr/bin/env python3
"""Build data/vacancy.json: per-property days since last occupancy (and recent inspection).

Reads Streamline through the Cloudflare Worker proxy (credentials live in the worker):
  GetPropertyList, GetReservations (all pages), GetHousekeepingCleaningReport.
Writes only property-level facts (no guest names or contact details).

Occupancy = reservations with status_id 4 (confirmed / checked-in) or 5 (checked-out),
excluding Office blocks, inquiries and quotes. Cancelled and other statuses are ignored.
"""
import datetime as dt
import json
import os
import sys
import urllib.request

API_URL = os.environ.get("STREAMLINE_PROXY_URL", "https://streamline-proxy.psfin.workers.dev")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "vacancy.json")
OCCUPANCY_STATUS_IDS = {4, 5}
EXCLUDED_TYPES = {"OFF", "INQR", "QUOT"}


def call(method, params=None):
    req = urllib.request.Request(
        API_URL,
        data=json.dumps({"methodName": method, "params": params or {}}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "gulfcoast-dashboard-vacancy/1.0"},
    )
    with urllib.request.urlopen(req, timeout=180) as res:
        body = json.load(res)
    status = body.get("status")
    if status and status.get("code"):
        raise RuntimeError(f"{method}: {status.get('code')} {status.get('description')}")
    return body["data"]


def as_list(node, key):
    v = node.get(key, [])
    if isinstance(v, dict):
        v = v.get(key[:-1], v)
    if isinstance(v, dict):
        v = [v]
    return v or []


def parse(s):
    return dt.datetime.strptime(s, "%m/%d/%Y").date() if s and s != "N/A" else None


def main():
    today = dt.date.today()
    properties = as_list(call("GetPropertyList"), "property")

    reservations, page = [], 1
    while True:
        data = call("GetReservations", {"return_full": True, "page_number": page})
        reservations += as_list(data, "reservations")
        if page >= data["pagination"]["total_pages"]:
            break
        page += 1

    # Recent inspections: the HK report only covers a short window around today.
    last_inspection = {}
    try:
        hk = call("GetHousekeepingCleaningReport")
        for ev in as_list(hk, "reservations"):
            d = parse(ev.get("inspection_date"))
            if d and d <= today and (ev["unit_id"] not in last_inspection or d > last_inspection[ev["unit_id"]][0]):
                last_inspection[ev["unit_id"]] = (d, ev.get("inspector_name") or None)
    except Exception as exc:  # inspection info is optional; occupancy is the core data
        print(f"warning: housekeeping report unavailable: {exc}", file=sys.stderr)

    by_unit = {}
    for r in reservations:
        if r.get("status_id") in OCCUPANCY_STATUS_IDS and r.get("type_name") not in EXCLUDED_TYPES:
            by_unit.setdefault(r["unit_id"], []).append(r)

    units = []
    for p in properties:
        stays = by_unit.get(p["id"], [])
        current = any(parse(s["startdate"]) <= today < parse(s["enddate"]) for s in stays)
        ended = [parse(s["enddate"]) for s in stays if parse(s["enddate"]) <= today]
        upcoming = [parse(s["startdate"]) for s in stays if parse(s["startdate"]) > today]
        last_out = max(ended) if ended else None
        insp = last_inspection.get(p["id"])
        units.append({
            "id": p["id"],
            "name": p.get("name"),
            "area": p.get("location_area_name"),
            "community": p.get("community"),
            "status": p.get("status_name"),
            "occupied_now": current,
            "last_checkout": last_out.isoformat() if last_out else None,
            "days_vacant": None if current or not last_out else (today - last_out).days,
            "next_arrival": min(upcoming).isoformat() if upcoming else None,
            "last_inspection": insp[0].isoformat() if insp else None,
            "last_inspector": insp[1] if insp else None,
        })

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "as_of": today.isoformat(),
        "units": sorted(units, key=lambda u: (u["name"] or "").lower()),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    vacant = [u for u in units if not u["occupied_now"]]
    over30 = [u for u in vacant if u["days_vacant"] is None or u["days_vacant"] > 30]
    print(f"{len(units)} properties, {len(vacant)} vacant now, {len(over30)} vacant over 30 days -> {OUT}")


if __name__ == "__main__":
    main()
