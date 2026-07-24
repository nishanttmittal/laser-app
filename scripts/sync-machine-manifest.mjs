#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const SYNC_AGENT_SCHEMA = 1
const DEFAULT_PREVIEW_LIMIT_KB = 350
const DEFAULT_RETAIN_RUNS = 20
const LOCK_STALE_MS = 2 * 60 * 60 * 1000
const MAX_LOG_BYTES = 5 * 1024 * 1024

const scriptPath = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(scriptPath)
const scannerPath = path.join(scriptDir, 'build-machine-manifest.mjs')

function absoluteOnCurrentPlatform(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value)
}

function isInside(parent, child) {
  const flavor = path.win32.isAbsolute(parent) && path.win32.isAbsolute(child) ? path.win32 : path
  const normalize = (value) => {
    const resolved = flavor.resolve(value)
    return flavor === path.win32 ? resolved.toLowerCase() : resolved
  }
  const relative = flavor.relative(normalize(parent), normalize(child))
  return relative === '' || (!relative.startsWith('..') && !flavor.isAbsolute(relative))
}

function positiveInteger(value, fallback, max) {
  const number = Number(value == null ? fallback : value)
  return Number.isInteger(number) && number > 0 && number <= max ? number : null
}

export function validateSyncConfig(raw, configPath = '') {
  if (!raw || typeof raw !== 'object') throw new Error('Sync configuration must be a JSON object.')
  if (raw.schemaVersion != null && Number(raw.schemaVersion) !== SYNC_AGENT_SCHEMA) {
    throw new Error(`Unsupported sync configuration schema: ${raw.schemaVersion}.`)
  }
  const sourceRoot = String(raw.sourceRoot || '').trim()
  const workRoot = String(raw.workRoot || '').trim()
  if (!sourceRoot || !absoluteOnCurrentPlatform(sourceRoot)) {
    throw new Error('sourceRoot must be an absolute path.')
  }
  if (!workRoot || !absoluteOnCurrentPlatform(workRoot)) {
    throw new Error('workRoot must be an absolute path.')
  }
  if (isInside(sourceRoot, workRoot)) {
    throw new Error('workRoot must not be inside the read-only sourceRoot.')
  }

  const previewLimitKb = Number(raw.previewLimitKb ?? DEFAULT_PREVIEW_LIMIT_KB)
  if (!Number.isFinite(previewLimitKb) || previewLimitKb < 0 || previewLimitKb > 1024) {
    throw new Error('previewLimitKb must be between 0 and 1024.')
  }
  const retainRuns = positiveInteger(raw.retainRuns, DEFAULT_RETAIN_RUNS, 100)
  if (!retainRuns) throw new Error('retainRuns must be an integer between 1 and 100.')

  const handoffRaw = raw.handoff && typeof raw.handoff === 'object' ? raw.handoff : {}
  const handoffMode = String(handoffRaw.mode || 'none').toLowerCase()
  if (!['none', 'folder'].includes(handoffMode)) {
    throw new Error('handoff.mode must be "none" or "folder".')
  }
  const handoffPath = String(handoffRaw.path || '').trim()
  if (handoffMode === 'folder' && (!handoffPath || !absoluteOnCurrentPlatform(handoffPath))) {
    throw new Error('handoff.path must be an absolute path when folder handoff is enabled.')
  }
  if (handoffMode === 'folder' && isInside(sourceRoot, handoffPath)) {
    throw new Error('handoff.path must not be inside the read-only sourceRoot.')
  }

  return {
    schemaVersion: SYNC_AGENT_SCHEMA,
    machine: String(raw.machine || '').trim(),
    sourceRoot,
    workRoot,
    nodePath: String(raw.nodePath || process.execPath),
    previewLimitKb,
    retainRuns,
    handoff: {
      mode: handoffMode,
      path: handoffPath,
    },
    configPath: String(configPath || ''),
  }
}

