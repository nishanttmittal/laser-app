import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyCost, quoteJob } from './costing.js';

const cfg = {
  electricityRate: 14,
  chargePerMin: 40,
  monthlyFixed: { operator: 50000, maintenance: 15000, rent: 30000, consumables: 5000 },
  depreciationMonthly: 41667,
  setup: { sizeChangesPerDay: 5, dimensionChangeMin: 40, lengthChangesPerDay: 2, lengthChangeMin: 0.5 },
  longJob: { bufferPct: 20, thresholdMin: 0 },
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
  assert.equal(m.setupPerDay, 5 * 40 + 2 * 0.5); // 201
  assert.equal(m.mSetup, 402);               // 2 * 201
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

test('quoteJob: loading & QC buffer (+20%) applies to EVERY job (threshold 0)', () => {
  const q = quoteJob({ secPerPiece: 12, qty: 100, setupType: 'dimension', cfg, costPerBillMin: 100 });
  assert.equal(q.cutMin, 20);                // 100 * 12 / 60
  assert.equal(q.setupMin, 40);              // dimension
  assert.equal(q.stdMin, 60);
  assert.equal(q.isBuffered, true);
  assert.equal(q.billMin, 72);               // 60 * 1.2
  assert.equal(q.quoteCharge, 72 * 40);
  assert.equal(q.quoteCost, 72 * 100);
  assert.equal(q.margin, 72 * 40 - 72 * 100);
});

test('quoteJob: a tiny 1-minute job still carries the buffer', () => {
  const q = quoteJob({ secPerPiece: 6, qty: 10, setupType: 'none', cfg, costPerBillMin: 20 });
  assert.equal(q.cutMin, 1);
  assert.equal(q.setupMin, 0);
  assert.equal(q.billMin, 1.2);              // 1 * 1.2 — buffer fires even for small jobs
});

test('quoteJob: length setup uses the (tiny) length-change minutes', () => {
  const q = quoteJob({ secPerPiece: 6, qty: 10, setupType: 'length', cfg, costPerBillMin: 20 });
  assert.equal(q.setupMin, 0.5);
  assert.equal(q.stdMin, 1.5);
  assert.equal(+q.billMin.toFixed(2), 1.8);
});

test('quoteJob: a positive threshold suppresses the buffer on small jobs', () => {
  const cfg2 = { ...cfg, longJob: { bufferPct: 20, thresholdMin: 60 } };
  const q = quoteJob({ secPerPiece: 6, qty: 10, setupType: 'none', cfg: cfg2, costPerBillMin: 20 });
  assert.equal(q.isBuffered, false);
  assert.equal(q.billMin, 1);                // no buffer below threshold
});
