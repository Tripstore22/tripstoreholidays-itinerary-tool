---
name: tripstore-promote
description: TripStore DEV-to-LIVE promotion ritual for the fit.tripstoreholidays.com app. Use this skill whenever promoting, deploying, shipping, or pushing any change to LIVE — HTML (app/index.html) or Apps Script (.gs) — or whenever the words promote, deploy, ship, go live, clasp push, clasp deploy, or git push v2 come up. It bakes in the surgical-not-wholesale diff gate, the three-deploy-ID anchor-sed (never global), clasp push plus deploy of BOTH live IDs, the arm64 PATH prefix, POST-not-HEAD verification, and rollback-stated-first. Always consult before touching LIVE — a wrong promote has cost hours and broken production more than once.
---

# TripStore — Promote DEV → LIVE

The single most expensive workflow on this project. Read this before any LIVE change.

## QA GATE — Night Guardian (run before AND after every promote)
- **Before promote — must be GREEN:** `python3 ~/Desktop/Itinerary-Create/qa/smoke.py --seam all --env dev`
  Engine + pricing + data seams over the 12 goldens. GREEN = 0 FAIL (KNOWN/SKIP are fine).
  A new FAIL blocks the promote until triaged — fix it, or add a registry-cited entry to
  `qa/known_issues.json` (instance- or count-keyed, never a class-wide pattern).
- **After promote — LIVE smoke (read-only):** `python3 ~/Desktop/Itinerary-Create/qa/smoke.py --seam engine --env live`
  Runs ONLY the 3 `live_safe` scenarios against LIVE. VERIFIED write-nothing (a bare
  computeItinerary POST creates 0 Quote_Log / 0 Saved_Itineraries rows).
- Between promotes, the `night-guardian` Action runs the full bank nightly (02:00 IST) and
  opens an Issue only on a NEW failure.

## VOLATILE VALUES — never trust numbers in this file, read these first
- `~/Desktop/tripstore-pipeline/.deployment_ids` — canonical deploy IDs + current @version numbers.
- `TRUTH.md` (state) and `DECISIONS.md` (policy) — current LIVE @version, divergences, landmines.
- Deploy IDs are stable hashes; @version numbers drift every promote. Read, don't assume.

## GOLDEN RULES
1. **DEV first, always.** Never edit `clasp-live/` or `app/index.html` directly. Code flows DEV → LIVE; business data lives on LIVE only.
2. **State the rollback BEFORE the promote.** Write the exact revert command first. (`clasp deploy --versionNumber N` to re-pin, `git revert HEAD` for HTML.)
3. **Surgical, not wholesale.** DEV is the integration staging ground — a blind `cp dev → live` ships everything accumulated since the last promote, hidden inside a one-line-fix commit. ALWAYS `git diff --stat` (HTML) or function-level diff (.gs) against HEAD first. If the diff is bigger than the brief implies, STOP and ask.
4. **`clasp push` ≠ live.** Push updates @HEAD. The customer `/exec` URL only moves on `clasp deploy --deploymentId`. Both live IDs, every time.
5. **Verify with a real POST.** GAS `/exec` returns 403 on `curl -I` (HEAD) by design — that is NOT a failure. Confirm with an actual POST.
6. **Smoke LIVE before saying "done."** GitHub Pages lags 1–5 min; hard-refresh and diff the deployed asset before re-debugging anything.

## DEPLOY IDs (prefixes — full values in .deployment_ids)
- `LIVE_DEPLOY_ID` `AKfycbwP9KQH…` — LIVE app `API_URL`.
- `LIVE_BF_DEPLOY_ID` `AKfycbzAbIgz…` — second customer URL; deploy alongside LIVE_DEPLOY_ID.
- `LIVE_PDF_DEPLOY_ID` `AKfycbzHI5cG…` — `ADOBE_PDF_API`, present in BOTH live AND dev HTML. Distinct endpoint — a global sed that rewrites it to the main API silently breaks PDF.
- `DEV_PINNED_DEPLOY_ID` `AKfycbxr…` — DEV app `API_URL`. The hash to grep for when checking a LIVE file is clean.
- `DEV_DEPLOY_ID` `AKfycbzFTBG…` — DEV @HEAD, admin/debug only, not read by HTML.

