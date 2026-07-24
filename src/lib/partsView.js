// Pure, no React, no Firebase — aggregates laser_jobs into a per-part-per-day card list.
// Mirrors the BOCHU "Parts" screen concept: one card per file+size combination, per day.

import { programFileName } from './catalog.js'

const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '')

// Label fallback chain (81 % of runs have blank portionName / parts names).
function cardLabel(j) {
  if (j.catName && j.catName.trim()) return j.catName.trim()
  if (j.portionName && j.portionName.trim()) return j.portionName.trim()
  const pn = j.parts && j.parts[0] && j.parts[0].name && j.parts[0].name.trim()
  if (pn) return pn
  const fb = baseName(j.file || j.fileName || '')
  return fb || j.sizeKey || ''
}

// All distinct YYYYMMDD day strings in the job list that have at least one job, sorted desc.
export function daysWithJobs(jobs) {
  if (!jobs || !jobs.length) return []
  const s = new Set()
  for (const j of jobs) { if (j.day) s.add(String(j.day)) }
  return [...s].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
}

// Build the parts card array for a single day.
// Returns an array sorted by pieces desc, one card per file+sizeKey combo.
export function buildParts(jobs, { day } = {}) {
  if (!jobs || !jobs.length) return []

  const dayStr = String(day || '')
  const dayJobs = dayStr ? jobs.filter((j) => String(j.day) === dayStr) : []
  if (!dayJobs.length) return []

  // Group by aggregation key: file + sizeKey (different files with same cross-section stay apart).
  const groups = {}
  for (const j of dayJobs) {
    const key = `${j.file || ''}|${j.sizeKey || ''}`
    if (!groups[key]) {
      groups[key] = {
        key,
        fileName: programFileName(j.file || j.fileName || ''),
        label: cardLabel(j),
        section: j.section || '',
        length: j.length ?? null,
        thickness: j.thickness ?? null,
        sizeKey: j.sizeKey || '',
        catPhoto: j.catPhoto || '',
        hasSize: !!j.hasSize,
        pieces: 0,
        runs: 0,
        totalSec: 0,
        goodSec: 0,
        goodPieces: 0,
        aborted: false,
      }
    }
    const g = groups[key]
    // Update catPhoto with first non-empty value found
    if (!g.catPhoto && j.catPhoto) g.catPhoto = j.catPhoto
    // Total pieces and runs include every run (even aborted / 0-qty)
    g.pieces += j.partAmount || 0
    g.runs++
    g.totalSec += j.timeTaken || 0
    // Track if any run in the group was aborted (informational)
    if (j.aborted) g.aborted = true
    // Good run: partAmount > 0 && not aborted — mirrors groupBySize logic
    if ((j.partAmount || 0) > 0 && !j.aborted) {
      g.goodSec += j.timeTaken || 0
      g.goodPieces += j.partAmount || 0
    }
  }

  return Object.values(groups)
    .map((g) => {
      const totalMin = g.totalSec / 60
      // Derived from good runs only — aborted / 0-qty runs excluded
      const secPerPiece = g.goodPieces > 0 ? g.goodSec / g.goodPieces : 0
      // pcsPerMin: from good runs only, so it reconciles with secPerPiece (same basis)
      const pcsPerMin = g.goodSec > 0 ? g.goodPieces / (g.goodSec / 60) : 0
      return {
        key: g.key,
        fileName: g.fileName,
        label: g.label,
        section: g.section,
        length: g.length,
        thickness: g.thickness,
        sizeKey: g.sizeKey,
        catPhoto: g.catPhoto,
        hasSize: g.hasSize,
        pieces: g.pieces,
        runs: g.runs,
        totalSec: g.totalSec,
        totalMin,
        secPerPiece,
        pcsPerMin,
        aborted: g.aborted,
      }
    })
    .sort((a, b) => b.pieces - a.pieces)
}
