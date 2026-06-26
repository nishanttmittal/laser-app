import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodReport } from './reportData.js';

const cfg = { chargePerMin: 40, electricityRate: 14 };
const mo = { costPerBillMin: 26.89 };

const days = [
  { statDate: 20260601, pieces: 1000, cutTime: 3600, runs: 10, kWh: 100, powerOnPct: 30, workUtilPct: 70, offlineH: 16, alarmCount: 1 },
  { statDate: 20260615, pieces: 500, cutTime: 1800, runs: 5, kWh: 60, powerOnPct: 20, workUtilPct: 60, offlineH: 18, alarmCount: 0 },
  { statDate: 20260705, pieces: 9999, cutTime: 9999, runs: 9 }, // OUTSIDE June range
];
const jobs = [
  { day: '20260601', sizeKey: '40x40 t2', hasSize: true, partAmount: 100, timeTaken: 600, parts: [{ name: 'Leg', amount: 100 }] },
  { day: '20260601', sizeKey: '40x40 t2', hasSize: true, partAmount: 100, timeTaken: 600, parts: [{ name: 'Leg', amount: 100 }] },
  { day: '20260615', sizeKey: '25x50 t2', hasSize: true, partAmount: 50, timeTaken: 500, parts: [{ name: 'Rail', amount: 50 }] },
  { day: '20260705', sizeKey: '99x99', hasSize: true, partAmount: 999, timeTaken: 999, parts: [] }, // OUTSIDE
];
const range = { from: 20260601, to: 20260630, label: 'June 2026' };

test('totals only count days inside the range', () => {
  const r = periodReport(days, jobs, cfg, mo, range);
  assert.equal(r.totals.cuttingDays, 2);
  assert.equal(r.totals.pieces, 1500);          // 1000 + 500, July day excluded
  assert.equal(r.totals.kWh, 160);
  assert.equal(r.totals.elecCost, 160 * 14);
  assert.equal(r.totals.cuttingCharge, Math.round((5400 / 60) * 40)); // 90 min × 40
});

test('utilization averages only days that have it', () => {
  const r = periodReport(days, jobs, cfg, mo, range);
  assert.equal(r.utilization.powerOnPct, 25);   // (30+20)/2
  assert.equal(r.utilization.workUtilPct, 65);
  assert.equal(r.utilization.alarms, 1);
});

test('by-size margins use charge minus cost per minute', () => {
  const r = periodReport(days, jobs, cfg, mo, range);
  const leg = r.bySize.find((s) => s.sizeKey === '40x40 t2');
  assert.equal(leg.pieces, 200);
  // 200 pcs in 1200s -> 6 s/pc -> charge/pc = 6/60*40 = 4.00
  assert.equal(leg.chargePerPc, 4);
  assert.ok(leg.marginPerPc > 0 && leg.marginPerPc < 4);
});

test('byDay newest-first, only in range', () => {
  const r = periodReport(days, jobs, cfg, mo, range);
  assert.equal(r.byDay.length, 2);
  assert.equal(r.byDay[0].date, '20260615'); // newest first
});

test('topParts aggregates and excludes out-of-range jobs', () => {
  const r = periodReport(days, jobs, cfg, mo, range);
  const leg = r.topParts.find((p) => p.name === 'Leg');
  assert.equal(leg.qty, 200);
  assert.ok(!r.topParts.some((p) => p.qty === 999)); // July part excluded
});

test('empty range gives zeroed totals, no crash', () => {
  const r = periodReport(days, jobs, cfg, mo, { from: 20270101, to: 20270131 });
  assert.equal(r.totals.pieces, 0);
  assert.equal(r.utilization.powerOnPct, null);
  assert.deepEqual(r.bySize, []);
});
