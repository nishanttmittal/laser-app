// Join the job catalog (worker's name + photo, linked by machine file) to the live jobs,
// so a friendly name + thumbnail surfaces wherever that file's runs appear.
// Pure + testable: no React, no Firebase.

const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
// Normalize a file name to a match key: basename, lowercased, trimmed.
export const normFile = (p) => baseName(p).trim().toLowerCase();
// Same, but without the machine extension, so "123" matches "123.zzx".
const PROGRAM_EXT = /\.(zx|zzx|dxf|nc|tube)$/i;
const noExt = (p) => normFile(p).replace(PROGRAM_EXT, '');

function setUnique(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, value);
  else if (map.get(key)?.id !== value?.id) map.set(key, null);
}

// Build a lookup from a catalog list -> { bySize, byFile }.
// Exact machine-program links identify products. Size-only links remain as a backward-compatible
// fallback for existing cards, but a file-linked card must never label every product of that size.
// Newest wins on a size clash. Extension-free file matches are disabled when ambiguous.
export function buildCatalogIndex(catalog) {
  const bySize = new Map();
  const byFile = new Map();
  const ordered = (catalog || []).slice().sort((a, b) => (a?.updatedAt || 0) - (b?.updatedAt || 0));
  for (const c of ordered) {
    if (!c || (!c.sizeKey && !c.fileName)) continue; // unlinkable
    const matchMode = c.matchMode || (c.fileName ? 'file' : 'size');
    const entry = {
      id: c.id, name: c.name || '', photo: c.photo || '', sizeKey: c.sizeKey || '',
      fileName: c.fileName || '', matchMode,
    };
    if (c.sizeKey && matchMode === 'size') bySize.set(c.sizeKey, entry);
    if (c.fileName) {
      const k1 = normFile(c.fileName), k2 = noExt(c.fileName);
      if (k1) byFile.set(k1, entry);
      if (k2 !== k1) setUnique(byFile, k2, entry);
    }
  }
  return { bySize, byFile };
}

const idxEmpty = (idx) => !idx || ((!idx.bySize || !idx.bySize.size) && (!idx.byFile || !idx.byFile.size));

// Find the catalog entry for one job: exact program first, then a legacy size-only fallback.
export function matchCatalog(job, idx) {
  if (idxEmpty(idx) || !job) return null;
  const f = job.file || job.fileName || '';
  if (idx.byFile) {
    const full = normFile(f);
    const exact = idx.byFile.get(full) || (!PROGRAM_EXT.test(full) ? idx.byFile.get(noExt(f)) : null);
    if (exact) return exact;
  }
  if (idx.bySize && job.sizeKey && idx.bySize.has(job.sizeKey)) return idx.bySize.get(job.sizeKey);
  return null;
}

// Attach catName / catPhoto to every job that has a catalog match (others pass through).
export function tagJobs(jobs, idx) {
  if (idxEmpty(idx)) return jobs || [];
  return (jobs || []).map((j) => {
    const hit = matchCatalog(j, idx);
    return hit ? { ...j, catName: hit.name, catPhoto: hit.photo } : j;
  });
}

// For a By-size row: the single catalog name covering its files, or null if 0 / mixed.
// `jobs` = the tagged jobs for that one size group.
export function sizeCatalog(jobs) {
  let name = null, photo = '', mixed = false;
  for (const j of jobs || []) {
    if (!j.catName) continue;
    if (name == null) { name = j.catName; photo = j.catPhoto || ''; }
    else if (j.catName !== name) { mixed = true; break; }
  }
  return mixed || name == null ? null : { name, photo };
}

// One picker option per exact machine program. Newest runs come first; the selected program
// carries its latest known size plus usage totals so an operator can identify it without typing.
export function programOptions(jobs, catalog = []) {
  const exactLinks = new Map();
  const stemLinks = new Map();
  for (const item of catalog || []) {
    if (!item?.fileName) continue;
    const entry = {
      id: item.id, name: item.name || '', photo: item.photo || '', fileName: item.fileName,
    };
    const full = normFile(item.fileName), stem = noExt(item.fileName);
    if (full) exactLinks.set(full, entry);
    if (stem !== full) setUnique(stemLinks, stem, entry);
  }

  const programs = new Map();
  for (const job of jobs || []) {
    const fileName = baseName(job?.file || job?.fileName || '').trim();
    const key = normFile(fileName);
    if (!key) continue;
    let option = programs.get(key);
    if (!option) {
      option = {
        key, fileName, sizeKey: '', section: '', thickness: null, tubeLength: null,
        runs: 0, pieces: 0, totalSec: 0, goodSec: 0, goodPieces: 0, pierces: 0,
        curveLength: 0, moveLength: 0, secPerPiece: null, lastDay: '', lastTime: '',
      };
      programs.set(key, option);
    }
    option.runs += 1;
    option.pieces += Number(job.partAmount) || 0;
    option.totalSec += Number(job.timeTaken) || 0;
    option.pierces += Number(job.pierceCount) || 0;
    option.curveLength += Number(job.curveLength) || 0;
    option.moveLength += Number(job.moveLength) || 0;
    if ((Number(job.partAmount) || 0) > 0 && !job.aborted) {
      option.goodSec += Number(job.timeTaken) || 0;
      option.goodPieces += Number(job.partAmount) || 0;
    }
    const day = String(job.day || '');
    const time = String(job.startTime || '');
    if (day > option.lastDay || (day === option.lastDay && time > option.lastTime)) {
      option.lastDay = day;
      option.lastTime = time;
      option.sizeKey = job.sizeKey || option.sizeKey;
      option.section = job.section || option.section;
      option.thickness = Number.isFinite(Number(job.thickness)) ? Number(job.thickness) : option.thickness;
      option.tubeLength = Number.isFinite(Number(job.length)) ? Number(job.length) : option.tubeLength;
    }
  }

  return [...programs.values()].map((option) => {
    const linked = exactLinks.get(option.key)
      || (!PROGRAM_EXT.test(option.key) ? stemLinks.get(noExt(option.fileName)) : null)
      || null;
    return {
      ...option,
      secPerPiece: option.goodPieces > 0 ? option.goodSec / option.goodPieces : null,
      linkedId: linked?.id || '',
      linkedName: linked?.name || '',
      linkedPhoto: linked?.photo || '',
    };
  }).sort((a, b) =>
    b.lastDay.localeCompare(a.lastDay) || b.lastTime.localeCompare(a.lastTime) || b.pieces - a.pieces);
}
