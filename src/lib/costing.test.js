import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyCost, quoteJob, countLengthChanges } from './costing.js';

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
