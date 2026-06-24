import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rupee, fmt, prettyYmd, whenStr } from './format.js';

test('rupee rounds and uses ₹ + en-IN grouping', () => {
  assert.equal(rupee(1234.6), '₹1,235');
  assert.equal(rupee(0), '₹0');
  assert.equal(rupee(null), '₹0');
});
test('fmt handles null and groups', () => {
  assert.equal(fmt(null), '-');
  assert.equal(fmt(13430), '13,430');
});
test('prettyYmd reformats YYYYMMDD', () => {
  assert.equal(prettyYmd('20260624'), '24-06-2026');
});
test('whenStr formats a BOCHU datetime', () => {
  assert.equal(whenStr('2026-06-21 19:58:06'), '21 Jun · 19:58');
  assert.equal(whenStr(''), '');
});
