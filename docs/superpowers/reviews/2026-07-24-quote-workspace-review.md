# Quote Workspace - Claude Review

**Date:** 2026-07-24  
**Repository:** `/home/nishel/laser-app`  
**Source specification:** `docs/superpowers/specs/2026-07-13-laser-quote-tab-design.md`  
**Production migration:** none  
**Firestore rules/deploy:** not performed

## Summary

The approved multi-line Quote workflow is implemented as the owner's first/default tab. It supports:

- typed parts, reusable products, pasted CSV/TSV, and lazy-loaded Excel import;
- material weight, wastage, pipe rate, density, cutting rate, GST, and internal margin;
- nearest compatible BOCHU historical cutting-time matching with manual sec/pc or cut-price fallback;
- unknown internal margin is shown as unavailable when a manual cutting price has no cutting time;
- inline correction of every imported or typed line;
- customer/product/quote device storage, cloud client APIs, and quote reopening;
- branded customer PDF and customer-only WhatsApp/share text.

All existing tabs and production collections remain in place. No data was renamed, deleted, migrated,
or backfilled.

## Files

- `package.json` / `package-lock.json` - official SheetJS CE tarball dependency for `.xlsx` import.
- `src/App.jsx` - Quote added as the first/default owner tab; existing tab components are unchanged.
- `src/styles.css` - responsive quote workspace and horizontally scrollable eight-tab owner nav.
- `src/firebase.js` - additive APIs for `apps/laser/products`, `apps/laser/customers`, and
  `apps/laser/quotes`.
- `src/tabs/Quote.jsx` - complete owner quoting workflow.
- `src/lib/quoteMath.js` / `quoteMath.test.js` - tube/material/cutting/GST/margin math and nearest
  historical size matching.
- `src/lib/parseUpload.js` / `parseUpload.test.js` - tolerant CSV/TSV/matrix parser and real `.xlsx`
  workbook coverage.
- `src/lib/quoteStore.js` / `quoteStore.test.js` - device-local products, customers, quotes, and
  remembered quote defaults.
- `src/lib/quotePdf.js` / `quotePdf.test.js` - lazy-loaded branded A4 quotation PDF and safe filename.

The approved source specification was present before implementation and was not edited.

## Persistence Boundary

The UI saves locally first. Cloud reads/writes use only these additive paths:

- `apps/laser/products/{id}`
- `apps/laser/customers/{id}`
- `apps/laser/quotes/{id}`

The live Firestore rules are owned by another production repository, which was not authorized in
this request. Until owner-only rules are added there, the UI reports that the quote was saved on the
device and remains fully usable. After separate authorization:

1. add owner-only read/write coverage for exactly the three paths above using the existing laser
   access helper;
2. deploy with the production repository's established rules script;
3. audit the deployed rules and run one authenticated save/reopen check.

No client-side schema migration is required when those rules are enabled.

## Verification

- `npm test`: 16/16 test files passed.
- `TZ=UTC npm test`: 16/16 test files passed.
- `npm run lint`: clean.
- `npm run build`: passed; app chunk `102.04 kB` (`32.63 kB` gzip).
- Real SheetJS-generated `.xlsx` workbook imported in the automated test.
- Playwright desktop (820 px) and phone (390 px) workflows:
  - typed a part and matched `40x20 t1.2` to 12 sec/pc from machine history;
  - verified material, cutting, GST, total, and internal margin;
  - verified no phone-width horizontal overflow;
  - saved locally and observed the permission-aware cloud fallback;
  - verified the saved quote appears in Recent quotes;
  - downloaded the generated customer PDF.
- Poppler visual PDF review:
  - one-line branded PDF fits A4 with no clipping;
  - 40-line stress quote renders across three pages with repeated headers, totals, notes, and page
    numbering.
- `npm audit --omit=dev`: no high or critical findings. Two inherited transitive findings remain:
  low in `dompurify` through jsPDF and moderate in `protobufjs` through Firebase. SheetJS introduced
  no audit finding.
- `git diff --check`: clean.

## Review Focus

1. Confirm the quote pricing model and nearest-profile threshold (`0.35`) match the owner's intended
   commercial policy.
2. Confirm local-first persistence is acceptable until the separately authorized rules change.
3. Confirm internal margin remains owner-only because the Quote tab is never rendered for meter
   users and customer outputs exclude cost/margin.
4. Confirm the three additive Firestore schemas before authorizing the external rules deployment.
5. No commit or deployment was performed.
