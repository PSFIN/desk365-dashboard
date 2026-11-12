#!/usr/bin/env python3
"""Import a Streamline 'Property Care > Housekeeping Reports > Inspection Report' Excel export.

Usage: python3 -I scripts/import_inspections.py ~/Downloads/excel_housekeeping_inspection.xls

The export is an HTML table saved as .xls. Writes data/inspection_history.json with the latest
COMPLETED inspection (Inspection Status "I") per unit name. build_vacancy.py merges this with the
inspections it accumulates daily from the API. Re-run with a fresh export to refresh history.
"""
import datetime as dt
import html
import json
import os
import re
import sys
from html.parser import HTMLParser

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "inspection_history.json")


class Table(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cur, self.cell, self.on = [], None, None, False

    def handle_starttag(self, tag, attrs):
        if tag == "table" and dict(attrs).get("id") == "housekeeping_maintenance_inspection":
            self.on = True
        if not self.on:
            return
        if tag == "tr":
            self.cur = []
        elif tag in ("td", "th"):
            self.cell = []

    def handle_endtag(self, tag):
        if not self.on:
            return
        if tag in ("td", "th") and self.cell is not None:
            self.cur.append(html.unescape("".join(self.cell)).strip())
            self.cell = None
        elif tag == "tr" and self.cur is not None:
            self.rows.append(self.cur)
            self.cur = None
        elif tag == "table":
            self.on = False

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def date(s):
    try:
        return dt.datetime.strptime(s, "%m/%d/%y").date()
    except ValueError:
        return None


def main(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    table = Table()
    table.feed(text)
    header, rows = table.rows[0], table.rows[1:]
    ix = {h: i for i, h in enumerate(header)}
    start = re.search(r"Start Date:\s*([\d/]+)", text)
    end = re.search(r"End Date:\s*([\d/]+)", text)
    today = dt.date.today()
    units = {}
    for r in rows:
        if len(r) < len(header) or r[ix["Inspection Status"]] != "I":
            continue
        d = date(r[ix["Inspection Date"]])
        if not d or d > today:
            continue
        key = r[ix["Unit"]].strip().lower()
        if key not in units or d.isoformat() > units[key]["date"]:
            units[key] = {"date": d.isoformat(), "inspector": r[ix["Inspector"]] or None}
    out = {
        "source": os.path.basename(path),
        "report_start": dt.datetime.strptime(start.group(1), "%m/%d/%Y").date().isoformat() if start else None,
        "report_end": dt.datetime.strptime(end.group(1), "%m/%d/%Y").date().isoformat() if end else None,
        "units": units,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=0, sort_keys=True)
    print(f"{len(rows)} rows, {len(units)} units with a completed inspection -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
