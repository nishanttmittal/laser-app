// Join the job catalog (worker's name + photo, linked by machine file) to the live jobs,
// so a friendly name + thumbnail surfaces wherever that file's runs appear.
// Pure + testable: no React, no Firebase.

const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
// Normalize a file name to a match key: basename, lowercased, trimmed.
export const normFile = (p) => baseName(p).trim().toLowerCase();
// Same, but without the machine extension, so "123" matches "123.zzx".
const noExt = (p) => normFile(p).replace(/\.(zx|zzx|dxf|nc|tube)$/i, '');

// Build a lookup from a catalog list -> { bySize, byFile }.
// Primary link is the derived SIZE (e.g. '54x50 t3.2'); a legacy fileName link is kept as a
// fallback so old typed-file entries still work. Newest wins on a clash (sort by updatedAt asc
// so the latest edit is written last). File map is keyed by full basename + ext-stripped name.
export function buildCatalogIndex(catalog) {
  const bySize = new Map();
  const byFile = new Map();
  const ordered = (catalog || []).slice().sort((a, b) => (a?.updatedAt || 0) - (b?.updatedAt || 0));
  for (const c of ordered) {
    if (!c || (!c.sizeKey && !c.fileName)) continue; // unlinkable
    const entry = { id: c.id, name: c.name || '', photo: c.photo || '', sizeKey: c.sizeKey || '', fileName: c.fileName || '' };
    if (c.sizeKey) bySize.set(c.sizeKey, entry);
    if (c.fileName) {
      const k1 = normFile(c.fileName), k2 = noExt(c.fileName);
      if (k1) byFile.set(k1, entry);
      if (k2) byFile.set(k2, entry);
    }
  }
  return { bySize, byFile };
}

const idxEmpty = (idx) => !idx || ((!idx.bySize || !idx.bySize.size) && (!idx.byFile || !idx.byFile.size));

// Find the catalog entry for one job — by SIZE first, then the legacy file link — or null.
export function matchCatalog(job, idx) {
  if (idxEmpty(idx) || !job) return null;
  if (idx.bySize && job.sizeKey && idx.bySize.has(job.sizeKey)) return idx.bySize.get(job.sizeKey);
  const f = job.file || job.fileName || '';
  if (idx.byFile) return idx.byFile.get(normFile(f)) || idx.byFile.get(noExt(f)) || null;
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
