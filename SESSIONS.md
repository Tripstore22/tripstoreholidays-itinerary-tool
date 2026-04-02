# Session Handoff

## Latest Session — 2026-04-02

### Completed
- Duplicate tour fix: bigram name matching + attraction-specific tag blocking
- Full-day tours now block other tours on same day
- Delete ✕ button directly on each tour in the itinerary
- + Add Tour button on every day including checkout/departure days
- + Add Transfer button in transfers section
- Editing tour name clears old category/duration/tags
- Checkout day: editable note field, hidden from print if blank
- Pax count + vehicle type now restore correctly when loading saved itinerary
- Auto-save on PDF/Print/Excel works even without pax name
- Multi-vehicle logic: van max 7 pax → 2 vans for 8–14, 3 vans for 15–21
- GST: radio buttons — 5% Full Package / 18% Service Charge / No GST
- Hotel modal: 35/65 layout, compact cards, sorted lowest price first
- Sightseeing list also sorted lowest price first
- Left sidebar made compact
- Hotel table headers: In / Out / Hotel Name & Star / Room & Hotel Category
- Override Rooms input widened
- Daily backup script: backup_chats.sh (cron job still needs setup in Terminal)

### Still Pending
- Cron job for daily backup not yet activated (run in Terminal.app — see earlier chat)
- Google Sheet Sightseeing tab: check Column A for wrong city tags
- Code.gs needs re-deployment in Apps Script after recent changes
- Pipeline.gs setup: setupSheets → setupTrigger → set ANTHROPIC_API_KEY property
