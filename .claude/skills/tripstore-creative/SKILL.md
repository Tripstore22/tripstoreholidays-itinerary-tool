---
name: tripstore-creative
description: TripStore brand system and render-engine patterns for marketing creatives, WhatsApp campaign images, social posts, posters, and pitch or sales decks. Use this skill whenever creating any branded visual for TripStore, or whenever using Pillow, pptxgenjs, or the TripStore brand colours and fonts. It locks the cream and terracotta and teal palette, the serif typography, the rupee-glyph-safe fonts, the Pillow 2x-supersample scale-math pattern (the c.tw divided by S centering bug), the logo black-background removal, the pptxgenjs per-shape shadow factory, the locked USP copy, and the LibreOffice plus pdftoppm visual-QA loop. Consult before producing any branded visual so the recurring render bugs are not re-debugged every time.
---

# TripStore — Creative & Brand Render Patterns

Same render bugs recur every creative session. This locks them.

## BRAND SYSTEM (locked)
- **Palette:** cream `#FCF4E4`, terracotta `#E4773C`, ink/navy `#16334C`, plus warm muted brown for sub-text. Luxury-editorial feel. **Dark themes / terminal aesthetics are permanently rejected.**
- **Typography:** serif headlines (Playfair Display in the app UI; Georgia for Pillow/deck creatives). In the app: **system fonts only, no external CDNs, all colours hardcoded inline.**
- **INR format:** Indian comma style `₹X,XX,XXX` — never US grouping.

## RUPEE GLYPH — FONT TRAP
Only these render `₹` correctly: **`NationalPark-Bold.ttf`, `IBMPlexSerif-Bold.ttf`.** `Lora-Bold.ttf` and `WorkSans-Bold.ttf` do NOT render ₹ despite appearing to have the glyph in metrics. Use a ₹-safe font for any price text, or the rupee renders as tofu.

## PILLOW RENDER PATTERN (WhatsApp creatives)
- **Supersample for crispness:** render at 2x (e.g. 2160px), downscale to 1080 with `LANCZOS`. Fixes blur.
- **Scale-math (the recurring bug):** all coordinates passed to helpers use UNSCALED (1080px) values; the `C` canvas class multiplies by `S=2` internally. `c.tw(text, fn)` returns pixels in S-space. So to center text you MUST divide by S:
  ```python
  x = cx - c.tw(title, fn) / S / 2   # NOT cx - c.tw(title, fn)/2
  ```
  Forgetting `/S` is what misaligned every USP row. Apply consistently everywhere text is centered.
- **Logo black-background removal:** the logo at `/mnt/user-data/uploads/Trip_Store_Logo-01_copy.png` has a SOLID BLACK background. Strip it before compositing: pixels where `R<25 AND G<25 AND B<25` → alpha 0.

## PPTXGENJS DECK PATTERN
- **Shadow objects must never be reused across shapes.** Reusing one shadow dict across shapes corrupts rendering. Use a factory returning a NEW object each call:
  ```js
  const shadow = () => ({ type:'outer', color:'…', blur:…, offset:…, angle:… });
  ```
- Icons: react-icons + sharp render cleanly into deck assets.
- Deck palette/type same as brand system above (cream/terracotta/teal, Georgia / Trebuchet MS / Consolas family used in the NTO deck).

## VISUAL QA LOOP (do this before delivering any deck/PDF)
Convert and eyeball — never ship a deck unrendered:
```
libreoffice --headless --convert-to pdf <file.pptx>
pdftoppm -png -r 150 <file.pdf> qa
```
Then view the PNGs. Catches overflow (e.g. a card body hidden behind a CTA strip), clipped text, and palette mismatches.

## LOCKED USP COPY (use verbatim; pulled from the landing page)
- "Spend time closing, not quoting."
- "Real trip data" / "1,500+ real itineraries" — REPLACED the old "contracted rates" line; do not revert.
- "75+ European cities."
- The 90-second quoting hook (proposal in ~90 seconds).
- CTA phone number: confirm the current number against the latest approved creative before stamping (it lives on every CTA; do not guess).

## HONEST-CAVEAT DISCIPLINE
When a creative/deck makes a growth claim, flag aspirational vs real to Sumit: e.g. "200+ agents activated" is aspirational against 0 current paying agents; any tier-2/3 percentage stat needs a source for Q&A. Brand looks premium — keep the claims defensible.

## WHERE THIS WORK GOES
These are deliverables to copy/publish (WhatsApp, decks) → create real files and present them. Output to `/mnt/user-data/outputs/`. This skill is for the render mechanics; for the messaging strategy and segmentation see `tripstore-sales`.
