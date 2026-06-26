// Join the job catalog (worker's name + photo, linked by machine file) to the live jobs,
// so a friendly name + thumbnail surfaces wherever that file's runs appear.
// Pure + testable: no React, no Firebase.

const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
// Normalize a file name to a match key: basename, lowercased, trimmed.
export const normFile = (p) => baseName(p).trim().toLowerCase();
// Same, but without the machine extension, so "123" matches "123.zzx".
const noExt = (p) => normFile(p).replace(/\.(zx|zzx|dxf|nc|tube)$/i, '');

// Build a lookup from a catalog list. Each entry must have a fileName to be linkable.
// Keyed by both the full basename and the extension-stripped name (newest wins on clash).
export function buildCatalogIndex(catalog) {
  const idx = new Map();
  for (const c of catalog || []) {
    if (!c || !c.fileName) continue;
    const entry = { id: c.id, name: c.name || '', photo: c.photo || '', fileName: c.fileName };
    const k1 = normFile(c.fileName), k2 = noExt(c.fileName);
    if (k1) idx.set(k1, entry);
    if (k2 && !idx.has(k2)) idx.set(k2, entry);
  }
  return idx;
}

// Find the catalog entry for one job (by its file), or null.
export function matchCatalog(job, idx) {
  if (!idx || !idx.size || !job) return null;
  const f = job.file || job.fileName || '';
  return idx.get(normFile(f)) || idx.get(noExt(f)) || null;
}

// Attach catName / catPhoto to every job that has a catalog match (others pass through).
export function tagJobs(jobs, idx) {
  if (!idx || !idx.size) return jobs || [];
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
