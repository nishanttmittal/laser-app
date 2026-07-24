# Automatic Machine Sync Agent - Claude Review

## Assignment

Implement the next phase identified in Claude's deployment review: prevent the 24-July machine
manifest from becoming stale by preparing an outbound-only incremental factory sync agent.

## Implementation

- `scripts/build-machine-manifest.mjs`
  - retains the established read-only scanner and matching rules;
  - falls back to Windows `tar.exe` when `unzip` is unavailable.
- `scripts/sync-machine-manifest.mjs`
  - validates that writable state/handoff folders are outside the source root;
  - uses an exclusive stale-safe lock;
  - invokes the established scanner with the prior successful manifest;
  - verifies SHA-256 before reusing a size/time-identical package;
  - records added, changed, removed, and unchanged programs;
  - preserves the last successful current manifest when scanning fails;
  - queues changed manifests in an offline outbox;
  - retries pending delivery on later runs;
  - optionally publishes archive, latest-manifest, and status files to a private synchronized
    folder;
  - stores JSONL operating logs with bounded rotation.
- `scripts/windows/Invoke-LaserProgramSync.ps1`
  - runs the Node coordinator using a credential-free JSON config.
- `scripts/windows/Install-LaserProgramSyncTask.ps1`
  - installs a limited-privilege, non-overlapping, start-when-available scheduled task.
- `scripts/sync-machine-manifest.test.mjs`
  - covers configuration boundaries, manifest diffing, first scan, unchanged reuse, modification,
    removal, folder delivery, source immutability, and disabled-handoff queueing.
- `docs/AUTOMATIC-MACHINE-SYNC.md`
  - documents prerequisites, configuration, first factory verification, scheduling, offline
    behavior, rollback, and cloud promotion boundary.

## Safety Boundary

- No production data, Firestore collection, document ID, field, or security rule changed.
- No machine program is launched, edited, saved, renamed, moved, or deleted.
- The default handoff mode is `none`.
- No password, token, API key, or service-account content is stored.
- The agent opens no inbound factory-network port.
- Source package files are not copied into the outbox or handoff.
- Existing Parts/Quote/Library workflows and device-local manifest import remain unchanged.

## Intentional Limit

This phase ends at a private outbound folder handoff. Automatic download by the browser app needs a
separately approved cloud storage schema, authentication/rules design, retention policy, and
stale-data UX. Implementing those implicitly would violate the prior manifest promotion boundary.

## Factory Acceptance

1. Install Node.js 18+ if not already present.
2. Configure the actual local program root and a local `workRoot`.
3. Run once with `handoff.mode: "none"` and reconcile against the 177-program baseline.
4. Run immediately again and confirm all programs are reused/unchanged.
5. Create or save one copied test program and confirm only that file is rescanned.
6. Enable a private synchronized-folder handoff and temporarily make it unavailable.
7. Confirm the run remains queued, then restore the folder and confirm automatic delivery.
8. Install the 15-minute task only after these checks pass.

## Verification Completed

- Staged factory baseline: 177 programs, 165 programs with matched previews, 379 embedded views,
  and 0 unreadable folders.
- Coordinator first run: 177 added, 177 scanned, one changed-manifest bundle queued with handoff
  intentionally disabled.
- Coordinator next run: 177 unchanged, 177 reused, 0 rescanned, and no duplicate outbox bundle.
- Same-size/same-timestamp test: changed bytes were detected by SHA-256 and rescanned.
- Handoff failure test: scan succeeded with one pending bundle; the next unchanged run delivered it
  after the folder became available.
- Source immutability assertion passed.
- Windows PowerShell parser accepted both runner/task scripts with no syntax errors.
- `npm test`: 19 test files passed.
- `npm run lint`: clean, including `scripts/*.mjs`.
- `npm run build`: passed.
- Node syntax checks and `git diff --check`: clean.

## Review Focus

1. Confirm folder handoff is the correct pre-schema boundary.
2. Confirm a 15-minute schedule and 20 delivered-run retention are appropriate.
3. Confirm the cloud promotion phase should use Firebase Storage rather than embedding manifest
   previews in Firestore documents.
4. Confirm factory packaging should retain the Node prerequisite or be compiled into a standalone
   executable later.
