import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodUtil, stateLabel } from './util.js';

test('periodUtil: powered-on % and cutting % over the days that have timeline data', () => {
  const days = [
    { runningH: 12, workH: 6, offlineH: 12, alarmCount: 1, alarmPeriodH: 0.1 },
    { runningH: 12, workH: 6, offlineH: 12, alarmCount: 0, alarmPeriodH: 0 },
  ];
  const u = periodUtil(days);
  assert.equal(u.nDays, 2);
  assert.equal(u.runningH, 24);
  assert.equal(u.workH, 12);
  assert.equal(u.offlineH, 24);
  assert.equal(u.idleH, 12);          // running 24 - work 12
  assert.equal(u.alarmCount, 1);
  assert.equal(u.powerOnPct, 50);     // 24 / (2*24) * 100
  assert.equal(u.workUtilPct, 50);    // 12 / 24 * 100
});

test('periodUtil: ignores days without timeline (runningH null) ', () => {
  const u = periodUtil([{ runningH: 8, workH: 4, offlineH: 16 }, { pieces: 100 }, {}]);
  assert.equal(u.nDays, 1);
  assert.equal(u.runningH, 8);
  assert.equal(u.powerOnPct, +(8 / 24 * 100).toFixed(1));
});

test('periodUtil: empty / no-timeline input -> zeros, no divide-by-zero', () => {
  const u = periodUtil([]);
  assert.equal(u.nDays, 0);
  assert.equal(u.powerOnPct, 0);
  assert.equal(u.workUtilPct, 0);
});

test('stateLabel maps device states to friendly text', () => {
  assert.equal(stateLabel('RUNNING').text, 'Running');
  assert.equal(stateLabel('OFFLINE').text, 'Offline');
  assert.equal(stateLabel('').text, 'Unknown');
  assert.equal(stateLabel(undefined).text, 'Unknown');
});
