// Pure cost-model math — no React, no Firebase — so it can be unit-tested.
// This is the money logic: monthly cost basis (incl. real metered electricity and the
// owner's per-cutting-day setup rate) and a per-job quote (with the loading & QC buffer).

const toD = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));

// Monthly cost basis -> cost per billable minute.
// Electricity comes from REAL laser_days.kWh (calibrated to the meter), normalized to 30d.
// Setup minutes come from the owner's real changeover rate per CUTTING day (not the job log).
export function monthlyCost(days, cfg = {}) {
  const dd = (days || []).filter((d) => d.cutTime);
  const totalCutMin = dd.reduce((a, d) => a + (d.cutTime || 0) / 60, 0);
  const ds = dd.map((d) => String(d.statDate)).sort();
  const span = ds.length > 1 ? Math.max(1, (toD(ds[ds.length - 1]) - toD(ds[0])) / 864e5 + 1) : 30;
  const mCut = (totalCutMin / span) * 30;

  const cuttingDaysPerMonth = (dd.length / span) * 30;
  const sc = cfg.setup || {};
  const setupPerDay =
    (sc.sizeChangesPerDay ?? 5.5) * (sc.dimensionChangeMin ?? 40) +
    (sc.lengthChangesPerDay ?? 3.5) * (sc.lengthChangeMin ?? 0.33);
  const mSetup = cuttingDaysPerMonth * setupPerDay;
  const mBill = mCut + mSetup || 1;

  const rate = cfg.electricityRate || 14;
  const totalKWh = dd.reduce((a, d) => a + (d.kWh || 0), 0);
  const mElec = Math.round(((totalKWh / span) * 30) * rate);

  const f = cfg.monthlyFixed || {};
  const fixedExclElec =
    (f.operator || 0) + (f.maintenance || 0) + (f.rent || 0) + (f.consumables || 0) + (cfg.depreciationMonthly || 0);
  const totalMonthly = fixedExclElec + mElec;

  return { mCut, mSetup, mBill, costPerBillMin: totalMonthly / mBill, span, mElec, totalMonthly, fixedExclElec, cuttingDaysPerMonth, setupPerDay };
}

// A single job quote. setupType: 'dimension' | 'length' | 'none'.
// The loading & QC buffer (+bufferPct) applies whenever stdMin > thresholdMin (0 = all jobs).
export function quoteJob({ secPerPiece = 0, qty = 0, setupType = 'dimension', cfg = {}, costPerBillMin = 0 }) {
  const sc = cfg.setup || {};
  const charge = cfg.chargePerMin || 40;
  const cutMin = (qty * secPerPiece) / 60;
  const setupMin =
    setupType === 'dimension' ? (sc.dimensionChangeMin ?? 40) :
    setupType === 'length' ? (sc.lengthChangeMin ?? 0.33) : 0;
  const stdMin = cutMin + setupMin;
  const isBuffered = stdMin > (cfg.longJob?.thresholdMin ?? 0);
  const billMin = isBuffered ? stdMin * (1 + (cfg.longJob?.bufferPct ?? 20) / 100) : stdMin;
  const quoteCharge = billMin * charge;
  const quoteCost = billMin * costPerBillMin;
  return { cutMin, setupMin, stdMin, isBuffered, billMin, quoteCharge, quoteCost, margin: quoteCharge - quoteCost };
}
