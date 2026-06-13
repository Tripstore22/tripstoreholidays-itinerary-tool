---
name: tripstore-pdf
description: TripStore client-facing PDF proposal pipeline (Adobe PDF Services API called from PDFGenerator.gs). Use this skill whenever working on the generated proposal PDF, agent-branded PDF output, the Adobe PDF deploy, the quote-to-PDF handshake, transfer DETAILS in the PDF, or the WhatsApp PDF send. It locks the fact that production PDF is Adobe (not window.print), the agent-branding rules (no Trip Store branding on agent PDFs), the DEV-PDF routing history (the points-at-LIVE wiring was corrected 2026-05-29 — only the Adobe-creds-in-DEV piece needs verifying), the third distinct PDF deploy ID that must never be global-sed, the quote_pdf type:Template fix, and the transfer-DETAILS FE-derivation rule. Consult before any PDF work so DEV-testability is judged on current wiring, not the stale hits-LIVE assumption.
---

# TripStore — PDF Proposal Pipeline

The client-facing deliverable. Adobe-backed, agent-branded. DEV PDF routing was fixed 2026-05-29 — testable from DEV once the Adobe creds are confirmed in DEV Script Properties.

## VOLATILE — read first
TRUTH.md / DECISIONS.md for current LIVE @version, the PDF deploy @version, and pending PDF items. Code: `PDFGenerator.gs` (LIVE + DEV). FE entry: `downloadAdobePDF` in `app/index.html`.

## WHAT GENERATES THE PDF (fact beats stale doc)
**Production proposal PDF = Adobe PDF Services API, called from `PDFGenerator.gs`** [VERIFIED 2026-06-08]. The older note that "PDF export = `window.print()` / html2canvas is inferior" is **stale for the proposal PDF** — that line referred to a different/legacy path. Don't reintroduce window.print for the client proposal.

## THE THIRD DEPLOY (never global-sed)
The Adobe call goes through `ADOBE_PDF_API` = `LIVE_PDF_DEPLOY_ID` (`AKfycbzHI5cG…`), a **third distinct deploy** separate from `LIVE_DEPLOY_ID` and `LIVE_BF_DEPLOY_ID`. It appears in BOTH the live AND dev HTML. A blanket `sed` that rewrites it to the main API silently breaks PDF generation. Anchor-match the `const ADOBE_PDF_API` line on its own. (See `tripstore-promote`.)

## DEV PDF TESTABILITY (corrected — was the big trap)
Historically every "tested in DEV" PDF claim actually hit LIVE — three wiring bugs. **Two are fixed (SESSIONS 2026-05-29, "DEV-PDF wiring now correct"), one is unconfirmed:**
1. ✅ `dev/app/index.html` `ADOBE_PDF_API` repointed to the DEV pin (no longer the LIVE-owned deploy).
2. ✅ DEV `PDFGenerator.gs` sheet const set to the DEV sheet (no longer hardcodes `PDF_LIVE_SHEET_ID`).
3. ❓ Adobe Script Properties (`ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`, `ADOBE_SCOPES`) copied into the DEV Apps Script project — **not confirmed.**

**So: DEV PDF is testable IF #3 holds.** Before a DEV PDF run, verify the three Adobe props exist in the DEV project (Project Settings → Script Properties). If present → trust the DEV result. If absent → the call fails on auth, not on your change; copy the creds first. **Do NOT fall back to the old "DEV PDF always hits LIVE, can't verify" assumption — that's stale.** Re-grep the current `dev/app/index.html` `ADOBE_PDF_API` line and DEV `PDFGenerator.gs` sheet const if you need to re-confirm 1 and 2. ("Logically holds" still isn't a runtime pass — verify, don't assume.)

## AGENT BRANDING (no Trip Store branding on agent PDFs)
- Show the agent's agency name, agent logo (italic-text fallback if logo missing), a colour-matched footer with agent contact details, and a 10-colour header palette picker.
- Pull agent profile by the quote's agent. Strip leftover debug: remove `Logger.log` calls from LIVE `PDFGenerator.gs` and the `testAgentProfileLookup()` helper.

## QUOTE → PDF HANDSHAKE
- v18 minted a server `Q-<10-digit>` quote ID returned on save; `downloadAdobePDF` sends `?quoteId=` (paxName legacy fallback). v18 was **promoted then rolled back** with the LIVE failure never captured — **do not retry without that failure evidence** (it's the v17.1–v17.5 trap).
- Recent billing-hash fixes: the genId hash-strip has shipped — verify the current handshake shape in TRUTH.md before assuming it.

## TRANSFER DETAILS IN THE PDF
The transfer DETAILS sentence is **always FE-derived** from `currentPlan` hotel names by leg/city in `transformEngineResult`. The server `selectedTransfers.schedule` string bakes in a different (non-hotel-aware) hotel name and must NOT be copied verbatim — that caused TO-column vs DETAILS hotel mismatches. The `_detailsCustom` flag preserves agent-typed DETAILS and is set ONLY by a direct DETAILS-cell edit (not by Vehicle Type or Swap Hotel).

## WHATSAPP PDF SEND
`quote_pdf` send must use `type:Template` + `headerValues:[pdfUrl]`. The `type:Document` form is a known bug to fix. (Interakt template constraints in `tripstore-sales`.)

## PENDING / CARRY
PDF CSS render-match (PDFGenerator.gs); the phantom ₹0 inter-city placeholder leg (engine-side, cosmetic). Don't fix render/export paths without seeing a current good-output sample first.
