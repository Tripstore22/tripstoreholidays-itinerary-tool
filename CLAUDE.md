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

## FILE RULES — CRITICAL (never violate)

### The 3 HTML files — know the difference
| File | Purpose | When to edit |
|------|---------|-------------|
| `index_fit.tripstore.html` | **LIVE production** | Only for final, tested features going to production |
| `index_fit.tripstore.DEV.html` | **DEV testing** | All new feature development happens HERE first |
| `index_fit_DEV.html` | **DEPRECATED** | DO NOT USE. Created by mistake. Will be deleted. |

### Rules
1. **NEVER copy live → DEV.** The DEV file has features (Swiss Pass, City Intelligence, server-side Auto-Build, custom city autocomplete, PDF mode toggle, budget breakdown bar) that the live file does NOT have. Copying live to DEV destroys these features.
2. **NEVER create a new DEV file by duplicating the live file.** If you need a fresh DEV, branch from `index_fit.tripstore.DEV.html`.
3. **New features go to DEV first.** Code → test in DEV → verify → then merge into live.
4. **When merging DEV → live:** Cherry-pick specific changes. Never overwrite the live file wholesale.
5. **Before editing ANY HTML file:** State which file you are editing and why. Get confirmation.
6. **API URLs are different:**
   - Live: contains `AKfycbzAbIgzRoN_MNs377jm3u`
   - DEV: contains `AKfycbwI0EKmAEJlHVDZQcBTrRscEE0G0y6A5lXRa1VIQBMPwOQRsqnIOWJEeelWNtUguVb2_g`
   - **NEVER put a DEV URL in the live file or vice versa.**

### Sheet IDs
- **Live Sheet:** `1U3f6PhTpvbEO7JG937t2z9EW9dfB0gcIOUVA_GATIHM` — never use in DEV code
- **DEV Sheet:** `1cdI1Gz652pTyqX5gVIJ6AHssMZiHD0VLr_KJXt0hETE` — never use in live code

### .gs file rules
- `Code.gs` — shared between live and DEV (routes serve both). Wallet routes are additive only.
- `Wallet.gs` — DEV only until wallet goes live.
- `Pipeline.gs`, `Quote_Intelligence.gs`, `Automation.gs` — live files, edit carefully.
- `Temp.gs` — throwaway utility functions, run manually from Apps Script console.

## Git Rules — STRICT
- ONLY ever push to the `v2` branch. Never push to `main`, `master`, or any other branch.
- CNAME file must only exist on v2. Never copy or merge it to other branches.
- If a fix is not showing on the live site, wait 3–5 minutes for CDN. Do NOT diagnose as a branch problem and start pushing to other branches.
- If GitHub Pages stops deploying: instruct user to go to Settings → Pages → toggle branch to main → Save → toggle back to v2 → Save. That's it.

## Testing Rule
- Simple changes: push to v2 and verify on live site after 3–5 mins.
- DEV testing: open `index_fit.tripstore.DEV.html` via local server (`python3 -m http.server 8080`), NOT via `file://` protocol.
- If unsure about a change: ask user to open index.html directly from Desktop (/Users/Sumit/Desktop/Itinerary-Create/index.html) in browser to test locally before pushing.
