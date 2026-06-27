import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyCost, quoteJob, countLengthChanges, whatIf, monthlyMargins, tubeWeightGrams } from './costing.js';

const cfg = {
  electricityRate: 14,
  chargePerMin: 40,
  monthlyFixed: { operator: 50000, maintenance: 15000, rent: 30000, consumables: 5000 },
  depreciationMonthly: 41667,
  setup: { sizeChangesPerDay: 5, dimensionChangeMin: 40, lengthChangesPerDay: 2, lengthChangeMin: 0.5 },
  qcPct: 12,
};

// 30-day span: two cutting days 29 days apart, 60 cut-min + 100 kWh each.
const days = [
  { statDate: 20260101, cutTime: 3600, kWh: 100 },
  { statDate: 20260130, cutTime: 3600, kWh: 100 },
];

test('monthlyCost: cutting + setup minutes', () => {
  const m = monthlyCost(days, cfg);
  assert.equal(m.span, 30);
  assert.equal(m.mCut, 120);                 // 120 cut-min / 30d * 30
  assert.equal(m.cuttingDaysPerMonth, 2);
  assert.equal(m.mSizeSetup, 400);           // 2 cutting-days * 5 size * 40 min
  assert.equal(m.mLengthSetup, 2);           // fallback (no jobs): 2 days * 2 len/day * 0.5 min
  assert.equal(m.mSetup, 402);               // 400 + 2
  assert.equal(m.mBill, 522);                // 120 + 402
});

test('monthlyCost: electricity from real kWh (not a static guess)', () => {
  const m = monthlyCost(days, cfg);
  assert.equal(m.mElec, 2800);               // (200kWh/30*30) * 14
  assert.equal(m.fixedExclElec, 141667);     // 50k+15k+30k+5k+41,667
  assert.equal(m.totalMonthly, 144467);      // fixed + electricity
});

test('monthlyCost: cost/min = totalMonthly / billable minutes', () => {
  const m = monthlyCost(days, cfg);
  assert.ok(Math.abs(m.costPerBillMin - 144467 / 522) < 1e-9);
});

test('monthlyCost: days without cutTime are excluded', () => {
  const withIdle = [...days, { statDate: 20260115, kWh: 999, pieces: 5 }]; // no cutTime
  const m = monthlyCost(withIdle, cfg);
  assert.equal(m.mElec, 2800);               // idle day's 999 kWh ignored
  assert.equal(m.cuttingDaysPerMonth, 2);
});

test('monthlyCost: empty input never divides by zero', () => {
  const m = monthlyCost([], cfg);
  assert.equal(m.mBill, 1);
  assert.ok(Number.isFinite(m.costPerBillMin));
});

test('quoteJob: QC (12%) applies to CUTTING only — not setup or loading', () => {
  const q = quoteJob({ secPerPiece: 12, qty: 100, setupType: 'dimension', cfg, costPerBillMin: 100 });
  assert.equal(q.cutMin, 20);                // 100 * 12 / 60
  assert.equal(q.setupMin, 40);              // dimension
  assert.equal(+q.qcMin.toFixed(2), 2.4);    // 12% of CUTTING (20) — NOT 12% of (20+40)
  assert.equal(q.stdMin, 60);                // cut + setup + loading (no QC)
  assert.equal(q.billMin, 62.4);             // 60 + 2.4  (would be 67.2 if QC hit setup too)
  assert.equal(q.quoteCharge, 62.4 * 40);
  assert.equal(q.margin, 62.4 * 40 - 62.4 * 100);
});

test('quoteJob: QC scales down with cutting on a tiny job', () => {
  const q = quoteJob({ secPerPiece: 6, qty: 10, setupType: 'none', cfg, costPerBillMin: 20 });
  assert.equal(q.cutMin, 1);
  assert.equal(+q.qcMin.toFixed(2), 0.12);   // 12% of 1
  assert.equal(+q.billMin.toFixed(2), 1.12);
});

test('quoteJob: length setup adds its minutes but QC stays on cutting', () => {
  const q = quoteJob({ secPerPiece: 6, qty: 10, setupType: 'length', cfg, costPerBillMin: 20 });
  assert.equal(q.setupMin, 0.5);
  assert.equal(q.stdMin, 1.5);               // 1 cut + 0.5 setup
  assert.equal(+q.qcMin.toFixed(2), 0.12);   // 12% of cut(1), not of 1.5
  assert.equal(+q.billMin.toFixed(2), 1.62); // 1.5 + 0.12
});

test('countLengthChanges: only real length transitions (same-length auto-feeds are free)', () => {
  const jobs = [
    { startTime: '2026-06-01 09:00:00', length: 6000 },
    { startTime: '2026-06-01 09:05:00', length: 6000 }, // same -> not a change
    { startTime: '2026-06-01 09:10:00', length: 5000 }, // change
    { startTime: '2026-06-01 09:15:00', length: 5000 }, // same
    { startTime: '2026-06-01 09:20:00', length: 4000 }, // change
  ];
  assert.equal(countLengthChanges(jobs), 2);
});

