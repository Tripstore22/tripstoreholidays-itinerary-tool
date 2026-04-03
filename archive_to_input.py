"""
archive_to_input.py
--------------------
Reads past itinerary data from ./output/itinerary-archive.csv,
extracts every unique hotel, tour, train, and transfer mentioned,
compares against the master Google Sheets (Hotels / Sightseeing / Trains / Transfers),
and appends only MISSING items to the corresponding INPUT_* sheets so that
Pipeline.gs can enrich them overnight.

Requirements:
    pip install gspread google-auth

Usage:
    python archive_to_input.py
"""

import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    sys.exit("Missing dependencies. Run:  pip install gspread google-auth")


# ── Configuration ─────────────────────────────────────────────────────────────

SPREADSHEET_ID   = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
CSV_PATH         = Path("./output/itinerary-archive.csv")
CREDENTIALS_PATH = Path("./sheets-credentials.json")

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Sheet names — must match the Google Sheet tab names exactly
MASTER = {
    "hotels":      "Hotels",
    "sightseeing": "Sightseeing",
    "trains":      "Trains",
    "transfers":   "Transfers",
}
INPUT = {
    "hotels":      "INPUT_Hotels",
    "sightseeing": "INPUT_Sightseeing",
    "trains":      "INPUT_Trains",
    "transfers":   "INPUT_Transfers",
}

ADDED_BY = "ARCHIVE_IMPORT"
STATUS   = "PENDING"


# ── Archive cell parsers ───────────────────────────────────────────────────────

def _parts(cell: str) -> list[str]:
    """Split a cell on '|' and strip every token, dropping blanks."""
    return [p.strip() for p in (cell or "").split("|") if p.strip()]


def parse_hotels_cell(cell: str) -> list[dict]:
    """
    Format: 'Paris|Radisson Blu Hotel Paris|3N|INR 76921 | Brussels|Thon Hotel|2N|INR 55000'
    Each hotel entry = 4 pipe-delimited fields: city | name | nights | cost
    """
    parts = _parts(cell)
    result = []
    for i in range(0, len(parts) - 3, 4):
        city  = parts[i]
        name  = parts[i + 1]
        cost  = re.sub(r"[^\d.]", "", parts[i + 3]) if i + 3 < len(parts) else ""
        if city and name:
            result.append({"city": city, "name": name, "cost_inr": cost})
    return result


def parse_sightseeing_cell(cell: str) -> list[dict]:
    """
    Format: 'Paris|Eiffel Tower|INR 3500 | Paris|Louvre Museum|INR 2800'
    Each entry = 3 pipe-delimited fields: city | tour name | cost
    """
    parts = _parts(cell)
    result = []
    for i in range(0, len(parts) - 2, 3):
        city = parts[i]
        name = parts[i + 1]
        cost = re.sub(r"[^\d.]", "", parts[i + 2]) if i + 2 < len(parts) else ""
        if city and name:
            result.append({"city": city, "name": name, "cost_inr": cost})
    return result


def parse_trains_cell(cell: str) -> list[dict]:
    """
    Format: 'Paris to Brussels|INR 22550 | Amsterdam to Paris|INR 18000'
    Each entry = 2 pipe-delimited fields: description | cost
    Description is 'From City to To City' optionally with '(via Somewhere)'
    """
    parts = _parts(cell)
    result = []
    for i in range(0, len(parts) - 1, 2):
        desc = parts[i]
        cost = re.sub(r"[^\d.]", "", parts[i + 1]) if i + 1 < len(parts) else ""

        mode = "Ferry" if re.search(r"\b(ferry|boat|ship|sail)\b", desc, re.I) else "Train"

        lower = desc.lower()
        if " to " not in lower:
            continue  # can't parse direction — skip

        idx       = lower.index(" to ")
        from_city = desc[:idx].strip()
        to_part   = desc[idx + 4:].strip()

        # Extract stopover from "(via Amsterdam)"
        stopover  = ""
        via_match = re.search(r"\(via\s+(.+?)\)", to_part, re.I)
        if via_match:
            stopover = via_match.group(1).strip()
            to_part  = re.sub(r"\s*\(via\s+.+?\)", "", to_part, flags=re.I).strip()

        if from_city and to_part:
            result.append({
                "mode":      mode,
                "from_city": from_city,
                "to_city":   to_part,
                "stopover":  stopover,
                "inr_price": cost,
            })
    return result


