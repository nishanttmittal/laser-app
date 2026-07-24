import { programOptions } from './catalog.js'
import { mergeMachineManifest, programPreviews } from './machineManifest.js'
import { normalizeSection } from './quoteMath.js'

function sectionFromText(value) {
  const text = String(value || '').trim()
  if (!text) return ''

  const normalized = normalizeSection(text)
  if (/^(?:R\d+(?:\.\d+)?|\d+(?:\.\d+)?x\d+(?:\.\d+)?)$/i.test(normalized)) {
    return normalized
  }

  const rect = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i)
  if (rect) return normalizeSection(`${rect[1]}x${rect[2]}`)

  const square = text.match(/\bsquare\b[^\d]*(\d+(?:\.\d+)?)/i)
  if (square) return normalizeSection(`${square[1]}x${square[1]}`)

  if (/^\s*(?:circular|circle|round|r\b|od\b|dia\b|ø)/i.test(text)) {
    const round = text.match(/(?:\bR|\bOD|\bDIA|Ø)\s*(\d+(?:\.\d+)?)/i)
    if (round) return normalizeSection(`R${round[1]}`)
  }

  return ''
}

export function buildQuoteProgramChoices(jobs, manifest, catalog = []) {
  const history = programOptions(jobs, catalog)
  return mergeMachineManifest(history, manifest, catalog)
    .filter((option) => option.runs > 0 && Number(option.secPerPiece) > 0)
    .map((option) => {
      const ambiguous = Boolean(option.machineCandidates?.length)
      const details = option.machine?.details || {}
      const section = sectionFromText(option.section)
        || sectionFromText(option.sizeKey)
        || sectionFromText(details.section)
      const preview = ambiguous ? null : programPreviews(option)[0]
      return {
        key: option.key,
        fileName: option.fileName,
        name: option.linkedName || option.fileName,
        section,
        thickness: details.thickness ?? option.thickness ?? '',
        length: details.partLength ?? '',
        secPerPiece: Number(option.secPerPiece),
        pieces: Number(option.pieces) || 0,
        runs: Number(option.runs) || 0,
        lastDay: option.lastDay || '',
        image: option.linkedPhoto || preview?.dataUrl || '',
        imageKind: option.linkedPhoto ? 'product' : preview?.dataUrl ? 'geometry' : 'none',
        ambiguous,
      }
    })
}

export function quoteDraftFromProgram(choice, current = {}) {
  if (!choice) return current
  return {
    ...current,
    name: choice.name || choice.fileName || current.name || '',
    section: choice.section || current.section || '',
    thickness: choice.thickness || current.thickness || '',
    length: choice.length || current.length || '',
    secPerPiece: Number(choice.secPerPiece) > 0 ? Number(choice.secPerPiece).toFixed(2) : '',
    cutPricePerPiece: '',
    matchSizeKey: `Exact program · ${choice.fileName}`,
  }
}

export function updateExactProgramField(line, field, value) {
  const exactSizeChanged = String(line?.matchSizeKey || '').startsWith('Exact program')
    && ['section', 'thickness'].includes(field)
    && String(line?.[field] || '').trim()
    && String(line[field]) !== String(value)
  return {
    ...line,
    [field]: value,
    ...(exactSizeChanged ? { secPerPiece: '', matchSizeKey: '' } : {}),
  }
}
