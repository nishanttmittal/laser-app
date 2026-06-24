export const ymd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const parseYmd = (n) => { const s = String(n); return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); };

export function lastCompleteDay(days, todayYmd) {
  const withPcs = days.filter((d) => (d.pieces || 0) > 0).sort((a, b) => a.statDate - b.statDate);
  const before = withPcs.filter((d) => d.statDate < todayYmd);
  return (before.length ? before[before.length - 1] : (withPcs[withPcs.length - 1] || null));
}

export function periodRange(kind, todayYmd, custom) {
  const t = parseYmd(todayYmd);
  const y = t.getFullYear(), m = t.getMonth();
  const mk = (d) => ymd(d);
  if (kind === 'today') return { from: todayYmd, to: todayYmd };
  if (kind === 'week') { const s = new Date(t); s.setDate(t.getDate() - 6); return { from: mk(s), to: todayYmd }; }
  if (kind === 'month') return { from: y * 10000 + (m + 1) * 100 + 1, to: mk(new Date(y, m + 1, 0)) };
  if (kind === 'lastMonth') return { from: mk(new Date(y, m - 1, 1)), to: mk(new Date(y, m, 0)) };
  if (kind === 'custom') return { from: custom.from, to: custom.to };
  return { from: 0, to: 99999999 }; // 'all'
}

export const filterDaysByRange = (days, { from, to }) =>
  days.filter((d) => d.statDate >= from && d.statDate <= to);

export function monthRollup(days) {
  const m = {};
  for (const d of days) {
    const ym = `${String(d.statDate).slice(0, 4)}-${String(d.statDate).slice(4, 6)}`;
    const r = (m[ym] = m[ym] || { ym, pieces: 0, runs: 0, cutH: 0, laserOnH: 0, kWh: 0 });
    r.pieces += d.pieces || 0; r.runs += d.runs || 0; r.cutH += d.cutTimeH || 0;
    r.laserOnH += d.laserOnH || 0; r.kWh += d.kWh || 0;
  }
  return Object.values(m).sort((a, b) => a.ym.localeCompare(b.ym));
}
