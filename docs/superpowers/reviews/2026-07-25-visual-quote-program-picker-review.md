# Visual Quote Program Picker - Claude Review

## Goal

Use the exact historical cutting program when preparing a quotation instead of relying only on the
nearest tube-size cutting speed. Keep the existing manual, saved-product, paste, and spreadsheet
workflows unchanged.

## Implementation

- Added `src/lib/quotePrograms.js`.
  - Reconciles run history with the existing device-local machine manifest.
  - Produces compact quote choices with the exact good-run `sec/pc`, historical pieces/runs,
    normalized section, thickness, available part length, and safe drawing/product image.
  - Withholds images for same-filename machine collisions.
  - Converts a selected choice into the existing quote draft fields.
- Corrected logical program normalization in `src/lib/catalog.js`.
  - BOCHU compound values such as `table107.zx\Rectangular Tube ..._Nest 2` now reconcile using
    `table107.zx`, matching TubeST and the six-month audit report.
  - Normal Windows and POSIX paths still resolve to their final basename.
- Updated `src/tabs/Quote.jsx`.
  - Adds a searchable, expandable exact-program picker above manual part entry.
  - Shows product photographs or extracted cutting drawings where available.
  - Populates the existing `matchSizeKey` field with `Exact program · filename`.
  - Preserves the exact rate on field blur and clears it only if an already-populated section or
    thickness is actually changed.
  - Retains nearest-size matching for manual/imported lines without an exact program.
- Updated `src/App.jsx` to pass the already-loaded catalog into Quote so saved product names and
  photographs appear in the picker.
- Added focused tests in `src/lib/quotePrograms.test.js`.

## Data Boundary

No Firestore collection, document ID, rule, or field was added or changed. The picker writes only
the quote fields that already existed: name, section, thickness, length, quantity, `secPerPiece`,
`cutPricePerPiece`, and `matchSizeKey`. Manifest images remain browser-local and are not copied into
quote records or the public bundle.

## Verification

```bash
npm test
npm run lint
npm run build
```

Acceptance checks:

1. Import the machine manifest once in Parts or Library.
2. Open Quote, expand `Choose exact cutting program`, and search by filename, saved name, or size.
3. Select a program and confirm the drawing, section, thickness, and measured `sec/pc`.
4. Enter length and quantity, add the part, and confirm `Cut time from Exact program · filename`.
5. Change a pre-populated section or thickness and confirm the exact rate is cleared.
6. Confirm paste, Excel/CSV upload, saved products, manual lines, PDF, and WhatsApp still work.

## Real Export Audit

The pure picker was also run against the downloaded January-July BOCHU workbooks and the reviewed
2026-07-24 machine manifest:

- 6,580 deduplicated first-sheet processing rows were read;
- 157 programs had a usable positive-piece measured cutting speed;
- 100 of those choices had a conservatively matched product or geometry image;
- 151 had a normalized tube section;
- all 157 had thickness.

History-only programs remain selectable for their exact measured speed but use the neutral `CUT`
placeholder. Same-filename machine collisions never expose a candidate drawing.
