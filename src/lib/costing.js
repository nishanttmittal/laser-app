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
export function quoteJob({ secPerPiece = 0, qty = 0, setupType = 'dimension', cfg = {}, costPerBillMin = 0, piecesPerTube = 0 }) {
  const sc = cfg.setup || {};
  const charge = cfg.chargePerMin || 40;
  const cutMin = (qty * secPerPiece) / 60;
  const setupMin =
    setupType === 'dimension' ? (sc.dimensionChangeMin ?? 40) :
    setupType === 'length' ? (sc.lengthChangeMin ?? 0.33) : 0;
  // Explicit per-tube loading: tubes for this job from the size's historical pieces-per-tube.
  const tubes = piecesPerTube > 0 ? Math.ceil(qty / piecesPerTube) : 0;
  const loadingMin = tubes * ((sc.loadSecPerTube ?? 18) / 60);
  const stdMin = cutMin + setupMin + loadingMin;
  // QC inspects finished PIECES, so it scales with cutting time only — NOT with setup or
  // loading (which produce no pieces to inspect). qcPct default 12% (loading is now separate).
  const qcPct = (cfg.qcPct ?? cfg.longJob?.bufferPct ?? 12) / 100;
  const qcMin = cutMin * qcPct;
  const billMin = stdMin + qcMin;
  const quoteCharge = billMin * charge;
  const quoteCost = billMin * costPerBillMin;
  return { cutMin, setupMin, loadingMin, tubes, qcMin, stdMin, billMin, quoteCharge, quoteCost, margin: quoteCharge - quoteCost };
}