export async function readSyncConfig(configPath) {
  const absolute = path.resolve(configPath)
  let raw
  try {
    raw = JSON.parse(await fs.readFile(absolute, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Sync configuration is not valid JSON.', { cause: error })
    }
    throw error
  }
  return validateSyncConfig(raw, absolute)
}

function previewIdentity(program) {
  const previews = program?.previews?.length ? program.previews : [program?.preview].filter(Boolean)
  return previews.map((preview) => preview.sha256 || preview.sourcePath || '').sort().join('|')
}

function programIdentity(program) {
  return JSON.stringify({
    sha256: program?.sha256 || '',
    sizeBytes: program?.sizeBytes ?? null,
    modifiedAt: program?.modifiedAt || '',
    previews: previewIdentity(program),
  })
}

export function diffManifests(previous, next) {
  const before = new Map((previous?.programs || []).map((program) => [program.sourcePath, program]))
  const after = new Map((next?.programs || []).map((program) => [program.sourcePath, program]))
  let added = 0
  let changed = 0
  let unchanged = 0
  for (const [sourcePath, program] of after) {
    const prior = before.get(sourcePath)
    if (!prior) added += 1
    else if (programIdentity(prior) === programIdentity(program)) unchanged += 1
    else changed += 1
  }
  let removed = 0
  for (const sourcePath of before.keys()) {
    if (!after.has(sourcePath)) removed += 1
  }
  return {
    added,
    changed,
    removed,
    unchanged,
    hasChanges: added + changed + removed > 0,
  }
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')) }
  catch { return fallback }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w' })
  try { await fs.rename(temporary, filePath) }
  catch {
    await fs.rm(filePath, { force: true })
    await fs.rename(temporary, filePath)
  }
}

async function copyAtomic(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  await fs.copyFile(source, temporary)
  try { await fs.rename(temporary, destination) }
  catch {
    await fs.rm(destination, { force: true })
    await fs.rename(temporary, destination)
  }
}

async function acquireLock(lockPath, nowMs) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  try {
    const handle = await fs.open(lockPath, 'wx')
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date(nowMs).toISOString() }))
    await handle.close()
    return
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }

  const stat = await fs.stat(lockPath).catch(() => null)
  if (stat && nowMs - stat.mtimeMs > LOCK_STALE_MS) {
    await fs.rm(lockPath, { force: true })
    return acquireLock(lockPath, nowMs)
  }
  throw new Error('Another laser sync run is already active.')
}

async function rotateLog(logPath) {
  const stat = await fs.stat(logPath).catch(() => null)
  if (!stat || stat.size < MAX_LOG_BYTES) return
  await fs.rm(`${logPath}.1`, { force: true })
  await fs.rename(logPath, `${logPath}.1`)
}

async function appendLog(logPath, record) {
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  await rotateLog(logPath)
  await fs.appendFile(logPath, `${JSON.stringify(record)}\n`)
}

async function moveDirectory(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  try { await fs.rename(source, destination) }
  catch {
    await fs.cp(source, destination, { recursive: true, force: true })
    await fs.rm(source, { recursive: true, force: true })
  }
}

async function pruneRunFolders(folder, retainRuns) {
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
  const runs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
  for (const runId of runs.slice(retainRuns)) {
    await fs.rm(path.join(folder, runId), { recursive: true, force: true })
  }
}

