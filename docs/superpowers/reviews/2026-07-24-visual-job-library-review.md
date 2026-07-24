# Visual Job Library - Claude Review

**Date:** 2026-07-24  
**Repository:** `/home/nishel/laser-app`  
**Phase:** third step after timezone/performance hardening and customer quoting  
**Production migration:** none  
**Firestore rules/deploy:** untouched

## Problem Found

The existing catalog matched new product photos by tube size before considering the exact machine
file. That is unsafe for product identification: multiple products can use the same `40x20` tube,
so a size-level photo can appear on unrelated jobs.

The local preserved machine history confirms that exact-program selection is practical:

- 6,499 historical runs;
- 240 distinct machine program filenames;
- each program can be summarized by latest cut date, size, run count, and pieces.

## Implementation

- Added an owner `Library` tab while preserving the existing Admin and staff catalog entry points.
- Replaced the size picker with a searchable exact-program picker.
- Shows recent machine programs with filename, derived size, pieces, date, linked name/photo, and
  whether identification is still required.
- Supports phone camera capture or an existing photo file.
- Supports editing exact links and upgrading old size-only cards without changing their document ID.
- Exact machine-file matches now take priority. Existing size-only records remain a fallback.
- A file-linked record carrying `sizeKey` metadata is not indexed as a size fallback.
- Saved product name and photo now replace the raw `.zx`/`.zzx` filename on Parts cards and continue
  appearing in Production jobs and reports.
- Catalog reads and cached machine-program browsing are separated, so the program list remains
  usable when catalog reads are temporarily unavailable.

## Files

- `src/lib/catalog.js` - file-first matching and pure `programOptions()` aggregation.
- `src/lib/catalog.test.js` - exact-file precedence, fallback compatibility, collision prevention,
  and program aggregation coverage.
- `src/lib/partsView.js` / `partsView.test.js` - saved visual name becomes the Parts card label.
- `src/firebase.js` - additive `matchMode` field on existing `laser_job_catalog` documents.
- `src/App.jsx` - Library tab and exact-program photo-linking workflow.
- `src/styles.css` - responsive program picker, status counters, selection state, and saved library.

## Compatibility Boundary

No automatic photo assignments were written. The available screenshots contain useful machine
geometry/process previews, but they do not prove which finished-product photo belongs to which
program. Guessing would permanently mislabel historical and future runs.

The one-time owner confirmation is therefore deliberate:

1. select a recent or searched machine program;
2. enter the product name and choose/take its photo;
3. save the exact link.

The existing `laser_job_catalog` collection is reused. New documents add `fileName` and
`matchMode: "file"`; old size-only documents continue working with no migration.

## Verification

- Real 6,499-run local extract produced 240 exact program options.
- `npm test`: all 16 test files passed.
- `TZ=UTC npm test`: all 16 test files passed.
- `npm run lint`: clean.
- `npm run build`: passed; app `104.85 kB` (`33.53 kB` gzip).
- Playwright desktop and 390 px phone verification:
  - long machine filenames remain readable;
  - linked and unlinked states are visually distinct;
  - exact program selection shows size metadata;
  - existing image upload is compressed and previewed;
  - saved cards expose edit/upgrade actions;
  - no horizontal overflow.
- `git diff --check`: clean.
- No commit, deployment, catalog write, or production-data change was performed.

## Review Focus

1. Confirm exact-file precedence over size fallback.
2. Confirm old size-only records should remain as fallback until the owner upgrades them.
3. Confirm `matchMode` is an acceptable additive field on `laser_job_catalog`.
4. Confirm the owner should initially identify recurring/high-volume programs rather than all 240.

## Follow-On

The device-local TubeST/TubePro machine manifest importer and read-only scanner are documented in
`2026-07-24-machine-manifest-import-review.md`. That follow-on does not change the Firestore schema
or automatically assign finished-product identities.