def parse_transfers_cell(cell: str) -> list[dict]:
    """
    Format: 'Paris CDG Airport to City Centre|INR 8500 | Vienna Airport to Hotel|INR 6000'
    Each entry = 2 pipe-delimited fields: description | cost
    """
    parts = _parts(cell)
    result = []
    for i in range(0, len(parts) - 1, 2):
        desc = parts[i]
        cost = re.sub(r"[^\d.]", "", parts[i + 1]) if i + 1 < len(parts) else ""

        from_loc = desc
        to_loc   = ""

        if " to " in desc.lower():
            idx      = desc.lower().index(" to ")
            from_loc = desc[:idx].strip()
            to_loc   = desc[idx + 4:].strip()

        # Heuristic: city = everything before first airport / transfer keyword
        city_match = re.split(
            r"\s+(?:airport|intl|international|cdg|lhr|ams|fra|vie|bcn|fco"
            r"|station|central|hub|transfer|city|downtown|hotel)\b",
            from_loc, maxsplit=1, flags=re.I
        )
        city = city_match[0].strip() if city_match else ""
        if not city:
            city = from_loc.split()[0] if from_loc.split() else ""

        if from_loc:
            result.append({
                "city":     city,
                "from":     from_loc,
                "to":       to_loc,
                "cost_inr": cost,
            })
    return result


# ── Key set builders ──────────────────────────────────────────────────────────
# Each function reads all rows from a sheet and returns a set of lookup keys
# used for duplicate detection.  Row 0 is always the header — skip it.

def hotels_keys(rows: list[list]) -> set[tuple]:
    """Hotels master & INPUT_Hotels: col0=City, col1=Hotel Name"""
    keys = set()
    for row in rows[1:]:
        if len(row) >= 2 and row[0].strip():
            keys.add((row[0].strip().lower(), row[1].strip().lower()))
    return keys


def sightseeing_keys(rows: list[list]) -> set[tuple]:
    """Sightseeing master & INPUT_Sightseeing: col0=City, col1=Tour Name"""
    keys = set()
    for row in rows[1:]:
        if len(row) >= 2 and row[0].strip():
            keys.add((row[0].strip().lower(), row[1].strip().lower()))
    return keys


def trains_keys(rows: list[list]) -> set[tuple]:
    """
    Trains master & INPUT_Trains: col1=From City, col2=To City
    Stored bidirectionally so either direction counts as a duplicate.
    """
    keys = set()
    for row in rows[1:]:
        if len(row) >= 3:
            a = row[1].strip().lower()
            b = row[2].strip().lower()
            if a and b:
                keys.add((a, b))
                keys.add((b, a))
    return keys


def transfers_keys(rows: list[list]) -> set[tuple]:
    """
    Transfers master & INPUT_Transfers: col0=City, col7=From, col8=To
    (0-based indices matching Pipeline.gs XC column map)
    """
    keys = set()
    for row in rows[1:]:
        if len(row) >= 9:
            city = row[0].strip().lower()
            frm  = row[7].strip().lower()
            to   = row[8].strip().lower()
            if frm:
                keys.add((city, frm, to))
    return keys


# ── INPUT row builders ────────────────────────────────────────────────────────
# Create a correctly-sized list for each INPUT sheet, filling only the
# columns where we have data.  Blank strings for everything else.

