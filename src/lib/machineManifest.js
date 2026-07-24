import { normFile } from './catalog.js'
import { machinePackageDateTimeToBusiness } from './time.js'

export const MACHINE_MANIFEST_SCHEMA = 1

const PROGRAM_EXT = /\.(zx|zzx|dxf|nc|tube)$/i
const noExt = (value) => normFile(value).replace(PROGRAM_EXT, '')
const asNumber = (value) => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null

function normalizePreview(preview) {
  if (!preview || typeof preview !== 'object') return null
  const dataUrl = typeof preview.dataUrl === 'string' && preview.dataUrl.startsWith('data:image/')
    ? preview.dataUrl
    : ''
  const sourcePath = String(preview.sourcePath || '')
  if (!dataUrl && !sourcePath) return null
  return {
    dataUrl,
    fileName: String(preview.fileName || '').split(/[\\/]/).pop(),
    sourcePath,
    sha256: String(preview.sha256 || ''),
    matchEvidence: String(preview.matchEvidence || ''),
  }
}

function normalizeProgram(program) {
  if (!program || typeof program !== 'object') return null
  const fileName = String(program.fileName || program.name || program.sourcePath || '').split(/[\\/]/).pop().trim()
  if (!fileName) return null
  const preview = normalizePreview(program.preview)
  const previews = Array.isArray(program.previews)
    ? program.previews.map(normalizePreview).filter(Boolean)
    : []
  if (preview && !previews.some((item) =>
    (item.sha256 && item.sha256 === preview.sha256)
    || (item.sourcePath && item.sourcePath === preview.sourcePath))) {
    previews.unshift(preview)
  }
  return {
    fileName,
    sourceApp: String(program.sourceApp || 'Unknown'),
    sourceVersion: String(program.sourceVersion || ''),
    sourcePath: String(program.sourcePath || ''),
    sha256: String(program.sha256 || ''),
    modifiedAt: String(program.modifiedAt || ''),
    savedAt: String(program.savedAt || ''),
    savedAtIst: machinePackageDateTimeToBusiness(program.savedAt),
    sizeBytes: asNumber(program.sizeBytes),
    preview: preview || previews[0] || null,
    previews,
    details: {
      section: String(program.details?.section || ''),
      thickness: asNumber(program.details?.thickness),
      tubeLength: asNumber(program.details?.tubeLength),
      partLength: asNumber(program.details?.partLength),
      quantity: asNumber(program.details?.quantity),
      material: String(program.details?.material || ''),
      recipe: String(program.details?.recipe || ''),
    },
    evidence: Array.isArray(program.evidence)
      ? program.evidence.filter((item) => typeof item === 'string').slice(0, 20)
      : [],
  }
}

export function normalizeMachineManifest(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.programs)) {
    throw new Error('This is not a machine program manifest.')
  }
  const programs = raw.programs.map(normalizeProgram).filter(Boolean)
  if (!programs.length) throw new Error('The manifest contains no machine programs.')
  return {
    schemaVersion: Number(raw.schemaVersion) || MACHINE_MANIFEST_SCHEMA,
    generatedAt: String(raw.generatedAt || ''),
    sourceRoot: String(raw.sourceRoot || ''),
    machine: String(raw.machine || ''),
    inventory: raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {},
    programs,
  }
}

export function parseMachineManifest(text) {
  let raw
  try { raw = JSON.parse(text) }
  catch { throw new Error('The selected manifest is not valid JSON.') }
  return normalizeMachineManifest(raw)
}

function uniqueIndex(programs) {
  const groups = new Map()
  for (const program of programs || []) {
    const key = normFile(program.fileName)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(program)
  }

  const full = new Map()
  const ambiguous = new Map()
  const stems = new Map()
  for (const [key, candidates] of groups) {
    const identities = new Set(candidates.map((program) =>
      program.sha256 || `path:${program.sourcePath || program.modifiedAt || candidates.indexOf(program)}`))
    const sorted = [...candidates].sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)))
    const program = sorted[0]
    if (identities.size === 1) full.set(key, program)
    else ambiguous.set(key, sorted)
    const stem = noExt(program.fileName)
    if (!stem) continue
    if (!stems.has(stem)) stems.set(stem, identities.size === 1 ? program : null)
    else if (normFile(stems.get(stem)?.fileName) !== key || identities.size !== 1) stems.set(stem, null)
  }
  return { full, stems, ambiguous }
}

function exactCatalogIndex(catalog) {
  const index = new Map()
  const ordered = (catalog || []).slice().sort((a, b) => (a?.updatedAt || 0) - (b?.updatedAt || 0))
  for (const item of ordered) {
    const key = normFile(item?.fileName)
    if (!key) continue
    index.set(key, {
      id: item.id || '',
      name: item.name || '',
      photo: item.photo || '',
    })
  }
  return index
}

function attachMachineCatalog(option, machine, catalogIndex) {
  if (!machine || option.linkedId) return option
  const linked = catalogIndex.get(normFile(machine.fileName))
  return linked
    ? {
        ...option,
        linkedId: linked.id,
        linkedName: linked.name,
        linkedPhoto: linked.photo,
      }
    : option
}

