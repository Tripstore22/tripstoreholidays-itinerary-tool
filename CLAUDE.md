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
