import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSize, enrichJobs, groupBySize, unlabelledFiles } from './sizemap.js';

test('deriveSize keeps a clean upstream size', () => {
  assert.deepEqual(deriveSize({ file: 'x.zzx', sizeKey: '30x20 t1.2', hasSize: true }),
    { sizeKey: '30x20 t1.2', hasSize: true });
});
test('deriveSize: AxBxLength -> section AxB + thickness', () => {
  assert.deepEqual(deriveSize({ file: '31.75x35x6000.zzx', thickness: 3 }),
    { sizeKey: '31.75x35 t3', hasSize: true });
});
test('deriveSize: Qty x Length x section -> round R{section}', () => {
  assert.deepEqual(deriveSize({ file: '858x6010x31.75.zzx', thickness: 1.2 }),
    { sizeKey: 'R31.75 t1.2', hasSize: true });
});
test('deriveSize: sheet AxB (both >=500) keeps AxB', () => {
  assert.deepEqual(deriveSize({ file: '1200x500step.zzx' }),
    { sizeKey: '1200x500', hasSize: true });
});
test('deriveSize: single number -> round', () => {
  assert.deepEqual(deriveSize({ file: '30.59.zzx', thickness: 1.2 }),
    { sizeKey: 'R30.59 t1.2', hasSize: true });
});
test('deriveSize: 2-number name stays AxB even when one is large', () => {
  assert.deepEqual(deriveSize({ file: '1900x400step.zzx', thickness: 1 }),
    { sizeKey: '1900x400 t1', hasSize: true });
});
test('deriveSize: lone number wrapped in words stays Unlabelled', () => {
  assert.deepEqual(deriveSize({ file: '17 set barstool.zzx' }),
    { sizeKey: '17 set barstool', hasSize: false });
});
test('deriveSize: pure name -> unlabelled', () => {
  assert.deepEqual(deriveSize({ file: 'bhawani.zzx' }), { sizeKey: 'bhawani', hasSize: false });
  assert.deepEqual(deriveSize({ file: 'ss.zzx' }), { sizeKey: 'ss', hasSize: false });
});

const jobs = [
  { file: 'a.zzx', sizeKey: '30x20 t1.2', hasSize: true, partAmount: 100, timeTaken: 60 },
  { file: 'bhawani.zzx', hasSize: false, partAmount: 50, timeTaken: 120 },
  { file: 'bhawani.zzx', hasSize: false, partAmount: 30, timeTaken: 60 },
  { file: '858x6010x31.75.zzx', thickness: 1.2, hasSize: false, partAmount: 90, timeTaken: 90 },
];

test('enrichJobs derives sizes; map override wins', () => {
  const out = enrichJobs(jobs, { 'bhawani.zzx': { sizeKey: '40x40 t2' } });
  assert.ok(out.filter(j => j.file === 'bhawani.zzx').every(j => j.sizeKey === '40x40 t2' && j.hasSize));
  assert.equal(out.find(j => j.file === '858x6010x31.75.zzx').sizeKey, 'R31.75 t1.2'); // derived
});
test('groupBySize collapses only truly unlabelled, forced last', () => {
  const rows = groupBySize(enrichJobs(jobs, {})); // no map: bhawani stays unlabelled
  const unl = rows.find(r => r.unlabelled);
  assert.equal(unl.pieces, 80); // both bhawani runs
  assert.equal(rows[rows.length - 1].unlabelled, true);
  assert.ok(rows.some(r => r.sizeKey === 'R31.75 t1.2')); // derived size present, not in Unlabelled
});
test('unlabelledFiles lists only still-nameless files', () => {
  const f = unlabelledFiles(enrichJobs(jobs, {}));
  assert.equal(f.length, 1);
  assert.equal(f[0].file, 'bhawani.zzx');
  assert.equal(f[0].pieces, 80);
});