## arm64 Mac
Prefix every clasp command: `PATH="/opt/homebrew/bin:$PATH" clasp …`. The nvm node is x86_64 and fails `Bad CPU type`. Homebrew has native arm64 node + clasp.

---

## HTML PROMOTE (app/index.html)
Paths: DEV `~/Desktop/Itinerary-Create/dev/app/index.html` → LIVE `~/Desktop/Itinerary-Create/app/index.html`. Validator + git repo root is `~/Desktop/Itinerary-Create/`.

### ⚠️ DO NOT BLIND-`cp` DEV → LIVE (this clobbers LIVE-only endpoints)
**DEV's HTML holds DEV hashes for BOTH endpoints now** — `API_URL` AND `ADOBE_PDF_API`. (The 2026-05-29 DEV-PDF-isolation fix repointed DEV's `ADOBE_PDF_API` to the DEV pin so DEV PDF tests stay in DEV.) So a `cp dev→live` followed by sed-ing **only** `API_URL` pushes the **DEV PDF hash onto LIVE's PDF endpoint** and silently breaks every proposal PDF on LIVE — nobody notices until an agent's PDF won't generate. [VERIFIED — caught live on the 2026-06-11 promote.]

**Default method — apply blocks, never copy the file:**
1. **Diff gate:** `git diff --stat`. Identify the named changed blocks only.
2. **Apply just those blocks onto the CURRENT LIVE `app/index.html`** (the LIVE file already has both endpoints correct). Zero endpoint risk — this is what the 06-11 promote did. Never `cp` the whole DEV file over LIVE.

**If you must `cp` (whole-file rewrite, rare):** then swap **BOTH** endpoints, not just one:
- `const API_URL` DEV (`AKfycbxr…`) → LIVE main (`AKfycbwP9KQH…`).
- `const ADOBE_PDF_API` DEV → LIVE **PDF** hash (`AKfycbzHI5cG…`, from `.deployment_ids`). **Do NOT leave it** — DEV's value is the DEV hash, not the LIVE PDF hash.
- Anchor-match each line independently; `sed` exits 0 on no-match, so never trust it without the grep gate.

3. **Verify gate (BOTH endpoints):**
   - `grep -c AKfycbxr app/index.html` → **0** (no DEV API hash leaked).
   - `grep ADOBE_PDF_API app/index.html` → shows the **LIVE PDF** hash (`AKfycbzHI5cG…`), NOT the DEV hash.
   - `grep API_URL app/index.html` → shows the LIVE main hash (`AKfycbwP9KQH…`).
   - `diff dev/app/index.html app/index.html` → differs by **exactly the two endpoint lines** plus any LIVE-only divergence — nothing unexpected.
   - `python3 check_html.py` → ALL PASS. (`node --check` rejects `.html`; extract inline script blocks if you need JS syntax check.)
4. **Commit explicit paths:** `git add app/index.html` (+ `index.html` if landing changed). `dev/` is gitignored — `git add dev/...` is a silent no-op. Then `git commit` + `git push origin v2`. **Only ever push v2.** Never main/master. CNAME lives only on v2.
5. **Confirm LIVE:** wait 1–5 min, `curl` the live URL and `diff` against local `app/index.html` until byte-identical. Then a functional smoke (real Auto-Build / POST).

Landing page: `dev/index.html` → `cp` to `index.html`. Locked design source: `~/Desktop/TripStore/LANDING PAGE/tripstore_landing_page.html`.

---

## APPS SCRIPT PROMOTE (.gs)
Paths: `~/Desktop/tripstore-pipeline/clasp-dev/` (edit + test) and `clasp-live/` (promote target).

