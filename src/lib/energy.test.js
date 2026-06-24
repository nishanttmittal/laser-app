import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kWhCost, energyPer1000 } from './energy.js';

test('kWhCost multiplies by rate (default 14)', () => {
  assert.equal(kWhCost(127.94), +(127.94 * 14).toFixed(2));
  assert.equal(kWhCost(100, 12), 1200);
  assert.equal(kWhCost(0), 0);
});
test('energyPer1000 normalises per 1000 pieces, null on zero', () => {
  assert.equal(energyPer1000(128, 6172), +(128 / 6172 * 1000).toFixed(2));
  assert.equal(energyPer1000(10, 0), null);
});
