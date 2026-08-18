import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutoffFromYmd, cutoffYmd, needFullRead, jobsAfterRead, mergeJobs, RECONCILE_DAYS } from './jobcache.js';

test('cutoffYmd returns YYYYMMDD string N days back', () => {
  assert.equal(cutoffYmd(new Date(2026, 5, 24), 35), '20260520'); // 24 Jun - 35d = 20 May
  assert.equal(cutoffYmd(new Date(2026, 0, 5), 10), '20251226');  // crosses year boundary
});

test('cutoffFromYmd is calendar-safe and crosses month/year boundaries', () => {
  assert.equal(cutoffFromYmd(20260724, 35), '20260619');
  assert.equal(cutoffFromYmd('2026-01-05', 10), '20251226');
});

test('needFullRead: true when no cache/meta or no lastFullAt', () => {
  assert.equal(needFullRead(null, Date.now()), true);
  assert.equal(needFullRead({}, Date.now()), true);
});

test('needFullRead: false within reconcile window, true after', () => {
  const now = Date.now();
  assert.equal(needFullRead({ lastFullAt: now - 3 * 86400000 }, now), false);
  assert.equal(needFullRead({ lastFullAt: now - (RECONCILE_DAYS + 1) * 86400000 }, now), true);
});

test('mergeJobs: fresh wins, new added, dedupe by workUuid', () => {
  const cache = [{ workUuid: 'a', pieces: 1 }, { workUuid: 'b', pieces: 2 }];
  const fresh = [{ workUuid: 'b', pieces: 99 }, { workUuid: 'c', pieces: 3 }];
  const out = mergeJobs(cache, fresh);
  assert.equal(out.length, 3);
  assert.equal(out.find((j) => j.workUuid === 'b').pieces, 99); // fresh overrides
  assert.ok(out.find((j) => j.workUuid === 'c'));
});

test('mergeJobs: ignores entries without workUuid; handles empty', () => {
  assert.deepEqual(mergeJobs(null, null), []);
  assert.equal(mergeJobs([{ x: 1 }], [{ workUuid: 'a' }]).length, 1);
});

test('a full reconcile drops jobs deleted upstream; a light refresh keeps older history', () => {
  const cache = [{ workUuid: 'old' }, { workUuid: 'deleted-upstream' }];
  const recent = [{ workUuid: 'fresh' }];
  const all = [{ workUuid: 'old' }, { workUuid: 'fresh' }];

  // FULL: the server set wins outright — 'deleted-upstream' must not survive, or the
  // 10-day reconcile never reconciles and the device carries phantom runs for ever.
  const full = jobsAfterRead({ cache, recent, all }).map((j) => j.workUuid).sort();
  assert.deepEqual(full, ['fresh', 'old']);

  // LIGHT: only the 35-day window was read, so cached history must be kept.
  const light = jobsAfterRead({ cache, recent }).map((j) => j.workUuid).sort();
  assert.deepEqual(light, ['deleted-upstream', 'fresh', 'old']);
});