def make_hotel_row(h: dict) -> list:
    # INPUT_Hotels: 25 columns
    # 0:City 1:Hotel Name 2:Star 3:Category 4:Chain 5:Room
    # 6-17:Jan-Dec 18:Annual Avg 19:Added_By 20:Source 21:Notes
    # 22:Pipeline_Status 23:Error_Reason 24:Processed_Date
    row = [""] * 25
    row[0]  = h["city"]
    row[1]  = h["name"]
    row[19] = ADDED_BY
    row[22] = STATUS
    return row


def make_sightseeing_row(s: dict) -> list:
    # INPUT_Sightseeing: 16 columns
    # 0:City 1:Tour Name 2:Category 3:Rating 4:Duration
    # 5:Avg Price 6:GYG Price 7:GYG Link 8:Viator Price 9:Viator Link 10:Tags
    # 11:Added_By 12:Notes 13:Pipeline_Status 14:Error_Reason 15:Processed_Date
    row = [""] * 16
    row[0]  = s["city"]
    row[1]  = s["name"]
    row[5]  = s.get("cost_inr", "")   # archive cost as a starting reference for Claude
    row[11] = ADDED_BY
    row[13] = STATUS
    return row


def make_train_row(t: dict) -> list:
    # INPUT_Trains: 17 columns
    # 0:Mode 1:From City 2:To City 3:Stops 4:Stopover City
    # 5:INR Price 6:May€ 7:Aug€ 8:Oct€ 9:Dec€ 10:Avg€
    # 11:Added_By 12:Source 13:Notes 14:Pipeline_Status 15:Error_Reason 16:Processed_Date
    row = [""] * 17
    row[0]  = t.get("mode", "Train")
    row[1]  = t["from_city"]
    row[2]  = t["to_city"]
    row[4]  = t.get("stopover", "")
    row[5]  = t.get("inr_price", "")
    row[11] = ADDED_BY
    row[14] = STATUS
    return row


