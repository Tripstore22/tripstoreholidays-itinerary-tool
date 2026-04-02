# Session Handoff Log
Each entry is written at the end of a session. Paste the latest entry at the TOP when starting a new Claude session.

---

## Session: 2026-04-02

### What was completed today
- Fixed Eiffel Tower duplicate tours (bigram name matching + attraction-specific tag blocking)
- Full-day tours now block other tours on same day
- Added ✕ delete button on each sightseeing tour directly in the itinerary
- Added + Add Tour button on every day (including checkout/departure days)
- Added + Add Transfer button in transfers section
- Editing a tour name now clears its old category/duration/tags
- Checkout day now has editable note field ("Free Day / Transfer" is hidden from print if blank)
- Pax count (adults/children) and vehicle type now correctly restore when loading a saved itinerary
- Auto-save on PDF/Print/Excel now works even without a pax name (generates name from cities + date)
- Multi-vehicle logic: van max 7 pax → 2 vans for 8–14, 3 vans for 15–21
- GST replaced with radio buttons: 5% Full Package / 18% Service Charge / No GST
- Hotel modal redesigned: 35% controls / 65% list, compact cards, sorted lowest price first
- Sightseeing modal list also sorted lowest price first
- Left sidebar made more compact (padding, input sizes, logo)
- Hotel table headers updated: In / Out / Hotel Name & Star / Room & Hotel Category
- Override Rooms input box widened
- Daily backup script created at /Users/Sumit/Desktop/Itinerary-Create/backup_chats.sh

### What is still pending / known issues
- Cron job for daily backup not set up yet (needs to be run in Terminal.app — see instructions in chat)
- Google Sheet data: check Sightseeing tab Column A for any wrong city tags causing cross-city contamination
- Code.gs not re-deployed yet after recent changes (re-deploy as Web App in Apps Script)
- Pipeline.gs still needs to be set up in Apps Script (setupSheets → setupTrigger → set ANTHROPIC_API_KEY)

### Files changed this session
- index_fit.tripstore.html (main app — auto-pushed to GitHub v2)
- index.html (copy of above — served on fit.tripstoreholidays.com)
- backup_chats.sh (new file)
- SESSIONS.md (this file)

### Repo & deployment
- GitHub: Tripstore22/tripstoreholidays-itinerary-tool, branch: v2
- Live URL: fit.tripstoreholidays.com
- Auto-push hook active: every Claude edit auto-commits and pushes

---

<!-- TEMPLATE FOR NEXT SESSION — copy and fill this in -->
## Session: YYYY-MM-DD

### What was completed today
-

### What is still pending / known issues
-

### Files changed this session
-

### Any new issues noticed
-
