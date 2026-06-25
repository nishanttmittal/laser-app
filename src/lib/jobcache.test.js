import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutoffYmd, needFullRead, mergeJobs, RECONCILE_DAYS } from './jobcache.js';

test('cutoffYmd returns YYYYMMDD string N days back', () => {
  assert.equal(cutoffYmd(new Date(2026, 5, 24), 35), '20260520'); // 24 Jun - 35d = 20 May
  assert.equal(cutoffYmd(new Date(2026, 0, 5), 10), '20251226');  // crosses year boundary
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
