// Read-reduction for laser_jobs: cache on the device + only refetch a recent window,
// with a full reconcile every N days. Pure helpers (no Firestore/DOM) so they're testable.

export const WINDOW_DAYS = 35;     // how far back the light refresh refetches
export const RECONCILE_DAYS = 10;  // owner rule: full read at least every 10 days

const pad = (n) => String(n).padStart(2, '0');

// Calendar-safe YYYYMMDD arithmetic. This avoids host-timezone/DST shifts in cache windows.
export function cutoffFromYmd(todayYmd, days) {
  const s = String(todayYmd).replace(/\D/g, '');
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) - days));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

// 'YYYYMMDD' string `days` before `now` (Date). Used for the windowed `day >=` query.
export function cutoffYmd(now, days) {
  const todayYmd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return cutoffFromYmd(todayYmd, days);
}

// Decide whether this open needs a FULL read (first run, no cache, or reconcile due).
export function needFullRead(meta, nowMs, reconcileDays = RECONCILE_DAYS) {
  if (!meta || !meta.lastFullAt) return true;
  return (nowMs - meta.lastFullAt) > reconcileDays * 86400000;
}

// Merge fresh docs into cached docs by workUuid (fresh wins; new ones added).
export function mergeJobs(cache, fresh) {
  const byId = new Map();
  for (const j of cache || []) if (j && j.workUuid) byId.set(j.workUuid, j);
  for (const j of fresh || []) if (j && j.workUuid) byId.set(j.workUuid, j);
  return [...byId.values()];
}
