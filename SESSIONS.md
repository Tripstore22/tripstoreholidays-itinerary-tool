# Session Handoff

## Latest Session — 2026-04-02

### Completed
- Duplicate tour fix: bigram name matching + attraction-specific tag blocking (eiffel-tower etc.)
- Generic tags (boat-cruise, skip-the-line) no longer block unrelated tours
- Full-day tours now block all other tours on same day
- Delete ✕ button directly on each sightseeing tour in the itinerary view
- + Add Tour button on every day including checkout/departure days
- + Add Transfer button at bottom of transfers section (search list or type manually)
- Editing a tour name now clears old category/duration/tags automatically
- Checkout day: editable note field replaces static "Free Day / Transfer"; hidden from print if blank
- Pax count (adults/children) and vehicle type now restore correctly on itinerary load
- Auto-save on PDF/Print/Excel works even without pax name (uses city+date as name)
- Multi-vehicle logic: van max 7 pax → 2 vans for 8–14 pax, 3 vans for 15–21 pax
- GST replaced with radio buttons: 5% Full Package / 18% Service Charge / No GST
- Hotel swap modal: 35/65 layout, compact cards, sorted lowest price first
- Sightseeing modal list sorted lowest price first
- Left sidebar made compact (padding, inputs, logo, spacing)
- Hotel table headers: In / Out / Hotel Name & Star / Room & Hotel Category
- Override Rooms input widened (was cut off)
- CLAUDE.md created — auto-reads SESSIONS.md on every session start
- SESSIONS.md automated — updates on "bye", no manual writing needed
- Daily backup script: backup_chats.sh (cron job still needs setup in Terminal)

### Still Pending
- Cron job for daily backup not yet activated (open Terminal.app and run the crontab command from earlier chat)
- Google Sheet Sightseeing tab: verify Column A has correct city names (no cross-city contamination)
- Code.gs needs re-deployment in Apps Script (Extensions → Deploy → Manage Deployments → New version)
- Pipeline.gs setup: run setupSheets() then setupTrigger(), set ANTHROPIC_API_KEY in Script Properties
