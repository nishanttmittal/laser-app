import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utilSummary, stateLabel } from './util.js';

test('utilSummary sums fields and computes honest laser-util %', () => {
  const days = [
    { laserOnH: 1.9, idleTimeH: 4.62, processingH: 3.08, activeH: 6.52, alarmTimeMin: 0.1, gasOnH: 2.59 },
    { laserOnH: 0.1, idleTimeH: 4.25, processingH: 0.03, activeH: 4.35, alarmTimeMin: 0.2, gasOnH: 0.02 },
  ];
  const s = utilSummary(days);
  assert.equal(s.laserOnH, 2.0);
  assert.equal(s.idleH, 8.87);
  assert.equal(s.activeH, 10.87);
  assert.equal(s.alarmMin, 0.3);
  assert.equal(s.laserUtilPct, +(2.0 / 10.87 * 100).toFixed(1));
});
test('utilSummary tolerates missing fields (pre-Phase-2 docs) -> zeros', () => {
  const s = utilSummary([{ laserOnH: 1 }, {}]);
  assert.equal(s.laserOnH, 1);
  assert.equal(s.idleH, 0);
  assert.equal(s.laserUtilPct, 0); // activeH 0 -> guard
});
test('stateLabel maps device states to friendly text', () => {
  assert.equal(stateLabel('RUNNING').text, 'Running');
  assert.equal(stateLabel('OFFLINE').text, 'Offline');
  assert.equal(stateLabel('').text, 'Unknown');
  assert.equal(stateLabel(undefined).text, 'Unknown');
});
