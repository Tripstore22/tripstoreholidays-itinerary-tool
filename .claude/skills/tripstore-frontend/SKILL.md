---
name: tripstore-frontend
description: TripStore single-file HTML app architecture and its landmines (app/index.html, the agent-facing builder on GitHub Pages v2). Use this skill whenever editing the app HTML/JS — tabs, the Auto-Build / engine wiring, the save-version-wallet chain, quote loading, transfer DETAILS, Swiss Pass, the Quick Quote tab, date pickers, toasts, or any FE handler. It locks the switchAdminTab flex-parent trap, the version-suffix and _loadedFromName chain, onAutoBuildQuote as the engine entry, the renderTables re-fire rule, IST-safe dates, reuse-existing-handlers, the logo path, and the GitHub Pages lag check. Consult before any app-HTML edit so a known landmine is not re-stepped-on. Promote per tripstore-promote.
---

# TripStore — Frontend (app/index.html)

One large single-file HTML app. Dense, full of handlers, easy to regress. DEV first (`dev/app/index.html`), promote per `tripstore-promote`.

## VOLATILE — read first
Line numbers in any old brief are stale (drift of 270–2000 seen). **Anchor on strings, never line numbers** — grep the function/const name in the current file. TRUTH.md / DECISIONS.md for current FE state and parked fixes.

## FILE RULES
- **Never copy live → DEV.** DEV holds features LIVE may not have yet; copying live over it destroys uncommitted work.
- LIVE `~/Desktop/Itinerary-Create/app/index.html`; DEV `dev/app/index.html`. `dev/` is gitignored — promote commits `app/index.html` only.
- App logo path is `../images/tripstorelogo.png` (the `/app/` subdir makes bare `images/...` 404 → `onerror` hides it).
- System fonts only, no external CDNs, colours hardcoded inline. Brand: cream/terracotta/teal, Playfair-style serif (see `tripstore-creative`).

## TAB TRAP (`switchAdminTab`)
Sets active tabs to `display:flex` (most) or `block` (coverage/manager). **Any tab div that gains a second direct child needs `flex-direction:column` inline**, or children render side-by-side (bit the Quick Quote sticky bar under `#tab-quickquote`).

## ENGINE WIRING
- **`onAutoBuildQuote()` is the engine entry, NOT `runOptimizer()`.**
- After the engine returns: `renderTables()` runs, which **wipes any Swiss Pass row** inserted earlier. Re-apply `applySwissPassToQuote()` after `renderTables()` in both `runAutoBuild` (legacy) and `onAutoBuildQuote` (engine) paths — in `onAutoBuildQuote`, re-apply BEFORE `calculateBudgetInvestment()` so util reflects the pass discount.
- **Don't add per-context logic inside `renderTables()`** — it fires on swap, manual add, load, and rebuild. Guard outside it, or it over-fires.
- Day-trip warning: show a badge for `DAY_TRIP_DESTINATION_IN_ROUTE` (engine returns it).

## SAVE / VERSION / WALLET CHAIN (regression magnet)
- **Naming:** first save `_V1`; later saves `${paxName}_V${(max_version||0)+1}`. `checkQuoteState` scans `_V(\d+)$` and returns `max_version` (unsuffixed legacy = 0). No separate brand-new vs bump branch for the suffix.
- **`_loadedFromName` must be (a) set on load, (b) updated to the just-saved `saveName` after every successful save, (c) cleared on reset/newQuote.** Miss any branch → silent extra version. Also write `saveName` back to `paxNameInput.value` after save.
- **Counter key = `_stripPaxBase_(trimmedName)` on BOTH save paths** (update + new-row, Code.gs ~L792/L813). Splitting the keys caused "₹99 on every version bump."
- **Spurious "Create new version?" modal:** gate `isVersionBump` on `state.exists`; the cross-owner false-fire traces to the `checkQuoteState` ownership filter (Code.gs ~L872). The known kill for the silent-2nd-version path is to set `_loadedFromName = _buildAutoSaveName()` on save — verify whether it has shipped (TRUTH.md) before touching.
- **LATEST badge:** the row where `versionMap[base]===1` (singleton) OR `thisVer===maxVerMap[base]` (newest), not the unsuffixed/oldest.
- Wallet/audit: `Saved_Itineraries` row count is the authoritative check for whether a new version was created — WALLET_AUDIT can't distinguish append vs overwrite.

## TRANSFER DETAILS
Derived FE-side from `currentPlan` hotel names by leg/city in `transformEngineResult`; ignore the server `schedule` string. `_detailsCustom` preserves agent-typed DETAILS, set only by a direct DETAILS-cell edit. (PDF side: `tripstore-pdf`.)

## DATES
IST-safe: build local-midnight `Date`, format with the existing `formatDateISO`. Quick Quote dates cascade from `quickStartDate`. Don't reinvent date helpers.

## REUSE, DON'T DUPLICATE
Reuse existing classes/handlers (`qq-field-label`, `qqStep()`, `formatDateISO`) instead of brief-invented parallels (`quick-label`, `qAdultInc`, `_fmtDateISO`) — duplicates are how 211 functions became 230. Note any reconciliation in the report.

## OTHER
- Toast bg classes (`.toast.bg-green-600` / `.bg-red-600`) are JS-referenced Tailwind-style names that must be DEFINED in CSS or the toast is invisible.
- `check_html.py` catches DEV/LIVE API-URL mismatch. `node --check` rejects `.html` — extract inline `<script>` blocks to syntax-check JS.
- **GitHub Pages lags 1–5 min.** Before re-debugging a "fix not working," hard-refresh and grep the deployed asset / view-source. Don't diagnose as a branch problem and start pushing to other branches — only ever push `v2`.
- Generation_Log (DEV; promote pending): fire-and-forget POST after `calculateBudgetInvestment`; client `genId` `G-<ts><rand>` in `window._lastGenId`, cleared by the load guard so a loaded-then-saved quote doesn't inherit a stale id.
- DEV testing: serve via `python3 -m http.server`, not `file://`.
