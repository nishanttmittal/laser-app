# Parts Machine Visuals - Claude Review

## Problem

The device-local machine manifest was visible only in the Library. The daily Parts workflow still
showed a manually uploaded product photo or a generic tube icon, so importing the manifest did not
place the extracted cutting drawing beside the number of pieces produced.

## Implementation

- `src/lib/partsView.js`
  - carries the source program basename into each daily part card;
  - preserves the existing file-plus-size grouping, quantities, and costing calculations.
- `src/App.jsx`
  - loads the existing IndexedDB manifest in the Parts tab;
  - reuses the existing conservative Library reconciliation without changing its rules;
  - provides the same one-time local manifest import when no manifest is present;
  - shows extracted machine geometry beside the product photo and piece count;
  - uses exact package metadata for a profile fallback when the package has no embedded thumbnail;
  - labels profile-only packages separately so a generic icon is not presented as a cutting drawing;
  - identifies exact matches and visibly withholds ambiguous filename collisions.
- `src/styles.css`
  - adds compact paired visuals and manifest status styling without changing card dimensions.

## Data Boundary

No production data, Firestore collection, document ID, or field was changed. The 5.4 MB manifest
and proprietary machine drawings remain in browser-local IndexedDB and are not included in the
public application bundle. Each browser/device needs one import; the manifest remains available on
later visits unless that browser's site data is cleared.

## Verified Missing-Thumbnail Case

`54x50x4000.zzx` is an exact filename match and the extracted TubePro package reports a circular
section, 3.5 mm thickness, and quantity 80. Its `Thumbnail` directory has metadata but no
`Thumbnail/Seg` image. `54x3.2x4000.zzx` has the same limitation. The related
`54x50x5000.zzx` and `54x50x6000.zzx` packages contain thumbnails but have different thickness and
quantity data, so they are not substituted.

The Parts card now shows the verified circular profile and `Exact machine package - profile only
(thumbnail missing)`. Recovering an exact cutting drawing requires opening and saving/exporting the
original package in TubePro, then rebuilding the manifest; no production-data migration is needed.

## Verification

Run:

```bash
npm test
npm run lint
npm run build
```

Browser acceptance:

1. Open Parts and import `unico-machine-manifest-20260724.json`.
2. Confirm matched daily cards show a contained white-background cutting drawing beside `x pieces`.
3. Confirm a manually linked product photo and machine drawing can appear together.
4. Confirm ambiguous filenames display `Drawing hidden: filename collision`.
5. Reload the app and confirm the imported manifest remains available.
6. Select 06-07-2026 and confirm `54x50x4000.zzx` has a circular profile-only state, not a
   rectangular generic icon or a substituted drawing.
