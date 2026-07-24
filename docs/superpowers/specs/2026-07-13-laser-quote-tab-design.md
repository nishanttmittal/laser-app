# Laser App — Quote Tab (usable customer quoting)

**Date:** 2026-07-13
**Status:** Approved (owner), pending implementation plan
**App:** `/home/nishel/laser-app` (React + Vite + Firebase + gh-pages)

## Problem
The owner cannot quote customers with the current app. The Costing tab only quotes **one historical size at a time**, only sizes **already cut** on the machine, and **cutting only** ("material billed separately"). Real jobs (e.g. the allwin cycle trike) are a **multi-part list**, need **material included**, and include **parts not yet cut**. The screen also exposes internal machine/cost detail, so it reads like an engineer's dashboard, not a quoting tool.

## Goal
A clean **Quote tab** (the app's first/default tab) that turns a customer's parts list into a branded per-piece quote in under a minute, and remembers parts, customers and past quotes. All other tabs (Dashboard, By-size, Reports, Machine, Fix-sizes) stay **untouched**.

## Scope
**In:** multi-line quoting; upload (Excel/CSV/pasted table) or type parts; auto material weight; wastage %; cutting time from BOCHU history (nearest) or manual; per-piece price = material + cutting; 18% GST; branded PDF + WhatsApp; save products/customers/quotes for reuse.
**Out (phase 2):** photo/OCR of a parts list; scrap-sale accounting; auto material-rate feed from Tally; multi-currency.

## Pricing model (per line)
- **Material weight** = `tubeWeightGrams({ section, thickness, length, density })` (already exists; exact for round & rect). Density default **7.85 (MS)**, option 8.0 (SS).
- **Wastage** = material weight × `(1 + wastagePct/100)`. `wastagePct` is a small owner-set default (editable per quote, remembered). Covers tube end-drop + kerf.
- **Material ₹/pc** = wastage-adjusted weight(kg) × **pipeRate ₹/kg** (owner types today's rate; remembers last).
- **Cutting ₹/pc** = `secPerPiece / 60 × cutRatePerMin`. `secPerPiece` from BOCHU history for that size (nearest match via `groupBySize`); if no match, owner types sec/piece **or** a ₹/piece cutting price. `cutRatePerMin` default `cfg.chargePerMin` (40), per-quote override (already in UI).
- **Price ₹/pc = material ₹/pc + cutting ₹/pc.** Line amount = price/pc × qty.
- **Totals:** subtotal = Σ line amounts; GST = subtotal × 18%; grand total = subtotal + GST.

## Input methods (both)
1. **Upload** `.xlsx`/`.csv` or **paste** a tab/comma table. Parser maps columns → `{ name, section (OD or AxB), thickness, length, qty }`. Tolerant of the allwin BOM layout (Part Name, OD, Thickness, Length, Total Quantity). Unmapped rows flagged for the owner to fix inline.
2. **Type** a part: section (dropdown of known sizes + free entry), thickness, length, qty → Add. Or tap a **saved common part** chip to add instantly.

## Data model (Firestore, additive — under existing `apps/laser/`)
- `apps/laser/products/{id}`: `{ name, section, thickness, length, secPerPiece?, note, active }` — the owner's tap-to-add common parts.
- `apps/laser/customers/{id}`: `{ name, phone?, note? }`.
- `apps/laser/quotes/{id}`: `{ customerId, customerName, date, lines:[{name,section,thickness,length,qty,secPerPiece,cutRatePerMin,pipeRate,density,wastagePct,matPerPc,cutPerPc,pricePerPc,amount}], subtotal, gst, gstPct, total, notes, createdBy, createdAt }`.
- Quote defaults (pipeRate, wastagePct, density, gstPct) stored on the existing `cfg` singleton (or a `quoteDefaults` doc); remembered between quotes.
- **Rules:** add owner/manager read-write for the three new collections, additive to the live ruleset. Deploy via `attendance-app/jobs/deployRules.js` (no Firebase CLI); audit after (missing rule = silent default-deny).

## New pure modules (testable with `node --test`, per app convention)
- `src/lib/quoteMath.js` — `computeLine(...)`, `computeQuote(lines, gstPct)`. No I/O.
- `src/lib/parseUpload.js` — xlsx/csv/tsv → part rows; column-mapping + validation. (xlsx via SheetJS `xlsx`, new dep.)
- Cutting match reuses existing `groupBySize`/`deriveSize` (sec/piece per size); a thin `nearestSecPerPiece(section, thickness, sizes)` helper if needed.

## Output
- `src/lib/quotePdf.js` — `buildQuotePDF(quote)` via **jspdf** (already a dep): UNICO logo header, GSTIN, per-piece line table, subtotal + GST + grand total, footer "prices subject to steel-rate revision." Matches the allwin quote look.
- **WhatsApp/share:** reuse existing `navigator.share` pattern (iPhone share sheet → WhatsApp), customer-facing text only (never cost/margin).

## UI
- Quote becomes the **first tab** (app opens clean on it). Components: `CustomerBar` → `AddPart` (upload + form + saved-part chips) → `LineTable` (inline-editable rows, per-pc + amount) → `Totals` (subtotal/GST/total) → `Actions` (Save · PDF · WhatsApp). Big buttons, minimal typing, dropdowns over typing (worker-UX rules).

## Reuse (don't rebuild)
`tubeWeightGrams` (weight), `groupBySize`/`deriveSize` (cutting history), `format.js` (rupee/fmt), `firebase.js` (`apps/laser/*`), existing share pattern.

## Safety
Additive only — new tab, new modules, new collections; existing tabs/collections/rules unchanged. Vite build is the only gate (no test runner in CI) → build + real-device load after changes. Rules pushed additively and audited.

## Success criteria
Owner can: upload the allwin BOM (or type parts) → see per-piece prices with material+cutting → get a branded PDF + WhatsApp quote → reopen it for a reorder — all without help, in under a minute.