async function pendingRunIds(pendingRoot) {
  const entries = await fs.readdir(pendingRoot, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function publishFolderHandoff(config, paths, currentManifestPath, currentRun) {
  if (config.handoff.mode !== 'folder') {
    return { mode: 'none', delivered: 0, pending: (await pendingRunIds(paths.pendingRoot)).length }
  }

  const handoffRoot = config.handoff.path
  const archiveRoot = path.join(handoffRoot, 'archive')
  await fs.mkdir(archiveRoot, { recursive: true })
  let delivered = 0
  for (const runId of await pendingRunIds(paths.pendingRoot)) {
    const pending = path.join(paths.pendingRoot, runId)
    await copyAtomic(path.join(pending, 'manifest.json'), path.join(archiveRoot, `unico-machine-manifest-${runId}.json`))
    await copyAtomic(path.join(pending, 'run.json'), path.join(archiveRoot, `unico-machine-sync-${runId}.json`))
    await moveDirectory(pending, path.join(paths.sentRoot, runId))
    delivered += 1
  }
  await copyAtomic(currentManifestPath, path.join(handoffRoot, 'unico-machine-manifest-latest.json'))
  await atomicWriteJson(path.join(handoffRoot, 'unico-machine-sync-status.json'), currentRun)
  await pruneRunFolders(paths.sentRoot, config.retainRuns)
  return { mode: 'folder', delivered, pending: (await pendingRunIds(paths.pendingRoot)).length }
}

function runIdFor(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function buildPaths(workRoot) {
  return {
    lock: path.join(workRoot, 'sync.lock'),
    currentManifest: path.join(workRoot, 'state', 'unico-machine-manifest-current.json'),
    nextManifest: path.join(workRoot, 'state', 'unico-machine-manifest-next.json'),
    state: path.join(workRoot, 'state', 'sync-state.json'),
    pendingRoot: path.join(workRoot, 'outbox', 'pending'),
    sentRoot: path.join(workRoot, 'outbox', 'sent'),
    log: path.join(workRoot, 'logs', 'sync.jsonl'),
  }
}

function runScanner(config, paths) {
  const args = [
    scannerPath,
    config.sourceRoot,
    paths.nextManifest,
    `--preview-limit-kb=${config.previewLimitKb}`,
    '--verify-hashes',
  ]
  if (config._hasPrevious) args.push(`--previous=${paths.currentManifest}`)
  const result = spawnSync(config.nodePath, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  })
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    throw new Error(`Manifest scanner failed${detail ? `: ${detail}` : '.'}`)
  }
  return String(result.stdout || '').trim()
}

export async function runSync({ configPath, now = new Date() }) {
  const config = await readSyncConfig(configPath)
  const paths = buildPaths(config.workRoot)
  const nowDate = now instanceof Date ? now : new Date(now)
  const nowMs = nowDate.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('Sync run time is invalid.')
  const runId = runIdFor(nowDate)
  await acquireLock(paths.lock, nowMs)

  try {
    await fs.mkdir(path.dirname(paths.nextManifest), { recursive: true })
    const previous = await readJson(paths.currentManifest)
    config._hasPrevious = Boolean(previous)
    const scannerOutput = runScanner(config, paths)
    const next = await readJson(paths.nextManifest)
    if (!next || !Array.isArray(next.programs)) throw new Error('Scanner produced an invalid manifest.')

    const changes = diffManifests(previous, next)
    next.machine = config.machine
    next.sync = {
      agentSchemaVersion: SYNC_AGENT_SCHEMA,
      runId,
      checkedAt: nowDate.toISOString(),
      changes,
    }
    await atomicWriteJson(paths.nextManifest, next)
    await copyAtomic(paths.nextManifest, paths.currentManifest)

    const run = {
      schemaVersion: SYNC_AGENT_SCHEMA,
      runId,
      machine: config.machine,
      checkedAt: nowDate.toISOString(),
      sourceRoot: config.sourceRoot,
      manifest: {
        programs: next.programs.length,
        previewsEmbedded: next.inventory?.previewsEmbedded || 0,
        reusedPrograms: next.inventory?.reusedPrograms || 0,
        scannedPrograms: next.inventory?.scannedPrograms || 0,
      },
      changes,
      scannerOutput,
    }

    if (!previous || changes.hasChanges) {
      const pending = path.join(paths.pendingRoot, runId)
      await fs.mkdir(pending, { recursive: true })
      await copyAtomic(paths.currentManifest, path.join(pending, 'manifest.json'))
      await atomicWriteJson(path.join(pending, 'run.json'), run)
    }

    let handoff
    try {
      handoff = await publishFolderHandoff(config, paths, paths.currentManifest, run)
    } catch (error) {
      handoff = {
        mode: config.handoff.mode,
        delivered: 0,
        pending: (await pendingRunIds(paths.pendingRoot)).length,
        error: error.message,
      }
    }

    const state = {
      schemaVersion: SYNC_AGENT_SCHEMA,
      machine: config.machine,
      lastAttemptAt: nowDate.toISOString(),
      lastSuccessAt: nowDate.toISOString(),
      lastRunId: runId,
      lastError: '',
      manifest: run.manifest,
      changes,
      handoff,
    }
    await atomicWriteJson(paths.state, state)
    await appendLog(paths.log, { level: handoff.error ? 'warn' : 'info', ...state })
    await fs.rm(paths.nextManifest, { force: true })
    return state
  } catch (error) {
    const priorState = await readJson(paths.state, {})
    const state = {
      ...priorState,
      schemaVersion: SYNC_AGENT_SCHEMA,
      machine: config.machine,
      lastAttemptAt: nowDate.toISOString(),
      lastError: error.message,
    }
    await atomicWriteJson(paths.state, state).catch(() => {})
    await appendLog(paths.log, { level: 'error', ...state }).catch(() => {})
    await fs.rm(paths.nextManifest, { force: true }).catch(() => {})
    throw error
  } finally {
    await fs.rm(paths.lock, { force: true }).catch(() => {})
  }
}

function usage() {
  console.error('Usage: node scripts/sync-machine-manifest.mjs --config=/absolute/path/config.json')
}

async function main() {
  const configArg = process.argv.slice(2).find((arg) => arg.startsWith('--config='))
  if (!configArg) {
    usage()
    process.exitCode = 1
    return
  }
  const state = await runSync({ configPath: configArg.slice('--config='.length) })
  console.log(JSON.stringify(state, null, 2))
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
