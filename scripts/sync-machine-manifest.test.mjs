import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  diffManifests,
  runSync,
  validateSyncConfig,
} from './sync-machine-manifest.mjs'

async function tempFolder(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`))
}

async function writeConfig(root, overrides = {}) {
  const sourceRoot = overrides.sourceRoot || path.join(root, 'source')
  const workRoot = overrides.workRoot || path.join(root, 'work')
  const config = {
    schemaVersion: 1,
    machine: 'test-laser',
    sourceRoot,
    workRoot,
    nodePath: process.execPath,
    previewLimitKb: 10,
    retainRuns: 5,
    handoff: { mode: 'none', path: '' },
    ...overrides,
  }
  const configPath = path.join(root, 'sync-config.json')
  await fs.writeFile(configPath, JSON.stringify(config))
  return { config, configPath }
}

test('validates source, work, and folder-handoff boundaries', () => {
  const valid = validateSyncConfig({
    sourceRoot: path.resolve('/tmp/laser-source'),
    workRoot: path.resolve('/tmp/laser-state'),
    handoff: { mode: 'folder', path: path.resolve('/tmp/laser-handoff') },
  })
  assert.equal(valid.previewLimitKb, 350)
  assert.equal(valid.retainRuns, 20)
  assert.equal(valid.handoff.mode, 'folder')

  assert.throws(() => validateSyncConfig({
    sourceRoot: path.resolve('/tmp/laser-source'),
    workRoot: path.resolve('/tmp/laser-source/state'),
  }), /must not be inside/)
  assert.throws(() => validateSyncConfig({
    sourceRoot: path.resolve('/tmp/laser-source'),
    workRoot: path.resolve('/tmp/laser-state'),
    handoff: { mode: 'folder', path: '' },
  }), /handoff.path/)
  assert.throws(() => validateSyncConfig({
    sourceRoot: 'D:\\',
    workRoot: 'D:\\UNICO\\state',
  }), /must not be inside/)
  assert.throws(() => validateSyncConfig({
    schemaVersion: 2,
    sourceRoot: path.resolve('/tmp/laser-source'),
    workRoot: path.resolve('/tmp/laser-state'),
  }), /Unsupported/)
})

test('diffs manifests by source path and file/preview identity', () => {
  const previous = {
    programs: [
      { sourcePath: '/machine/a.zzx', sha256: 'a1', previews: [{ sha256: 'p1' }] },
      { sourcePath: '/machine/b.zzx', sha256: 'b1' },
      { sourcePath: '/machine/removed.zzx', sha256: 'r1' },
    ],
  }
  const next = {
    programs: [
      { sourcePath: '/machine/a.zzx', sha256: 'a1', previews: [{ sha256: 'p1' }] },
      { sourcePath: '/machine/b.zzx', sha256: 'b2' },
      { sourcePath: '/machine/new.zzx', sha256: 'n1' },
    ],
  }
  assert.deepEqual(diffManifests(previous, next), {
    added: 1,
    changed: 1,
    removed: 1,
    unchanged: 1,
    hasChanges: true,
  })
})

test('runs incremental scans, publishes folder handoff, and records modifications/removals', async () => {
  const root = await tempFolder('laser-sync')
  const sourceRoot = path.join(root, 'source')
  const workRoot = path.join(root, 'work')
  const handoffPath = path.join(root, 'handoff')
  await fs.mkdir(sourceRoot, { recursive: true })
  const sourceFile = path.join(sourceRoot, 'sample.dxf')
  await fs.writeFile(sourceFile, 'first drawing')
  const fixedMtime = new Date('2026-07-25T00:59:00.000Z')
  await fs.utimes(sourceFile, fixedMtime, fixedMtime)
  const original = await fs.readFile(sourceFile, 'utf8')
  const { configPath } = await writeConfig(root, {
    sourceRoot,
    workRoot,
    handoff: { mode: 'folder', path: handoffPath },
  })

  const first = await runSync({ configPath, now: new Date('2026-07-25T01:00:00.000Z') })
  assert.equal(first.changes.added, 1)
  assert.equal(first.handoff.delivered, 1)
  assert.equal(first.handoff.pending, 0)
  assert.equal(first.lastError, '')
  assert.equal(await fs.readFile(sourceFile, 'utf8'), original, 'source program must remain unchanged')

  const currentPath = path.join(workRoot, 'state', 'unico-machine-manifest-current.json')
  const latestPath = path.join(handoffPath, 'unico-machine-manifest-latest.json')
  const current = JSON.parse(await fs.readFile(currentPath, 'utf8'))
  const latest = JSON.parse(await fs.readFile(latestPath, 'utf8'))
  assert.equal(current.programs.length, 1)
  assert.equal(latest.sync.runId, first.lastRunId)

  const second = await runSync({ configPath, now: new Date('2026-07-25T01:15:00.000Z') })
  assert.equal(second.changes.hasChanges, false)
  assert.equal(second.changes.unchanged, 1)
  const sentAfterNoChange = await fs.readdir(path.join(workRoot, 'outbox', 'sent'))
  assert.equal(sentAfterNoChange.length, 1, 'unchanged scans must not create archive bundles')

  await fs.writeFile(sourceFile, 'other drawing')
  await fs.utimes(sourceFile, fixedMtime, fixedMtime)
  const third = await runSync({ configPath, now: new Date('2026-07-25T01:30:00.000Z') })
  assert.equal(third.changes.changed, 1)
  assert.equal(third.handoff.delivered, 1)

  await fs.rm(sourceFile)
  const fourth = await runSync({ configPath, now: new Date('2026-07-25T01:45:00.000Z') })
  assert.equal(fourth.changes.removed, 1)
  assert.equal(fourth.manifest.programs, 0)
  assert.equal(fourth.handoff.delivered, 1)
})

test('keeps a pending outbox bundle when handoff is disabled', async () => {
  const root = await tempFolder('laser-sync-queue')
  const sourceRoot = path.join(root, 'source')
  const workRoot = path.join(root, 'work')
  await fs.mkdir(sourceRoot, { recursive: true })
  await fs.writeFile(path.join(sourceRoot, 'queued.nc'), 'G01 X1')
  const { configPath } = await writeConfig(root, { sourceRoot, workRoot })

  const state = await runSync({ configPath, now: new Date('2026-07-25T02:00:00.000Z') })
  assert.equal(state.handoff.mode, 'none')
  assert.equal(state.handoff.pending, 1)
  const pending = await fs.readdir(path.join(workRoot, 'outbox', 'pending'))
  assert.equal(pending.length, 1)
  const bundle = path.join(workRoot, 'outbox', 'pending', pending[0])
  assert.ok(JSON.parse(await fs.readFile(path.join(bundle, 'manifest.json'), 'utf8')))
  assert.ok(JSON.parse(await fs.readFile(path.join(bundle, 'run.json'), 'utf8')))
})

test('queues an unavailable folder handoff and delivers it on the next run', async () => {
  const root = await tempFolder('laser-sync-retry')
  const sourceRoot = path.join(root, 'source')
  const workRoot = path.join(root, 'work')
  const handoffPath = path.join(root, 'handoff')
  await fs.mkdir(sourceRoot, { recursive: true })
  await fs.writeFile(path.join(sourceRoot, 'retry.dxf'), 'drawing')
  await fs.writeFile(handoffPath, 'temporarily unavailable')
  const { configPath } = await writeConfig(root, {
    sourceRoot,
    workRoot,
    handoff: { mode: 'folder', path: handoffPath },
  })

  const queued = await runSync({ configPath, now: new Date('2026-07-25T02:15:00.000Z') })
  assert.equal(queued.lastError, '')
  assert.equal(queued.handoff.pending, 1)
  assert.match(queued.handoff.error, /exist|directory/i)

  await fs.rm(handoffPath)
  const delivered = await runSync({ configPath, now: new Date('2026-07-25T02:30:00.000Z') })
  assert.equal(delivered.changes.hasChanges, false)
  assert.equal(delivered.handoff.delivered, 1)
  assert.equal(delivered.handoff.pending, 0)
  assert.ok(JSON.parse(await fs.readFile(
    path.join(handoffPath, 'unico-machine-manifest-latest.json'),
    'utf8',
  )))
})
