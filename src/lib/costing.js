// Pure cost-model math — no React, no Firebase — so it can be unit-tested.
// This is the money logic: monthly cost basis (incl. real metered electricity and the
// owner's per-cutting-day setup rate) and a per-job quote (with the loading & QC buffer).

const toD = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));

// Count REAL length changes from the job sequence: a 60-sec changeover only happens when the
// cut length actually changes (e.g. 6m -> 5m). The frequent same-length 6m auto-feeds are NOT
// counted — they're automatic and already inside the machine's cut time.
export function countLengthChanges(jobs) {
  const ord = (jobs || []).filter((j) => j.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
  let c = 0, prev = null;
  for (const j of ord) {
    if (j.length != null) { if (prev != null && j.length !== prev) c++; prev = j.length; }
  }
  return c;
}

// Monthly cost basis -> cost per billable minute.
// Electricity comes from REAL laser_days.kWh (calibrated to the meter), normalized to 30d.
// Setup = owner's size-change rate per cutting day + DATA-DERIVED length changes (60s each).
export function monthlyCost(days, cfg = {}, jobs = null) {
  const dd = (days || []).filter((d) => d.cutTime);
  const totalCutMin = dd.reduce((a, d) => a + (d.cutTime || 0) / 60, 0);
  const ds = dd.map((d) => String(d.statDate)).sort();
  const span = ds.length > 1 ? Math.max(1, (toD(ds[ds.length - 1]) - toD(ds[0])) / 864e5 + 1) : 30;
  const mCut = (totalCutMin / span) * 30;

  const cuttingDaysPerMonth = (dd.length / span) * 30;
  const sc = cfg.setup || {};
  // Size changes: owner's real rate per cutting day (manual re-tooling).
  const mSizeSetup = cuttingDaysPerMonth * (sc.sizeChangesPerDay ?? 5.5) * (sc.dimensionChangeMin ?? 40);
  // Length changes: data-derived from real length transitions (60s each) when jobs are given;
  // else fall back to a per-day estimate. Same-length 6m auto-feeds are excluded (in cut time).
  const lenMin = sc.lengthChangeMin ?? 1;
  const lengthChanges = jobs ? countLengthChanges(jobs) : null;
  const mLengthSetup = jobs
    ? (lengthChanges / span) * 30 * lenMin
    : cuttingDaysPerMonth * (sc.lengthChangesPerDay ?? 0.7) * lenMin;
  const mSetup = mSizeSetup + mLengthSetup;
  // Tube loading + feeding: explicit per-tube time (scales with tube COUNT, not cut time).
  // Tubes ~= runs (each nest/run loads a tube). Sum of day-level runs over the cut-time span.
  const loadMin = (sc.loadSecPerTube ?? 18) / 60;
  const tubesInSpan = dd.reduce((a, d) => a + (d.runs || 0), 0);
  const mLoading = (tubesInSpan / span) * 30 * loadMin;
  const mBill = mCut + mSetup + mLoading || 1;

  const rate = cfg.electricityRate || 14;
  const totalKWh = dd.reduce((a, d) => a + (d.kWh || 0), 0);
  const mElec = Math.round(((totalKWh / span) * 30) * rate);

  const f = cfg.monthlyFixed || {};
  const fixedExclElec =
    (f.operator || 0) + (f.maintenance || 0) + (f.rent || 0) + (f.consumables || 0) + (cfg.depreciationMonthly || 0);
  const totalMonthly = fixedExclElec + mElec;

  return { mCut, mSetup, mSizeSetup, mLengthSetup, mLoading, tubesInSpan, lengthChanges, mBill, costPerBillMin: totalMonthly / mBill, span, mElec, totalMonthly, fixedExclElec, cuttingDaysPerMonth };
}

// A single job quote. setupType: 'dimension' | 'length' | 'none'.
// The loading & QC buffer (+bufferPct) applies whenever stdMin > thresholdMin (0 = all jobs).
export function quoteJob({ secPerPiece = 0, qty = 0, setupType = 'dimension', cfg = {}, costPerBillMin = 0, piecesPerTube = 0, newPart = false }) {
  const sc = cfg.setup || {};
  const charge = cfg.chargePerMin || 40;
  // Reject yield: cut a bit extra so the customer still receives the ordered qty.
  const yld = 1 / (1 - (cfg.rejectionPct ?? 0) / 100);
  const qtyCut = qty * yld;
  const cutMin = (qtyCut * secPerPiece) / 60;
  const setupMin =
    setupType === 'dimension' ? (sc.dimensionChangeMin ?? 40) :
    setupType === 'length' ? (sc.lengthChangeMin ?? 1) : 0;
  // One-time nesting/programming for a brand-new part.
  const progMin = newPart ? (cfg.programmingMin ?? 0) : 0;
  // Explicit per-tube loading from the size's historical pieces-per-tube (on the cut qty).
  const tubes = piecesPerTube > 0 ? Math.ceil(qtyCut / piecesPerTube) : 0;
  const loadingMin = tubes * ((sc.loadSecPerTube ?? 18) / 60);
  const stdMin = cutMin + setupMin + loadingMin + progMin;
  // QC inspects finished PIECES, so it scales with cutting time only — not setup/loading/prog.
  const qcPct = (cfg.qcPct ?? cfg.longJob?.bufferPct ?? 12) / 100;
  const qcMin = cutMin * qcPct;
  const billMin = stdMin + qcMin;
  const rawCharge = billMin * charge;
  const minCharge = cfg.minOrderCharge ?? 0;
  const minApplied = rawCharge < minCharge;
  const quoteCharge = Math.max(rawCharge, minCharge);
  const quoteCost = billMin * costPerBillMin;
  return { cutMin, setupMin, loadingMin, progMin, qtyCut, tubes, qcMin, stdMin, billMin, rawCharge, quoteCharge, minApplied, quoteCost, margin: quoteCharge - quoteCost };
}

// Tube piece weight in GRAMS. section = 'AxB' (rect/square) or 'R{D}' (round, D = outer dia).
// thickness = wall mm, length = mm. density g/cm³ (MS 7.85, SS 8.0). Returns null if it can't.
export function tubeWeightGrams({ section, thickness, length, density = 7.85 }) {
  const t = +thickness, L = +length;
  if (!section || !(t > 0) || !(L > 0)) return null;
  let area = null; // metal cross-section area, mm²
  const rect = String(section).match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  const round = String(section).match(/^\s*R?\s*(\d+(?:\.\d+)?)\s*$/i);
  if (rect) { const A = +rect[1], B = +rect[2]; area = A * B - Math.max(0, A - 2 * t) * Math.max(0, B - 2 * t); }
  else if (round) { const D = +round[1]; area = Math.PI * t * Math.max(0, D - t); }
  if (!(area > 0)) return null;
  return area * L * density / 1000; // mm³ × (g/cm³ ÷ 1000) → grams
}

const fixedTotal = (cfg) => {
  const f = cfg.monthlyFixed || {};
  return (f.operator || 0) + (f.maintenance || 0) + (f.rent || 0) + (f.consumables || 0) + (cfg.depreciationMonthly || 0);
};

// WHAT-IF: project cost/min and monthly margin at a chosen cutting-hours/day.
// Fixed cost stays flat; only electricity and billable minutes scale -> shows how running
// the machine longer drops cost/min and lifts margin. `current` = a monthlyCost() result
// (used to keep the same setup-per-day and loading-per-cut-minute ratios as reality).
export function whatIf(current, cfg = {}, { cuttingHoursPerDay = 0, workingDaysPerMonth = 26 } = {}) {
  const charge = cfg.chargePerMin || 40;
  const rate = cfg.electricityRate || 14;
  const em = cfg.elecModel || {};
  const setupPerDay = current.cuttingDaysPerMonth ? current.mSetup / current.cuttingDaysPerMonth : 0;
  const loadingPerCutMin = current.mCut ? current.mLoading / current.mCut : 0;
  const mCut = cuttingHoursPerDay * 60 * workingDaysPerMonth;
  const mSetup = workingDaysPerMonth * setupPerDay;
  const mLoading = mCut * loadingPerCutMin;
  const mBill = mCut + mSetup + mLoading || 1;
  const kWhPerDay = (em.baseKWhPerDay ?? 35) + (em.perCutHourKWh ?? 20) * cuttingHoursPerDay;
  const mElec = Math.round(workingDaysPerMonth * kWhPerDay * rate);
  const totalMonthly = (current.fixedExclElec || fixedTotal(cfg)) + mElec;
  const costPerBillMin = totalMonthly / mBill;
  const qcPct = (cfg.qcPct ?? cfg.longJob?.bufferPct ?? 12) / 100;
  const revenue = (mBill + mCut * qcPct) * charge;
  return { cuttingHoursPerDay, workingDaysPerMonth, mCut, mBill, mElec, totalMonthly, costPerBillMin, marginPerMin: charge - costPerBillMin, revenue, monthlyMargin: revenue - totalMonthly };
}

// ---- Effective-dated rates ----
// Rates change over time. A job/day must be valued at the rate that was IN FORCE THEN, so a
// rate change today never re-prices already-supplied work. `history` = laser_rate_history docs
// (each a full rate snapshot with effectiveFrom = YYYYMMDD). Returns snapshots oldest-first.
export function buildRateSnaps(history = [], cfg = {}) {
  const snaps = (history || [])
    .filter((h) => h && h.effectiveFrom != null)
    .map((h) => ({ from: Number(h.effectiveFrom), rates: h }))
    .sort((a, b) => a.from - b.from);
  if (!snaps.length) snaps.push({ from: 0, rates: cfg }); // no history -> current rate for all time
  return snaps;
}
// The rate set in force on a given day (YYYYMMDD): the latest snapshot whose effectiveFrom <= day.
// Used for the WORK-related rates (price ₹/min, electricity, setup, QC) — exact to the day.
export function rateOn(ymd, snaps) {
  let r = snaps[0].rates;
  for (const s of snaps) { if (s.from <= Number(ymd)) r = s.rates; else break; }
  return r;
}
// Fixed monthly costs (rent/salary/depreciation) change from the 1st of the month AFTER the edit
// (owner rule). So month `ym` ('YYYY-MM') uses the latest snapshot whose effectiveFrom is in an
// EARLIER month — a change made during `ym` only counts from the next month.
export function fixedRateForMonth(ym, snaps) {
  let r = snaps[0].rates;
  for (const s of snaps) {
    const sym = `${String(s.from).padStart(8, '0').slice(0, 4)}-${String(s.from).padStart(8, '0').slice(4, 6)}`;
    if (sym < ym) r = s.rates; else break;
  }
  return r;
}

// ACTUAL margin per month, from real production + real per-day electricity (laser_days.kWh),
// each day valued at the rate IN FORCE ON THAT DAY (effective-dated — old days keep old rates).
// Revenue = billable minutes (cut + setup + loading + QC) at that day's ₹/min. Cost = monthly
// fixed (at the month's latest rate) + actual electricity. Material excluded (billed separately).
// Returns { months:[...], total:{...} } — `total` is the cumulative blend across all history.
export function monthlyMargins(days, cfg = {}, history = []) {
  const snaps = buildRateSnaps(history, cfg);
  const months = {};
  for (const d of days || []) {
    if (!d.cutTime) continue;
    const ymd = Number(d.statDate);
    const r = rateOn(ymd, snaps);
    const charge = r.chargePerMin || 40;
    const erate = r.electricityRate || 14;
    const sc = r.setup || {};
    const qcPct = (r.qcPct ?? r.longJob?.bufferPct ?? 12) / 100;
    const cutMin = (d.cutTime || 0) / 60;
    const setupMin = (sc.sizeChangesPerDay ?? 5.5) * (sc.dimensionChangeMin ?? 40); // one cutting day
    const loadingMin = (d.runs || 0) * ((sc.loadSecPerTube ?? 18) / 60);
    const billMin = cutMin + setupMin + loadingMin + cutMin * qcPct;
    const ym = `${String(d.statDate).slice(0, 4)}-${String(d.statDate).slice(4, 6)}`;
    const m = (months[ym] = months[ym] || { ym, cutMin: 0, billMin: 0, revenue: 0, elecCost: 0, cuttingDays: 0 });
    m.cutMin += cutMin;
    m.billMin += billMin;
    m.revenue += billMin * charge;
    m.elecCost += (d.kWh || 0) * erate;
    m.cuttingDays += 1;
  }
  const list = Object.values(months).map((m) => {
    const fixed = fixedTotal(fixedRateForMonth(m.ym, snaps)); // fixed costs change from next month

    const elecCost = Math.round(m.elecCost);
    const revenue = Math.round(m.revenue);
    const cost = fixed + elecCost;
    const margin = revenue - cost;
    return { ym: m.ym, cutH: +(m.cutMin / 60).toFixed(1), cuttingDays: m.cuttingDays, billMin: Math.round(m.billMin), revenue, elecCost, fixed, cost, margin, marginPct: revenue ? +(margin / revenue * 100).toFixed(0) : 0 };
  }).sort((a, b) => a.ym.localeCompare(b.ym));
  // Cumulative blended total across all history (each month already at its own rate).
  const total = list.reduce((t, m) => ({
    revenue: t.revenue + m.revenue, elecCost: t.elecCost + m.elecCost, fixed: t.fixed + m.fixed,
    cost: t.cost + m.cost, margin: t.margin + m.margin, cutH: +(t.cutH + m.cutH).toFixed(1),
  }), { revenue: 0, elecCost: 0, fixed: 0, cost: 0, margin: 0, cutH: 0 });
  total.marginPct = total.revenue ? Math.round(total.margin / total.revenue * 100) : 0;
  return { months: list, total };
}
