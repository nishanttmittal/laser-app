# Automatic TubePro / TubesT Program Sync

## Purpose

The sync agent removes the need to recopy the complete machine drive whenever programs change. It
scans the approved source folder read-only, verifies SHA-256 before reusing unchanged manifest
records, queues changed manifests locally, and can deliver them to a private synchronized folder.

This phase does not upload machine packages to Firestore, change production data, expose the
factory PC to inbound connections, or modify TubePro/TubesT files.

## Files

- `scripts/build-machine-manifest.mjs` - existing read-only package scanner; now supports Windows
  `tar.exe` when `unzip` is unavailable.
- `scripts/sync-machine-manifest.mjs` - lock, incremental scan, state, outbox, and folder handoff.
- `scripts/sync-agent.config.example.json` - configuration template without credentials.
- `scripts/windows/Invoke-LaserProgramSync.ps1` - Windows runner.
- `scripts/windows/Install-LaserProgramSyncTask.ps1` - Task Scheduler installer.

## Runtime Boundary

Source:

- `sourceRoot` is read only.
- The agent inventories `.zx`, `.zzx`, `.dxf`, `.nc`, and `.tube` files through the established
  scanner.
- `workRoot` and `handoff.path` are rejected when placed inside `sourceRoot`.

Local state:

- `state/unico-machine-manifest-current.json` - latest successful complete manifest.
- `state/sync-state.json` - last attempt, last success, change counts, queue status, and last error.
- `outbox/pending/<run-id>/` - changed manifests awaiting handoff.
- `outbox/sent/<run-id>/` - delivered bundles, retained according to `retainRuns`.
- `logs/sync.jsonl` - machine-readable run log, rotated at 5 MB.

The source package is never copied into the outbox. The manifest contains package hashes, metadata,
source paths, and compact embedded previews. Treat the handoff folder as proprietary factory data.

## Factory Prerequisites

1. Windows 10/11 with `tar.exe` available.
2. Node.js 18 or newer. No `npm install` is required for the agent scripts.
3. A local copy of the repository's `scripts` folder, for example
   `C:\UNICO\LaserProgramSync\scripts`.
4. Read access to the configured program root.
5. Write access only to `workRoot` and, when enabled, the private handoff folder.

## Configuration

Copy `sync-agent.config.example.json` to `sync-agent.config.json` beside the scripts and edit:

```json
{
  "schemaVersion": 1,
  "machine": "Laser-250811133266",
  "sourceRoot": "D:\\",
  "workRoot": "C:\\ProgramData\\UNICO\\LaserProgramSync",
  "nodePath": "node.exe",
  "previewLimitKb": 350,
  "retainRuns": 20,
  "handoff": {
    "mode": "none",
    "path": ""
  }
}
```

Use `handoff.mode: "none"` for the first factory verification. To deliver through an existing
private OneDrive/Google Drive desktop folder, set:

```json
{
  "handoff": {
    "mode": "folder",
    "path": "C:\\Users\\<factory-user>\\OneDrive\\UNICO Laser Sync"
  }
}
```

Do not put passwords, API keys, access tokens, or service-account JSON in this file.

## First Verification

Run PowerShell as the same Windows user that runs TubePro/TubesT:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File C:\UNICO\LaserProgramSync\scripts\windows\Invoke-LaserProgramSync.ps1 `
  -ConfigPath C:\UNICO\LaserProgramSync\scripts\sync-agent.config.json
```

Confirm:

1. The command exits successfully.
2. `sync-state.json` reports the expected program count and no `lastError`.
3. The first run reports programs as added; the immediate second run reports them as unchanged.
4. Source program hashes and modified times remain unchanged.
5. With folder handoff enabled, `unico-machine-manifest-latest.json` and
   `unico-machine-sync-status.json` appear in the private handoff folder.

## Scheduled Operation

After manual verification:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File C:\UNICO\LaserProgramSync\scripts\windows\Install-LaserProgramSyncTask.ps1 `
  -ConfigPath C:\UNICO\LaserProgramSync\scripts\sync-agent.config.json `
  -IntervalMinutes 15
```

The task runs with limited privileges, starts when Windows becomes available, ignores overlapping
runs, and has a 30-minute execution limit. This credential-free installation uses the current
user's interactive session, so that Windows user must be signed in. Running while signed out would
require a separately managed Windows task credential.

## Offline Behavior

- Scanner failure: current successful manifest remains unchanged and `lastError` is recorded.
- Handoff unavailable: the scan succeeds, its changed manifest remains under `outbox/pending`, and
  the handoff error is recorded as a warning.
- Later successful run: all pending bundles are delivered oldest first, then the latest manifest
  and status are refreshed.
- Unchanged scan: updates current check time but does not create another archive bundle.

## Rollback

Disable or delete only the `UNICO Laser Program Sync` scheduled task. The agent has no hooks inside
TubePro/TubesT and no source-side state to undo. Keep `workRoot` until the last successful manifest
has been reviewed.

## Cloud Promotion Boundary

A private synchronized folder is the only outbound handoff in this phase. Automatic app download
would require an approved storage location, authentication design, Firebase Storage/Firestore
rules, retention policy, and app-side stale-data behavior. That is a separate schema/rules phase
and must not be inferred from installing this collector.
