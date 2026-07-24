# Program Image Matching - Claude Review

**Date:** 2026-07-24  
**Repository:** `/home/nishel/laser-app`  
**Production migration/deploy:** none  
**Machine access:** read-only extraction already complete

## Purpose

Match the Claude-built app's API/run-history programs to the extracted TubeST/TubePro records and
their images, while preventing a wrong finished-product photo from being assigned by tube size or
an ambiguous filename.

## Matching Rules

1. Exact program filename is authoritative.
2. A `.zx`/`.zzx` bridge is allowed only when the API history and machine inventory each have one
   unique file stem.
3. An existing catalog photo linked to the exact machine filename follows that safe bridge.
4. Embedded package geometry remains tied to the SHA-256-identified machine package.
5. Same-name files with different hashes remain ambiguous; candidate geometry is shown, but
   automatic product-photo matching and saving stay disabled.
6. Tube size alone never identifies a finished product.

## Visual Coverage

The extracted manifest contains 177 package records:

- 165 packages contain exact embedded machine geometry.
- 12 packages have no embedded bitmap and receive a clearly labelled tube-profile visual generated
  from machine metadata.
- 168 distinct Library rows result after identical duplicate copies are consolidated.
- 156 distinct rows show embedded geometry.
- 12 distinct rows are profile-only.
- 2 filename groups contain different hashes and remain ambiguous.

Existing API reconciliation remains intact: 134 unique history-to-machine matches, 32 active
machine-only names, and 104 history-only names.

## App Changes

- Product-photo links now propagate from an exact machine filename across a safe API extension
  bridge.
- Machine-only records can reuse an existing exact-file product card.
- Ambiguous candidate previews are visible as separate variants.
- Every active machine row has a stable visual: product photo, embedded geometry, or profile-only
  fallback.
- Added segmented Library filters for Machine, Product, Geometry, Profile, Ambiguous, and History.
- Default Library view now shows the active machine inventory; history-only programs remain
  available under History.
- Added incremental `Show more` rendering to keep the 5.4 MB local manifest responsive.

## Verification

- Full manifest logic audit: 177 package records, 168 Library rows, 156 geometry rows,
  12 profile-only rows, 2 ambiguous rows.
- `npm test`: all 17 test files passed.
- UTC test run: passed.
- `npm run lint`: clean.
- `npm run build`: passed.
- `git diff --check`: clean.
- Browser QA completed at desktop and 390 px mobile widths.
- No manifest or proprietary drawing was added to the public app bundle.