def make_transfer_row(x: dict) -> list:
    # INPUT_Transfers: 21 columns
    # 0:City 1:Country 2:Airport Code 3:Airport/Hub Name 4:Zone
    # 5:Transfer Type 6:Direction 7:From 8:To
    # 9:Economy₹ 10:Standard₹ 11:Premium₹ 12:Executive₹
    # 13:Schedule 14:Notes 15:Data Status
    # 16:Added_By 17:Source 18:Pipeline_Status 19:Error_Reason 20:Processed_Date
    row = [""] * 21
    row[0]  = x["city"]
    row[7]  = x["from"]
    row[8]  = x["to"]
    row[9]  = x.get("cost_inr", "")   # archive cost as economy sedan placeholder
    row[16] = ADDED_BY
    row[18] = STATUS
    return row


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # Validate inputs
    if not CREDENTIALS_PATH.exists():
        sys.exit(f"Credentials file not found: {CREDENTIALS_PATH}")
    if not CSV_PATH.exists():
        sys.exit(f"CSV not found: {CSV_PATH}")

    # Load CSV
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        archive_rows = list(csv.DictReader(f))
    print(f"\nArchive CSV: {len(archive_rows)} itinerary rows loaded")

    # Connect to Google Sheets
    print("Connecting to Google Sheets …")
    creds  = Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=SCOPES)
    client = gspread.authorize(creds)
    ss     = client.open_by_key(SPREADSHEET_ID)

    def load(sheet_name: str) -> list[list]:
        try:
            data = ss.worksheet(sheet_name).get_all_values()
            print(f"  Loaded '{sheet_name}': {max(0, len(data)-1)} data rows")
            return data
        except gspread.exceptions.WorksheetNotFound:
            print(f"  WARNING: Sheet '{sheet_name}' not found — treated as empty")
            return []

    # Build existing key sets (master + input queue combined)
    print("\nReading master sheets …")
    existing = {
        "hotels":      hotels_keys(load(MASTER["hotels"]))      | hotels_keys(load(INPUT["hotels"])),
        "sightseeing": sightseeing_keys(load(MASTER["sightseeing"])) | sightseeing_keys(load(INPUT["sightseeing"])),
        "trains":      trains_keys(load(MASTER["trains"]))      | trains_keys(load(INPUT["trains"])),
        "transfers":   transfers_keys(load(MASTER["transfers"])) | transfers_keys(load(INPUT["transfers"])),
    }

    # Working sets (grow as we add new items, preventing within-batch duplicates)
    seen = {k: set(v) for k, v in existing.items()}

    new_rows: dict[str, list[list]] = {k: [] for k in seen}
    stats = defaultdict(lambda: {"found": 0, "already_exists": 0, "queued": 0})

    print("\nParsing archive data …")
    for row in archive_rows:

        # Hotels
        for h in parse_hotels_cell(row.get("Hotels Used", "")):
            stats["hotels"]["found"] += 1
            key = (h["city"].lower(), h["name"].lower())
            if key in seen["hotels"]:
                stats["hotels"]["already_exists"] += 1
            else:
                new_rows["hotels"].append(make_hotel_row(h))
                seen["hotels"].add(key)
                stats["hotels"]["queued"] += 1

        # Sightseeing
        for s in parse_sightseeing_cell(row.get("Sightseeing Used", "")):
            stats["sightseeing"]["found"] += 1
            key = (s["city"].lower(), s["name"].lower())
            if key in seen["sightseeing"]:
                stats["sightseeing"]["already_exists"] += 1
            else:
                new_rows["sightseeing"].append(make_sightseeing_row(s))
                seen["sightseeing"].add(key)
                stats["sightseeing"]["queued"] += 1

        # Trains
        for t in parse_trains_cell(row.get("Trains Used", "")):
            stats["trains"]["found"] += 1
            fwd = (t["from_city"].lower(), t["to_city"].lower())
            rev = (t["to_city"].lower(), t["from_city"].lower())
            if fwd in seen["trains"] or rev in seen["trains"]:
                stats["trains"]["already_exists"] += 1
            else:
                new_rows["trains"].append(make_train_row(t))
                seen["trains"].add(fwd)
                seen["trains"].add(rev)
                stats["trains"]["queued"] += 1

        # Transfers
        for x in parse_transfers_cell(row.get("Transfers Used", "")):
            stats["transfers"]["found"] += 1
            key = (x["city"].lower(), x["from"].lower(), x["to"].lower())
            if key in seen["transfers"]:
                stats["transfers"]["already_exists"] += 1
            else:
                new_rows["transfers"].append(make_transfer_row(x))
                seen["transfers"].add(key)
                stats["transfers"]["queued"] += 1

    # Write to INPUT sheets
    print("\nWriting new items to INPUT sheets …")
    for cat, sheet_name in INPUT.items():
        rows = new_rows[cat]
        if rows:
            ss.worksheet(sheet_name).append_rows(rows, value_input_option="USER_ENTERED")
            print(f"  {sheet_name}: {len(rows)} rows added")
        else:
            print(f"  {sheet_name}: nothing new to add")

    # Summary
    print("\n─── Summary ─────────────────────────────────────────────────────")
    print(f"  {'Category':<14}  {'Found in archive':>17}  {'Already in master':>18}  {'Queued for enrichment':>21}")
    print(f"  {'-'*14}  {'-'*17}  {'-'*18}  {'-'*21}")
    for cat in ["hotels", "sightseeing", "trains", "transfers"]:
        s = stats[cat]
        print(f"  {cat.capitalize():<14}  {s['found']:>17}  {s['already_exists']:>18}  {s['queued']:>21}")
    total = sum(stats[c]["queued"] for c in stats)
    print(f"\n  Total new items queued: {total}")
    print(f"  Pipeline.gs will enrich them on the next overnight run.\n")


if __name__ == "__main__":
    main()