test('countLengthChanges: jobs with no parsed length are skipped', () => {
  const jobs = [
    { startTime: '2026-06-01 09:00:00', length: 6000 },
    { startTime: '2026-06-01 09:05:00' },               // null -> skipped
    { startTime: '2026-06-01 09:10:00', length: 5000 }, // change vs 6000
  ];
  assert.equal(countLengthChanges(jobs), 1);
});

test('monthlyCost: explicit per-tube loading scales with run/tube count', () => {
  // days carry per-day runs; tubes ~= runs. 18s/tube over a 30-day span.
  const cfgL = { ...cfg, setup: { ...cfg.setup, loadSecPerTube: 18 } };
  const withRuns = [
    { statDate: 20260101, cutTime: 3600, kWh: 100, runs: 50 },
    { statDate: 20260130, cutTime: 3600, kWh: 100, runs: 50 },
  ];
  const m = monthlyCost(withRuns, cfgL);
  assert.equal(m.tubesInSpan, 100);
  assert.ok(Math.abs(m.mLoading - 30) < 1e-9);            // 100 tubes * 18s = 30 min
  assert.ok(Math.abs(m.mBill - (m.mCut + m.mSetup + m.mLoading)) < 1e-9);
});

test('quoteJob: explicit loading from pieces-per-tube (tubes = ceil(qty / pcsPerTube))', () => {
  // 500 pcs at 100 pcs/tube -> 5 tubes -> 5 * 18s = 1.5 min loading (default loadSecPerTube 18)
  const q = quoteJob({ secPerPiece: 6, qty: 500, setupType: 'none', cfg, costPerBillMin: 20, piecesPerTube: 100 });
  assert.equal(q.tubes, 5);
  assert.equal(+q.loadingMin.toFixed(2), 1.5);
  assert.equal(q.cutMin, 50);                            // 500 * 6 / 60
  assert.equal(+q.stdMin.toFixed(2), 51.5);              // 50 cut + 0 setup + 1.5 loading
});

test('quoteJob: no pieces-per-tube -> no loading (graceful)', () => {
  const q = quoteJob({ secPerPiece: 6, qty: 100, setupType: 'none', cfg, costPerBillMin: 20, piecesPerTube: 0 });
  assert.equal(q.tubes, 0);
  assert.equal(q.loadingMin, 0);
});

test('monthlyCost: length setup is DATA-derived from job transitions when jobs given', () => {
  const cfgL = { ...cfg, setup: { ...cfg.setup, lengthChangeMin: 1 } };
  const jobs = [
    { startTime: '2026-06-01 09:00:00', length: 6000 },
    { startTime: '2026-06-01 09:05:00', length: 5000 }, // 1
    { startTime: '2026-06-01 09:10:00', length: 6000 }, // 2
    { startTime: '2026-06-01 09:15:00', length: 4000 }, // 3
  ];
  const m = monthlyCost(days, cfgL, jobs);
  assert.equal(m.lengthChanges, 3);
  assert.equal(m.mLengthSetup, 3);           // (3 / 30 span) * 30 * 1 min
  assert.equal(m.mSizeSetup, 400);           // 2 cutting-days * 5 size * 40 min
  assert.equal(m.mSetup, 403);
});

test('whatIf: more cutting hours -> lower cost/min (fixed cost spread wider)', () => {
  const cfgW = { ...cfg, elecModel: { baseKWhPerDay: 35, perCutHourKWh: 20 } };
  const current = monthlyCost(days, cfgW); // a baseline with ratios
  const low = whatIf(current, cfgW, { cuttingHoursPerDay: 4, workingDaysPerMonth: 26 });
  const high = whatIf(current, cfgW, { cuttingHoursPerDay: 10, workingDaysPerMonth: 26 });
  assert.ok(high.mCut > low.mCut);                       // more cutting minutes
  assert.ok(high.costPerBillMin < low.costPerBillMin);   // cost/min DROPS as hours rise
  assert.ok(high.monthlyMargin > low.monthlyMargin);     // and monthly margin RISES
  assert.ok(high.marginPerMin > low.marginPerMin);
});

test('monthlyMargins: revenue, actual electricity, fixed -> margin per month', () => {
  const ds = [
    { statDate: 20260601, cutTime: 6000, kWh: 100, runs: 10 }, // 100 cut-min
    { statDate: 20260615, cutTime: 6000, kWh: 100, runs: 10 },
    { statDate: 20260710, cutTime: 3000, kWh: 50, runs: 5 },   // different month
  ];
  const { months: rows } = monthlyMargins(ds, cfg);
  assert.equal(rows.length, 2);
  const jun = rows.find((r) => r.ym === '2026-06');
  // 200 cut-min, 2 cutting-days, 20 tubes, 200 kWh
  // setup = 2 * 5 * 40 = 400; loading = 20 * (18/60)=6; qc = 200*0.12=24; bill=200+400+6+24=630
  assert.equal(jun.billMin, 630);
  assert.equal(jun.revenue, 630 * 40);
  assert.equal(jun.elecCost, 200 * 14);
  assert.equal(jun.margin, jun.revenue - (jun.fixed + jun.elecCost));
});

