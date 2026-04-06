# Session Handoff

## Latest Session — 2026-04-05 / 2026-04-06

### Completed — Itinerary Tool (fit.tripstoreholidays.com)
- Generate Quote button fix: label now updates AFTER plan is built (was one click behind)
- Quote no longer auto-generates on city add — only fires when button is clicked
- Removed runOptimizer() from addCityToRoute(), removeRoute(), handlePaxChange(), room override
- Default budget values (30000 / 20000) removed — fields now blank with placeholder text
- Signup form expanded to 6 fields: Travel Agency Name, Person Name, Login ID, Password, Mobile, Email
- Code.gs updated: handleSignup() now saves all 6 fields to Users sheet (columns E–H)
- COMMANDS.md created in tripstore-itinerary-archive folder (terminal command reference)
- Pre-push git hook added: blocks CNAME on non-v2 branches, warns if Pages not deployed in 24hrs
- CLAUDE.md updated: strict git rules — only push to v2, never touch main/master
- GitHub Pages broken + fixed: CNAME accidentally pushed to main/master during CDN-lag misdiagnosis
- Root cause saved: CDN lag (3–5 mins) looks like a broken deploy but is not — wait before acting

### Completed — Archive Pipeline (tripstore-itinerary-archive)
- cross_reference.py built: reads 4 input CSVs → dedupes vs master + INPUT tabs → appends PENDING rows
- Full pipeline test: 233 Excel files → 804 archive rows → uploaded to Itinerary_Archive tab
- Hotels and Sightseeing cleaned (city filters, numeric hotel name filter, CAPS fix)
- INPUT_Hotels: 443 new rows pushed; INPUT_Sightseeing: 224 new rows pushed
- 275 total PENDING rows queued across all 4 INPUT tabs for midnight enrichment
- Code.gs and Pipeline.gs pasted into Apps Script; API key and email set in Script Properties

### Still Pending
- Code.gs re-deployment needed: signup now saves 6 fields — redeploy for it to take effect
- Apps Script: run setupSheets() then setupTrigger() to activate midnight automation
- Test run: select runMidnightEnrichment() manually to verify enrichment works
- Google Sheet Users tab: add column headers E–H (Agency Name, Person Name, Mobile, Email)
- Google Sheet Sightseeing tab: verify Column A has correct city names (no cross-city contamination)
- Trains and Transfers data not yet reviewed for quality
- Cron job for local backup still not activated (open Terminal, run the crontab command)
