# TripStore Holidays — Master Context

## Who I Am
Solo founder, non-technical. CEO of TripStore Holidays.
Luxury European travel for Indian HNI clients. All prices INR.

## Tech Stack
- Frontend: index_fit.tripstore.html (single file, hosted on AWS)
- Backend: Google Apps Script (Code.gs)
- Database: Google Sheets (ID: 1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM)
- Pipeline: Python (extract + cross_reference) → Apps Script midnight enrichment
- AI Enrichment: Claude API via Apps Script

## Google Sheet Structure
Sheet ID: 1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM
Master tabs: Hotels | Sightseeing | Trains | Transfers
Input tabs:  INPUT_Hotels | INPUT_Sightseeing | INPUT_Trains | INPUT_Transfers
Log tabs:    ERRORS_LOG | DUPLICATES_LOG | AUDIT_LOG

## Local File Paths
Project root:   ~/Desktop/TripStore/
Masters:        ~/Desktop/TripStore/masters/
Pipeline:       ~/Desktop/TripStore/pipeline/
Archive:        ~/Desktop/TripStore/archive/input-pdfs/
Web app:        ~/Desktop/TripStore/web-app/
Credentials:    ~/Desktop/TripStore/pipeline/sheets-credentials.json

## Master Database Status (April 2026)
Hotels:      1,091 properties | 138 EU cities | v2
Sightseeing: 1,117 tours | 88 cities | v3
Trains:      614 bidirectional routes | complete
Transfers:   ~1,040 rows | zone-based model | in progress

## Pricing Rules
- All prices INR, 3-night totals for hotels
- Exchange rate: ₹110 per €1
- Seasonal multipliers: Jan=0.80 Feb=0.82 Mar=0.90 Apr=1.00
  May=1.05 Jun=1.20 Jul=1.30 Aug=1.28 Sep=1.05 Oct=0.95 Nov=0.85 Dec=1.15
- Annual avg = mean of all 12 months

## Dedup Keys
Hotels:    Hotel Name + City
Sightseeing: Tour Name + City
Trains:    From City + To City (bidirectional — check both directions)
Transfers: To (hotel name) + City + Airport Code

## Pipeline Rules — NEVER VIOLATE
- Never create new Sheet tabs
- Never delete rows — only append to bottom
- Never overwrite master data
- Duplicate check happens in JavaScript before Claude API call
- Pipeline_Status: PENDING → PROCESSED / ERROR / DUPLICATE

## Output Preferences (for Claude Chat)
- Dark themed HTML, self-contained, no external CDN
- System fonts only
- All colors hardcoded inline
- INR formatting: ₹X,XX,XXX
- Outputs go to: ~/Desktop/TripStore/outputs/

## What's In Progress
1. cross_reference.py — not yet complete
2. Swiss mountain transfers — model undecided
3. Sightseeing tagging — 1,117 rows untagged
4. 18 missing hotel cities: Berlin, Hamburg, Basel, Bern, Lyon,
   Marseille, Bordeaux, Turin, Bologna, Genoa, Dresden, Lausanne,
   Palma de Mallorca, San Sebastian, Strasbourg, Toulouse, Gdansk, Graz

## Active Website
fit.tripstoreholidays.com (AWS hosted)