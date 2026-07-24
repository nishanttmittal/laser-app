# Machine Manifest Import - Claude Review

**Date:** 2026-07-24  
**Repository:** `/home/nishel/laser-app`  
**Production migration:** none  
**Firestore rules/deploy:** untouched

## Purpose

Prepare the Visual Job Library to receive TubeST/TubePro program metadata and machine-generated
geometry previews during the next factory connection, while keeping the extraction read-only and
the imported data device-local.

## Preserved-Data Finding

The existing read-only `LaserD-mirror` proved that `.zzx` files are ZIP-based TubeST/TubePro
packages. They expose:

- `info.xml`: source application, application version, and package save time;
- `Segments/content.xml`: profile class, thickness, and nested tube-segment count;
- `Thumbnail/Seg` or numbered `Thumbnail/<id>` entries: embedded 400 x 400 Windows bitmap
  previews. A TubeST nest may contain multiple numbered views for different cut geometries.

The scanner converts supported uncompressed 24/32-bit BMP thumbnails to PNG entirely in Node. It
does not extract files into the source folder or invoke the machine software.

## Implementation

- Added `scripts/build-machine-manifest.mjs`.
- Added `npm run machine:manifest`.
- Excludes recycle/system/temp folders and does not follow directory symlinks.
- Hashes every active program and embedded preview with SHA-256.
- Uses all supported embedded package thumbnails before considering external sidecar images.
- Sidecar images are linked only by exact same-folder stem or a one-program/one-image folder.
- Adds `--previous=` incremental mode; unchanged files are reused by path, size, and modified time.
- Adds `machineManifest.js` normalization and conservative reconciliation.
- Adds IndexedDB-backed device-local manifest storage.
- Extends the Library with:
  - machine inventory count and manifest status;
  - machine-generated preview shown separately from the finished-product photo;
  - a capped on-screen gallery for multi-part nests while retaining all extracted views in the
    local manifest;
  - source application/version and match evidence;
  - observed sec/pc, history output/runs/pierces, tube length, thickness, part length, nested quantity,
    last cut, and program save time;
  - manifest-only programs that have not appeared in cloud run history.

## Matching Safety

- Finished-product catalog matching requires the exact explicit extension when a job has one.
- Extension-free catalog fallback remains only for historical records where the machine file has no
  extension.
- Machine metadata may bridge `.zx` / `.zzx` only when both sides have one unique file stem.
- One machine record cannot produce a duplicate manifest-only row after a unique cross-extension
  match.
- Same-name files with different SHA-256 hashes are exposed as ambiguous and cannot be
  automatically matched or assigned a product photo.
- Multiple products sharing one tube size cannot inherit one another's photo.

## Verification

Live factory read-only extraction:

- connected to Windows host `DESKTOP-20UV4A8` through its existing SMB shares;
- inventoried 7,512 files / 11.429 GB on `LaserD` and 40 files / 2.464 GB on `laser files`;
- copied 194 active program/support files (47,630,586 bytes) to laptop staging with zero failures;
- 173 program packages inventoried: 112 `.zx` and 61 `.zzx`;
- all 173 exposed profile, thickness, and nested quantity metadata;
- 372 embedded geometry views extracted from 161 programs; 12 packages contained no thumbnail;
- 134 history programs matched uniquely, 2 were correctly marked ambiguous, 28 were machine-only,
  and 104 cloud-history programs were not present in the active machine extraction;
- both TubeST and TubePro packages identified from embedded metadata;
- seven duplicate filename groups contained identical hashes and were safely deduplicated;
- two duplicate filename groups contained different hashes and were blocked from automatic
  matching;
- recycle-bin programs were excluded.

Second incremental factory check:

- machine rediscovered at its current DHCP address with the same verified hostname/MAC;
- 194 files unchanged, 4 new, 0 changed, and 0 missing;
- only four new TubeST programs were copied;
- incremental scanner reused 173 records and scanned 4;
- manifest now contains 177 records, 168 distinct filenames, and 379 embedded geometry views;
- package save timestamps are preserved and displayed in IST using the established
  Asia/Shanghai-to-Asia/Kolkata conversion;
- current TubePro logs confirm all four new programs were opened and two reached `Start Cutting`.

RayBox boundary:

- TubePro reports `IRayboxSvc` support and DataCenter is active on TCP `9527`;
- no separate RayBox API server was present on the documented TCP `8080` port;
- RayBox task/thumbnail cache folders were empty;
- published RayBox statistics for TubePro are documented as inaccurate/unstable and must be
  reconciled before costing use;
- remote file extraction should use an outbound-only sync agent because the RayBox API does not
  document arbitrary source-file download.

Recovery extraction:

- final active program/support comparison at 20:11 IST: 198 current, 198 baseline, 0 new,
  0 changed, 0 missing;
- 28 original CAD/project sources were copied separately: 16 STEP, 6 IGES, 2 SolidWorks part,
  and 4 `.yxy` files;
- 193 machine configuration, calibration, process-step, script, state, and repository files were
  copied into a targeted recovery bundle;
- all 221 newly copied active CAD/configuration files passed SHA-256 verification;
- 299 recoverable deleted drawing payloads were copied to a separate historical archive, with
  original path and deletion time recovered for every file and zero SHA-256 failures;
- bulk logs, caches, autosaves, temporary files, installers, recycle-bin contents, stale backups,
  and explicit secret/credential indicators were excluded from the recovery configuration set;
- deleted files remain excluded from active app reconciliation and automatic import;
- controller firmware, PLC/drive state, and hardware-resident parameters are outside the exposed
  SMB data and are not represented as captured.

App verification:

- existing preserved-sample Library rendering was retained;
- the live scanner recovered single-view and multi-view TubeST/TubePro packages without invoking
  either machine application;
- numbered bitmap inspection confirmed that a multi-part nest can contain distinct product
  geometry views rather than duplicate images.

Automated checks:

- `npm test`: 17 test files passed;
- timezone-independent test run included in final verification;
- `npm run lint`: clean;
- `npm run build`: passed;
- `git diff --check`: clean.
- `npm audit --omit=dev`: no high/critical findings; two inherited advisories remain (low
  `dompurify` via jsPDF and moderate `protobufjs` via Firebase). No broad dependency update was
  applied in this phase.

## Review Focus

1. Confirm device-local IndexedDB is the correct boundary for the first factory manifest.
2. Confirm unique-stem `.zx` / `.zzx` reconciliation is acceptable for machine metadata only.
3. Confirm nested `TubeSegment` count should be labelled `Nested parts` pending a larger sample.
4. Confirm any cloud manifest synchronization remains a separate schema/rules phase.
