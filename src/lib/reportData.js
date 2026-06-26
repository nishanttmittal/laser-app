// Pure data layer for the period report (PDF). No React, no jsPDF — so the numbers
// that land in a customer/owner PDF are unit-tested. Rendering lives in pdf.js.
import { groupBySize } from './sizemap.js';

const inRange = (ymdNum, from, to) => ymdNum >= from && ymdNum <= to;
const round = (n) => Math.round(n || 0);

// Build the full period report from already-loaded data (zero extra Firestore reads).
// days = laser_days[], jobs = enriched+tagged jobs[], range = { from, to } (YYYYMMDD ints).
export function periodReport(days, jobs, cfg = {}, mo = {}, range = {}) {
  const from = +range.from || 0, to = +range.to || 99999999;
  const charge = cfg.chargePerMin || 40;
  const rate = cfg.electricityRate || 14;
  const costPerMin = mo.costPerBillMin || 0;

  const fDays = (days || []).filter((d) => d.statDate && inRange(+d.statDate, from, to));
  const fJobs = (jobs || []).filter((j) => j.day && inRange(+j.day, from, to));

  // Totals straight from the daily rollups (authoritative for pieces/cut time/kWh).
  let pieces = 0, cutSec = 0, runs = 0, kWh = 0, onSum = 0, utilSum = 0, offlineH = 0, alarms = 0, utilDays = 0;
  for (const d of fDays) {
    pieces += d.pieces || 0;
    cutSec += d.cutTime || 0;
    runs += d.runs || 0;
    kWh += d.kWh || 0;
    offlineH += d.offlineH || 0;
    alarms += d.alarmCount || 0;
    if (d.powerOnPct != null) { onSum += d.powerOnPct; utilSum += d.workUtilPct || 0; utilDays++; }
  }
  const cutMin = cutSec / 60;
  const totals = {
    cuttingDays: fDays.length,
    pieces,
    cutH: +(cutMin / 60).toFixed(1),
    runs,
    kWh: round(kWh),
    elecCost: round(kWh * rate),
    cuttingCharge: round(cutMin * charge), // cut time × ₹/min (matches the on-screen CSV column)
  };
  const utilization = {
    powerOnPct: utilDays ? Math.round(onSum / utilDays) : null,
    workUtilPct: utilDays ? Math.round(utilSum / utilDays) : null,
    offlineH: +offlineH.toFixed(1),
    alarms,
  };

  // By-size margins for the period (same math as the By-size screen).
  const bySize = groupBySize(fJobs)
    .filter((s) => !s.unlabelled)
    .map((s) => {
      const spp = s.secPerPiece || 0;
      const chargePc = (spp / 60) * charge;
      const costPc = (spp / 60) * costPerMin;
      return { sizeKey: s.sizeKey, pieces: s.pieces, secPerPiece: +spp.toFixed(1),
        chargePerPc: +chargePc.toFixed(2), marginPerPc: +(chargePc - costPc).toFixed(2),
        name: s.name || null };
    });

  // Day-by-day (detailed report).
  const byDay = fDays
    .slice()
    .sort((a, b) => +b.statDate - +a.statDate)
    .map((d) => ({ date: String(d.statDate), pieces: d.pieces || 0, runs: d.runs || 0,
      cutH: +(((d.cutTime || 0) / 3600)).toFixed(1), cuttingCharge: round(((d.cutTime || 0) / 60) * charge) }));

  // Top parts cut in the period (detailed report), by piece quantity.
  const partMap = {};
  for (const j of fJobs) {
    for (const p of j.parts || []) {
      const nm = (p.name || j.catName || j.title || '').trim() || '(unnamed)';
      partMap[nm] = (partMap[nm] || 0) + (p.amount || 0);
    }
  }
  const topParts = Object.entries(partMap)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 15);

  return { range: { from, to }, label: range.label || '', totals, utilization, bySize, byDay, topParts };
}
