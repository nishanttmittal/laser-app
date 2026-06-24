import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ymd, lastCompleteDay, periodRange, filterDaysByRange, monthRollup } from './period.js';

const days = [
  { statDate: 20260621, pieces: 1971, runs: 31, cutTimeH: 4.19, laserOnH: 2.45, cutLengthM: 1194, kWh: 100 },
  { statDate: 20260622, pieces: 13430, runs: 87, cutTimeH: 6.79, laserOnH: 4.16, cutLengthM: 1966, kWh: 128 },
  { statDate: 20260624, pieces: 7, runs: 2, cutTimeH: 0.03, laserOnH: 0.01, cutLengthM: 4.7, kWh: 1 },
  { statDate: 20260501, pieces: 500, runs: 5, cutTimeH: 1, laserOnH: 0.5, cutLengthM: 100, kWh: 20 },
];

test('ymd builds YYYYMMDD from a Date', () => {
  assert.equal(ymd(new Date(2026, 5, 24)), 20260624); // month is 0-based
});
test('lastCompleteDay skips today and zero-piece days', () => {
  assert.equal(lastCompleteDay(days, 20260624).statDate, 20260622);
});
test('periodRange month covers the calendar month of today', () => {
  assert.deepEqual(periodRange('month', 20260624), { from: 20260601, to: 20260630 });
});
test('periodRange lastMonth covers previous calendar month', () => {
  assert.deepEqual(periodRange('lastMonth', 20260624), { from: 20260501, to: 20260531 });
});
test('periodRange custom passes bounds through', () => {
  assert.deepEqual(periodRange('custom', 20260624, { from: 20260610, to: 20260620 }), { from: 20260610, to: 20260620 });
});
test('filterDaysByRange is inclusive', () => {
  const r = filterDaysByRange(days, { from: 20260601, to: 20260630 });
  assert.deepEqual(r.map(d => d.statDate).sort(), [20260621, 20260622, 20260624]);
});
test('monthRollup groups by year-month and sums', () => {
  const r = monthRollup(days);
  const jun = r.find(m => m.ym === '2026-06');
  assert.equal(jun.pieces, 1971 + 13430 + 7);
  assert.equal(jun.runs, 31 + 87 + 2);
  assert.equal(r[0].ym, '2026-05'); // ascending
});