export function programMachines(option) {
  if (option?.machine) return [option.machine]
  return Array.isArray(option?.machineCandidates) ? option.machineCandidates : []
}

export function programPreviews(option) {
  const seen = new Set()
  const previews = []
  const machines = programMachines(option)
  for (const [machineIndex, machine] of machines.entries()) {
    const candidates = machine.previews?.length
      ? machine.previews
      : [machine.preview].filter(Boolean)
    for (const preview of candidates) {
      if (!preview?.dataUrl) continue
      const identity = preview.sha256 || preview.sourcePath || preview.dataUrl
      const key = machines.length > 1 ? `${machineIndex}:${identity}` : identity
      if (seen.has(key)) continue
      seen.add(key)
      previews.push({
        ...preview,
        machineIndex,
        machineSha256: machine.sha256 || '',
      })
    }
  }
  return previews
}

export function programImageKind(option) {
  if (option?.linkedPhoto) return 'product'
  if (programPreviews(option).length) return 'geometry'
  if (programMachines(option).length) return 'profile'
  return 'none'
}

export function filterProgramOptions(options, filter = 'machine') {
  return (options || []).filter((option) => {
    const machines = programMachines(option)
    const kind = programImageKind(option)
    if (filter === 'product') return machines.length > 0 && kind === 'product'
    if (filter === 'geometry') return machines.length > 0 && kind === 'geometry'
    if (filter === 'profile') return machines.length > 0 && kind === 'profile'
    if (filter === 'ambiguous') return machines.length > 1
    if (filter === 'history') return machines.length === 0
    return machines.length > 0
  })
}

// Join local machine inventory to cloud history. Manifest-only programs stay visible so old or
// never-run programs can still be identified, while extension-free collisions remain unmatched.
export function mergeMachineManifest(options, manifest, catalog = []) {
  const programs = manifest?.programs || []
  if (!programs.length) return options || []
  const machineIdx = uniqueIndex(programs)
  const catalogIdx = exactCatalogIndex(catalog)
  const history = new Map((options || []).map((option) => [normFile(option.fileName), option]))
  const historyStems = new Map()
  for (const option of options || []) {
    const key = normFile(option.fileName)
    const stem = noExt(option.fileName)
    if (!historyStems.has(stem)) historyStems.set(stem, key)
    else if (historyStems.get(stem) !== key) historyStems.set(stem, null)
  }
  const matchedMachineKeys = new Set()

  const merged = (options || []).map((option) => {
    const key = normFile(option.fileName)
    const stem = noExt(option.fileName)
    const machineCandidates = machineIdx.ambiguous.get(key) || []
    const machine = machineIdx.full.get(key)
      || (!machineCandidates.length && historyStems.get(stem) === key ? machineIdx.stems.get(stem) : null)
      || null
    if (machine) matchedMachineKeys.add(normFile(machine.fileName))
    if (machineCandidates.length) matchedMachineKeys.add(key)
    return machine
      ? attachMachineCatalog({ ...option, machine }, machine, catalogIdx)
      : machineCandidates.length
        ? { ...option, machineCandidates }
        : option
  })

  for (const program of machineIdx.full.values()) {
    const key = normFile(program.fileName)
    if (!key || history.has(key) || matchedMachineKeys.has(key)) continue
    merged.push(attachMachineCatalog({
      key,
      fileName: program.fileName,
      sizeKey: program.details.section || '',
      section: program.details.section || '',
      thickness: program.details.thickness,
      tubeLength: program.details.tubeLength,
      runs: 0,
      pieces: 0,
      totalSec: 0,
      goodSec: 0,
      goodPieces: 0,
      pierces: 0,
      curveLength: 0,
      moveLength: 0,
      secPerPiece: null,
      lastDay: '',
      lastTime: '',
      linkedId: '',
      linkedName: '',
      linkedPhoto: '',
      machine: program,
    }, program, catalogIdx))
  }

  for (const [key, machineCandidates] of machineIdx.ambiguous) {
    if (history.has(key) || matchedMachineKeys.has(key)) continue
    merged.push({
      key,
      fileName: machineCandidates[0].fileName,
      sizeKey: '',
      section: '',
      runs: 0,
      pieces: 0,
      totalSec: 0,
      goodSec: 0,
      goodPieces: 0,
      pierces: 0,
      curveLength: 0,
      moveLength: 0,
      secPerPiece: null,
      lastDay: '',
      lastTime: '',
      linkedId: '',
      linkedName: '',
      linkedPhoto: '',
      machineCandidates,
    })
  }

  return merged.sort((a, b) =>
    Number(Boolean(b.lastDay)) - Number(Boolean(a.lastDay))
    || b.lastDay.localeCompare(a.lastDay)
    || b.lastTime.localeCompare(a.lastTime)
    || String(b.machine?.modifiedAt || '').localeCompare(String(a.machine?.modifiedAt || ''))
    || a.fileName.localeCompare(b.fileName))
}
