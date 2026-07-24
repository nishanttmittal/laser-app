# TubeST / TubePro Read-Only Extraction Runbook

## Boundary

The factory computer is a source only. Do not launch, edit, save, rename, move, or delete a
machine program. Do not change TubeST, TubePro, BOCHU, RayBox, controller, Windows-share, or
firewall settings.

All generated manifests belong on the owner's laptop or a local staging folder. Importing a
manifest into the Laser app stores it in that browser's IndexedDB; it does not upload program
files, machine paths, previews, or cutting parameters to Firestore.

## Connection Check

1. Confirm the laptop is on the factory network.
2. Resolve the Windows hostname first and verify its current address from the local neighbour/ARP
   table. Do not assume yesterday's IP.
3. List the existing read-only share and top-level folders.
4. Inventory TubeST, TubePro, `ProgramSoft`, `YE_APPLICATIONS`, desktop program folders, databases,
   and preview/cache folders before copying anything.
5. Record file counts, extensions, total sizes, and modified times. Exclude `$RECYCLE.BIN`,
   `System Volume Information`, temporary folders, and deleted programs.

## First Extraction

Run the scanner against the mounted or locally staged read-only program folder:

```bash
npm run machine:manifest -- "/path/to/read-only/program-root" "/path/to/unico-machine-manifest.json"
```

The scanner:

- inventories `.zx`, `.zzx`, `.dxf`, `.nc`, and `.tube` programs;
- hashes source files with SHA-256;
- identifies TubeST or TubePro from package metadata where available;
- reads embedded XML metadata without changing the package;
- extracts profile class, thickness, nested-part count, source version, and package save time;
- converts embedded `Thumbnail/Seg` and numbered `Thumbnail/<id>` bitmaps to compact PNGs in
  memory, retaining multiple geometry views for multi-part nests;
- links sidecar images only when the evidence is unambiguous;
- leaves uncertain preview matches empty.

## Incremental Extraction

The full extraction is not required every time. Pass the prior manifest; unchanged files are reused
by exact source path, byte size, and modified time. New and modified programs are rescanned, and
deleted programs disappear from the new manifest.

```bash
npm run machine:manifest -- "/path/to/read-only/program-root" "/path/to/unico-machine-manifest-new.json" \
  --previous="/path/to/unico-machine-manifest-old.json"
```

Keep the old manifest until the new inventory counts and sample previews have been reviewed.

## Reconciliation

1. Import the reviewed JSON in the app's `Library` tab.
2. Confirm the cutting-file, matched-geometry, product-photo, and profile-only counts.
3. Search several known filenames and compare profile, thickness, nested quantity, save time, and
   preview with TubeST/TubePro.
4. Reconcile by exact filename first. An extension-free fallback is allowed only when both the
   history and machine inventory have one unique file with that stem.
5. If the same filename has different SHA-256 hashes in separate folders, treat it as ambiguous
   and rename one source program before linking a product photo.
6. Never infer a finished product identity from tube size alone.
7. Link a finished-product photo only after owner confirmation. That exact filename then labels
   its historical and future runs.
8. Use the Library image filters to review product photos, embedded geometry, profile-only
   fallbacks, ambiguous names, and API-history-only programs separately.

An embedded machine preview is automatically attached to the package that contains it. If a
package has no embedded bitmap, the app renders a tube-profile visual from the package metadata and
labels it `Profile`; this is not a finished-product photo. Existing exact-file product links also
follow a unique `.zx`/`.zzx` API-to-machine bridge. They never cross an ambiguous filename/hash.

## Promotion Boundary

The first factory manifest remains device-local. Any later cloud synchronization of machine
metadata or previews needs a separate Claude-reviewed schema/rules phase. No production migration
is part of this implementation.

## Automatic Incremental Agent

The additive sync coordinator in `scripts/sync-machine-manifest.mjs` automates the incremental
command without changing this promotion boundary. It provides:

- one-run locking so scheduled scans cannot overlap;
- reuse of the current successful manifest;
- added, changed, removed, and unchanged counts;
- an offline outbox containing changed manifests only;
- optional delivery to a private synchronized folder;
- atomic latest-manifest and status files;
- a Windows Task Scheduler runner with limited privileges.

Installation and verification are documented in `docs/AUTOMATIC-MACHINE-SYNC.md`. Keep folder
handoff disabled until the first factory run has been reconciled against the current 177-program
baseline.
