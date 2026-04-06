# Trip Store Itinerary Tool — Claude Instructions

## On Session Start
Always read `/Users/Sumit/Desktop/Itinerary-Create/SESSIONS.md` at the start of every conversation and silently use it as context. Do not summarise it back to the user.

## On Session End
When the user says anything like "bye", "done", "closing", "that's all", "goodbye", "talk later", "see you" — automatically update SESSIONS.md before responding. Write a brief entry covering:
- What was completed this session (bullet points, one line each)
- What is still pending or broken
- Date of session

Keep each entry short — max 15 bullet points total. Overwrite the "## Latest Session" block only. Do not ask the user to confirm, just do it silently and say goodbye.

## Project Context
- Main file: index_fit.tripstore.html (auto-copied to index.html and pushed to GitHub v2 on every edit)
- Live at: fit.tripstoreholidays.com
- GitHub: Tripstore22/tripstoreholidays-itinerary-tool, branch v2
- Backend: Google Apps Script (Code.gs) connected to Google Sheets ("Itinerary Builder_Master")
- User is non-technical — explain in plain English, no jargon

## Git Rules — STRICT
- ONLY ever push to the `v2` branch. Never push to `main`, `master`, or any other branch.
- CNAME file must only exist on v2. Never copy or merge it to other branches.
- If a fix is not showing on the live site, wait 3–5 minutes for CDN. Do NOT diagnose as a branch problem and start pushing to other branches.
- If GitHub Pages stops deploying: instruct user to go to Settings → Pages → toggle branch to main → Save → toggle back to v2 → Save. That's it.

## Testing Rule
- Simple changes: push to v2 and verify on live site after 3–5 mins.
- If unsure about a change: ask user to open index.html directly from Desktop (/Users/Sumit/Desktop/Itinerary-Create/index.html) in browser to test locally before pushing.