test('monthlyMargins: effective-dated rates — old days keep the OLD price, new days the NEW', () => {
  const days = [
    { statDate: 20260610, cutTime: 6000, kWh: 0, runs: 0 }, // 100 cut-min, BEFORE the change
    { statDate: 20260620, cutTime: 6000, kWh: 0, runs: 0 }, // 100 cut-min, ON/AFTER the change
  ];
  // No setup/loading/qc noise: rates with everything 0 except the price, so revenue = cutMin × ₹/min.
  const flat = { monthlyFixed: {}, depreciationMonthly: 0, electricityRate: 14,
    setup: { sizeChangesPerDay: 0, dimensionChangeMin: 0, loadSecPerTube: 0 }, qcPct: 0 };
  const history = [
    { effectiveFrom: 20000101, chargePerMin: 40, ...flat }, // baseline ₹40
    { effectiveFrom: 20260615, chargePerMin: 50, ...flat }, // raised to ₹50 on the 15th
  ];
  const { months, total } = monthlyMargins(days, { chargePerMin: 50, ...flat }, history);
  const jun = months.find((m) => m.ym === '2026-06');
  // 10th valued at ₹40 (100×40=4000), 20th at ₹50 (100×50=5000) -> blended revenue 9000
  assert.equal(jun.revenue, 9000);
  assert.equal(total.revenue, 9000); // cumulative is the correct blend, not 200×50=10000
});

test('monthlyMargins: RENT change takes effect from the NEXT month (owner rule)', () => {
  const flat = { chargePerMin: 40, electricityRate: 14,
    setup: { sizeChangesPerDay: 0, dimensionChangeMin: 0, loadSecPerTube: 0 }, qcPct: 0 };
  const days = [
    { statDate: 20260520, cutTime: 6000, kWh: 0, runs: 0 }, // May — month of the change
    { statDate: 20260620, cutTime: 6000, kWh: 0, runs: 0 }, // June — month after
  ];
  const history = [
    { effectiveFrom: 20000101, monthlyFixed: { rent: 30000 }, depreciationMonthly: 0, ...flat },
    { effectiveFrom: 20260515, monthlyFixed: { rent: 50000 }, depreciationMonthly: 0, ...flat }, // rent 30k -> 50k mid-May
  ];
  const { months } = monthlyMargins(days, { monthlyFixed: { rent: 50000 }, depreciationMonthly: 0, ...flat }, history);
  assert.equal(months.find((m) => m.ym === '2026-05').fixed, 30000); // May (the change month) keeps OLD rent
  assert.equal(months.find((m) => m.ym === '2026-06').fixed, 50000); // June (next month) uses NEW rent
});

test('quoteJob: reject yield cuts a bit extra to ship the ordered qty', () => {
  const q = quoteJob({ secPerPiece: 6, qty: 100, setupType: 'none', cfg: { ...cfg, rejectionPct: 2 }, costPerBillMin: 20 });
  assert.equal(+q.qtyCut.toFixed(2), 102.04);     // 100 / 0.98
  assert.equal(+q.cutMin.toFixed(2), 10.20);      // 102.04 * 6 / 60
});

test('quoteJob: new-part programming is a one-time block, only when flagged', () => {
  const cfgP = { ...cfg, programmingMin: 25 };
  assert.equal(quoteJob({ secPerPiece: 6, qty: 100, setupType: 'none', cfg: cfgP, costPerBillMin: 20, newPart: true }).progMin, 25);
  assert.equal(quoteJob({ secPerPiece: 6, qty: 100, setupType: 'none', cfg: cfgP, costPerBillMin: 20, newPart: false }).progMin, 0);
});

test('quoteJob: minimum order charge floors a tiny job', () => {
  const q = quoteJob({ secPerPiece: 6, qty: 5, setupType: 'none', cfg: { ...cfg, minOrderCharge: 500 }, costPerBillMin: 20 });
  assert.equal(q.minApplied, true);
  assert.equal(q.quoteCharge, 500);               // raw ~22 floored to 500
});

test('tubeWeightGrams: rectangular MS tube (25x50, t1.2, 1m)', () => {
  const g = tubeWeightGrams({ section: '25x50', thickness: 1.2, length: 1000, density: 7.85 });
  assert.equal(Math.round(g), 1368); // metal area 174.24mm² × 1000 × 7.85/1000
});
test('tubeWeightGrams: round MS tube (OD50, t2, 1m)', () => {
  const g = tubeWeightGrams({ section: 'R50', thickness: 2, length: 1000, density: 7.85 });
  assert.equal(Math.round(g), 2368);
});
test('tubeWeightGrams: missing/zero inputs -> null', () => {
  assert.equal(tubeWeightGrams({ section: '25x50', thickness: 0, length: 1000 }), null);
  assert.equal(tubeWeightGrams({ section: '', thickness: 1, length: 1000 }), null);
});