1. **Test on DEV first:** `bash ~/Desktop/tripstore-pipeline/dev_push.sh "desc"` — runs `clasp push` THEN `clasp deploy --deploymentId DEV_PINNED_DEPLOY_ID`. Raw `clasp push` alone leaves DEV HTML reading stale code. (dev_push.sh emits a spurious DEV-HTML-path WARNING from the 2026-05-16 landing split — bypass with `y`; it is not a blocker.)
2. **Merge into clasp-live SURGICALLY.** LIVE may hold fixes DEV does not (e.g. the approveAgent 2026-06-04 refinement). Copy only the changed functions/lines; keep diverged functions byte-identical. Never wholesale `cp clasp-dev/* clasp-live/`.
3. **Push + deploy BOTH:**
   - `PATH="/opt/homebrew/bin:$PATH"` ; `cd clasp-live` ; `clasp push -f` (the `-f` is required when the manifest changed — without a TTY it is a silent no-op otherwise).
   - `clasp deploy --deploymentId <LIVE_DEPLOY_ID>` AND `clasp deploy --deploymentId <LIVE_BF_DEPLOY_ID>` (read both from `.deployment_ids`).
4. **Schema migrations are atomic:** a tab/column change and the reader-function patch ship in the SAME promote window. Never split.
5. **Smoke:** real POST to the LIVE `/exec`. Confirm response shape, then update TRUTH.md / DECISIONS.md with the new @version.

### NEVER promote these (.gs DEV-only)
`AutoBuild.gs`, `AutoBuild_Data.gs`, `Automation.gs`, `Temp.gs`. (Note: presence on LIVE has drifted historically — verify with clasp before assuming; never push these into LIVE regardless.)

### clasp landmines
- `clasp 3.x` does NOT sync deletes — removing a local `.gs` and pushing leaves it on the remote. Use the empty-stub-overwrite trick to clear.
- `.claspignore` exists in both `clasp-dev/` and `clasp-live/` (excludes `_backups/**`, `*.bak`, `**/*.md`). Do not remove it — without it, backup `.gs` files get swept in as duplicate function declarations.
- Never call `SpreadsheetApp.getUi()` from trigger code — throws in no-UI context. Use `Logger.log`.

---

## promote_to_live.sh — status: DO NOT TRUST BLIND
Marked broken since 2026-05-16 (greps the retired `dev/index_fit.tripstore.DEV.html` path). One later session claims a rewrite for the 3-ID structure — that claim is unverified here. **Default to the manual steps above.** If you use the script, read it first and confirm it targets `dev/app/index.html` and all three deploy IDs.

## SELECTIVE / PARTIAL PROMOTE (hold DEV-only work back — "B3")
The recurring case: DEV carries in-progress work that must NOT ship (e.g. held `ItineraryEngine.gs` algorithm changes, an unfinished `Code.gs` block) while you promote OTHER changes. In the current **manual surgical** world this is the default and needs no file-swap gymnastics — you copy only the functions/lines that ship and never touch the held ones. The old "swap the held DEV file with the LIVE copy so the wholesale script reports NO CHANGE, then restore byte-exact" dance only existed to survive `promote_to_live.sh`'s blind `cp` — and that script is broken, so don't reach for it.
- **Do:** merge surgically; leave held functions untouched in clasp-live.
- **Always verify nothing held leaked:** pick a unique marker from the held work (a function name or const, e.g. a hotel-ceiling const, a `v4_*` helper) and `grep -c "<marker>" ~/Desktop/tripstore-pipeline/clasp-live/<file>.gs` → **expect 0**. Non-zero = it leaked; back it out before deploy.
- **If you ever must run a wholesale copy:** snapshot the held file + its `shasum -a 256` first, swap in the LIVE copy, promote, restore the held file, and re-check the SHA matches pre/post (a drifted restore silently bakes held work into the next `dev_push.sh`). Prefer surgical — this is the fallback only.

## ROLLBACK (write this BEFORE you promote)
- `.gs`: `clasp deploy --deploymentId <ID> --versionNumber <prev_N>` to re-pin both live IDs to the last good version.
- HTML: `git revert HEAD` then `git push origin v2` (or `git checkout app/index.html` before commit if not yet pushed).
