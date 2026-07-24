import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readLargeCache, writeLargeCache } from './largeCache.js'

test('readLargeCache uses the fallback when IndexedDB is unavailable', async () => {
  let reads = 0
  const value = await readLargeCache('jobs', () => { reads++; return [{ workUuid: 'a' }] })
  assert.deepEqual(value, [{ workUuid: 'a' }])
  assert.equal(reads, 1)
})

test('writeLargeCache uses the fallback when IndexedDB is unavailable', async () => {
  let saved
  const backend = await writeLargeCache('jobs', [{ workUuid: 'a' }], (value) => { saved = value })
  assert.equal(backend, 'fallback')
  assert.deepEqual(saved, [{ workUuid: 'a' }])
})
