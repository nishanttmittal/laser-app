const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
const noExt = (p) => baseName(p).replace(/\.(zx|zzx|dxf|nc|tube)$/i, '');
const trimNum = (s) => { const n = Number(s); return Number.isFinite(n) ? String(n) : String(s); };

export function deriveSize(job) {
  if (job.hasSize) return { sizeKey: job.sizeKey, hasSize: true };
  const base = noExt(job.fileName || job.file || '');
  const thk = job.thickness;
  const tsuf = (thk != null && thk !== '') ? ` t${thk}` : '';
  // dimensions joined by x / × / *
  const dim = base.match(/(\d+(?:\.\d+)?)\s*(?:[xX×*]\s*(\d+(?:\.\d+)?)\s*)+/);
  if (dim) {
    const nums = (dim[0].match(/\d+(?:\.\d+)?/g) || []).map(Number);
    let key;
    if (nums.length >= 3) {
      // one of these is the cut length (large); the section = the small numbers
      const section = nums.filter((n) => n > 0 && n < 500);
      if (section.length >= 2) key = `${trimNum(section[0])}x${trimNum(section[1])}`;
      else if (section.length === 1) key = `R${trimNum(section[0])}`;
      else key = `${trimNum(nums[0])}x${trimNum(nums[1])}`;
    } else {
      key = `${trimNum(nums[0])}x${trimNum(nums[1])}`; // 2 numbers: show as-is
    }
    return { sizeKey: key + tsuf, hasSize: true };
  }
  // no x-pattern: a LONE number with no surrounding letters = round bar/tube
  const one = base.match(/\d+(?:\.\d+)?/g);
  if (one && one.length === 1 && Number(one[0]) < 500 && !/[a-z]/i.test(base)) {
    return { sizeKey: `R${trimNum(one[0])}${tsuf}`, hasSize: true };
  }
  // truly nameless
  return { sizeKey: base || '★ unknown', hasSize: false };
}

export function enrichJobs(jobs, map) {
  return (jobs || []).map((j) => {
    const hit = map && map[j.file];
    if (hit) return { ...j, sizeKey: hit.sizeKey, hasSize: true };
    const d = deriveSize(j);
    return { ...j, sizeKey: d.sizeKey, hasSize: d.hasSize };
  });
}

export function groupBySize(jobs) {
  const m = {};
  const UNL = { sizeKey: 'Unlabelled', hasSize: false, unlabelled: true, runs: 0, pieces: 0, sec: 0 };
  for (const j of jobs || []) {
    if (!j.hasSize) { UNL.runs++; UNL.pieces += j.partAmount || 0; UNL.sec += j.timeTaken || 0; continue; }
    const s = (m[j.sizeKey] = m[j.sizeKey] || { sizeKey: j.sizeKey, hasSize: true, runs: 0, pieces: 0, sec: 0 });
    s.runs++; s.pieces += j.partAmount || 0; s.sec += j.timeTaken || 0;
  }
  const rows = Object.values(m).sort((a, b) => b.pieces - a.pieces);
  if (UNL.runs) rows.push(UNL);
  return rows;
}

export function unlabelledFiles(jobs) {
  const m = {};
  for (const j of jobs || []) {
    if (j.hasSize) continue;
    const r = (m[j.file] = m[j.file] || { file: j.file, runs: 0, pieces: 0 });
    r.runs++; r.pieces += j.partAmount || 0;
  }
  return Object.values(m).sort((a, b) => b.pieces - a.pieces);
}
