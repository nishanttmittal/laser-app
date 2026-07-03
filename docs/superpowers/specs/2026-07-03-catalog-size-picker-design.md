# Laser Job Catalog — link photos by SIZE (dropdown), not typed file name

**Date:** 2026-07-03
**Problem:** Staff attach a job photo + name, then type the machine file name by hand to link
it. The typed names (e.g. `Square pipe 40X40X1.2mm`) don't match the machine's real file names
(e.g. `Square Tube 40 X R2 Thickness 1.2_Nest 3.zx`), so `catalog.js` matches nothing and **no
photo shows against any piece count.** Confirmed 2026-07-03: 3 catalog entries, 0 tag any job.

## Decision
Link a photo/name to a **SIZE** (the clean code the app already derives, e.g. `54x50 t3.2`),
chosen from a **dropdown of real sizes**, instead of a typed file name. Sizes are few, clean,
worker-friendly, and the photo surfaces directly on the By-size list against the piece count.
(Owner picked SIZE over FILE / BOTH on 2026-07-03.)

## Changes (additive, backward-compatible)
1. **Data model** — `laser_job_catalog` docs gain `sizeKey` (string). Existing `fileName`
   entries keep working (fallback match). No Firestore rules change (new field on an
   already-writable collection).
2. **`src/lib/catalog.js`** — `buildCatalogIndex` builds a **size-keyed** map plus the existing
   file-keyed map (for old entries). `matchCatalog(job, idx)` tries `job.sizeKey` first, then
   the file fallback. `tagJobs` / `sizeCatalog` interfaces unchanged. Index shape changes from a
   single `Map` to `{ bySize: Map, byFile: Map }` — update all call sites + tests.
3. **`src/firebase.js`** — `saveCatalogJob({ name, photo, sizeKey, fileName })` writes `sizeKey`.
4. **UI `JobCatalog` (src/App.jsx)** — replace the free-text "Link machine file" input with a
   **Size `<select>`** populated from real jobs: load jobs + sizeMap, `enrichJobs`, group, list
   `sizeKey · N pcs` sorted by pieces desc. Self-loading so it works in both Admin and the
   worker StaffMeter "Jobs" tab (no prop threading). Saved cards show the size instead of file.

## Testing
- TDD `catalog.test.js`: size match, file fallback for legacy entries, `sizeCatalog` per size,
  no-match passthrough, newest-wins on size clash.
- `npm run build` green; render-verify the dropdown + a saved card on a device-width preview.
- Deploy `npm run deploy` (gh-pages, `--dotfiles --nojekyll`).

## Migration
Existing 3 entries stay. Owner re-picks a size for the one with a photo ("O 50 Wark") so it
starts showing. No data deleted.

## Out of scope (YAGNI)
File-level linking, bulk-edit of old entries, multiple sizes per photo, per-nest granularity.
