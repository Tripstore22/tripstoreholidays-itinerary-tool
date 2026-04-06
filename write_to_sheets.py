"""
write_to_sheets.py
------------------
Reads ./output/itinerary-archive.csv and appends non-duplicate rows
to the "Itinerary_Archive" tab in the specified Google Spreadsheet.

Requirements:
    pip install gspread google-auth

Usage:
    python write_to_sheets.py
"""

import csv
import sys
from pathlib import Path

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    sys.exit(
        "Missing dependencies. Run:  pip install gspread google-auth"
    )

# ── Configuration ──────────────────────────────────────────────────────────────

SPREADSHEET_ID   = "1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM"
SHEET_NAME       = "Itinerary_Archive"
CSV_PATH         = Path("./output/itinerary-archive.csv")
CREDENTIALS_PATH = Path("./sheets-credentials.json")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
]

# Header style: navy blue background, white bold text
HEADER_BG_COLOR = {"red": 0.082, "green": 0.157, "blue": 0.329}   # ~#152851
HEADER_FG_COLOR = {"red": 1.0,   "green": 1.0,   "blue": 1.0}

# Duplicate key = combination of these two columns (0-based index in CSV)
DUP_COL_FILE  = "File Name"
DUP_COL_SHEET = "Sheet Name"

# ── Helpers ────────────────────────────────────────────────────────────────────

def connect_sheet() -> gspread.Worksheet:
    """Authenticate and return the target worksheet (creates it if absent)."""
    creds = Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=SCOPES)
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(SPREADSHEET_ID)

    # Find or create the sheet tab
    try:
        ws = spreadsheet.worksheet(SHEET_NAME)
    except gspread.exceptions.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=20)
        print(f"  Created new sheet tab: '{SHEET_NAME}'")

    return ws


def apply_header_style(ws: gspread.Worksheet, num_cols: int) -> None:
    """Apply navy/white bold formatting to the header row."""
    spreadsheet = ws.spreadsheet
    sheet_id    = ws.id

    requests = [
        {
            "repeatCell": {
                "range": {
                    "sheetId":          sheet_id,
                    "startRowIndex":    0,
                    "endRowIndex":      1,
                    "startColumnIndex": 0,
                    "endColumnIndex":   num_cols,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": HEADER_BG_COLOR,
                        "textFormat": {
                            "foregroundColor": HEADER_FG_COLOR,
                            "bold":            True,
                            "fontSize":        10,
                        },
                        "horizontalAlignment": "CENTER",
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            }
        },
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenRowCount": 1},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
    ]

    spreadsheet.batch_update({"requests": requests})


def read_csv(path: Path) -> tuple[list[str], list[dict]]:
    """Return (headers, rows) from the CSV file."""
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        rows    = list(reader)
    return headers, rows


def build_existing_keys(ws: gspread.Worksheet, headers: list[str]) -> set[tuple]:
    """
    Read all data already in the sheet and return a set of
    (File Name, Sheet Name) tuples for duplicate detection.
    """
    all_values = ws.get_all_values()
    if len(all_values) < 2:          # empty or header-only
        return set()

    sheet_headers = all_values[0]
    try:
        file_col  = sheet_headers.index(DUP_COL_FILE)
        sheet_col = sheet_headers.index(DUP_COL_SHEET)
    except ValueError:
        # Sheet has data but columns don't match — bail safely
        print(
            f"  WARNING: Could not find '{DUP_COL_FILE}' / '{DUP_COL_SHEET}' "
            "columns in existing sheet. Duplicate check skipped."
        )
        return set()

    keys: set[tuple] = set()
    for row in all_values[1:]:       # skip header
        file_val  = row[file_col].strip()  if file_col  < len(row) else ""
        sheet_val = row[sheet_col].strip() if sheet_col < len(row) else ""
        if file_val or sheet_val:
            keys.add((file_val, sheet_val))

    return keys


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    # ── 1. Validate inputs ────────────────────────────────────────────────────
    if not CREDENTIALS_PATH.exists():
        sys.exit(f"Credentials file not found: {CREDENTIALS_PATH}")
    if not CSV_PATH.exists():
        sys.exit(f"CSV file not found: {CSV_PATH}")

    # ── 2. Read CSV ───────────────────────────────────────────────────────────
    headers, csv_rows = read_csv(CSV_PATH)
    total_csv = len(csv_rows)
    print(f"\nCSV loaded:  {total_csv} rows  ({CSV_PATH})")

    if not headers:
        sys.exit("CSV appears to be empty or has no headers.")

    # ── 3. Connect to sheet ───────────────────────────────────────────────────
    print(f"Connecting to Google Sheet …")
    ws = connect_sheet()

    # ── 4. Add header row if sheet is empty ───────────────────────────────────
    sheet_is_empty = ws.row_count == 0 or not ws.get_all_values()
    if sheet_is_empty:
        ws.append_row(headers, value_input_option="RAW")
        apply_header_style(ws, len(headers))
        print(f"  Header row written and styled.")

    # ── 5. Build duplicate key set ────────────────────────────────────────────
    existing_keys = build_existing_keys(ws, headers)
    print(f"  Existing rows in sheet (excl. header): {len(existing_keys)}")

    # ── 6. Filter out duplicates and collect new rows ─────────────────────────
    new_rows:  list[list] = []
    dup_count: int        = 0

    for row in csv_rows:
        key = (
            row.get(DUP_COL_FILE,  "").strip(),
            row.get(DUP_COL_SHEET, "").strip(),
        )
        if key in existing_keys:
            dup_count += 1
        else:
            # Convert dict → ordered list matching header order
            new_rows.append([row.get(h, "") for h in headers])
            existing_keys.add(key)   # prevent within-batch duplicates too

    # ── 7. Append new rows ────────────────────────────────────────────────────
    if new_rows:
        ws.append_rows(new_rows, value_input_option="USER_ENTERED")

    # ── 8. Summary ────────────────────────────────────────────────────────────
    print("\n─── Summary ────────────────────────────────")
    print(f"  Total rows in CSV   : {total_csv}")
    print(f"  Duplicates skipped  : {dup_count}")
    print(f"  New rows written    : {len(new_rows)}")
    print("────────────────────────────────────────────\n")


if __name__ == "__main__":
    main()
