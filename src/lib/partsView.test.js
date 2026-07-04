import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildParts, daysWithJobs } from './partsView.js'

// ---- helpers ----
const job = (overrides) => ({
  file: 'default.zzx',
  sizeKey: '30x20 t1.2',
  hasSize: true,
  day: '20260702',
  partAmount: 10,
  timeTaken: 100,
  aborted: false,
  section: '30x20',
  thickness: 1.2,
  length: 6000,
  portionName: '',
  parts: [],
  catPhoto: '',
  ...overrides,
})

// ---- daysWithJobs ----
test('daysWithJobs: empty input -> []', () => {
  assert.deepEqual(daysWithJobs([]), [])
  assert.deepEqual(daysWithJobs(null), [])
})

test('daysWithJobs: distinct days sorted desc', () => {
  const jobs = [
    job({ day: '20260702' }),
    job({ day: '20260701' }),
    job({ day: '20260702' }), // dupe
  ]
  const days = daysWithJobs(jobs)
  assert.deepEqual(days, ['20260702', '20260701'])
})

// ---- empty input / no matching day ----
test('buildParts: null jobs -> []', () => {
  assert.deepEqual(buildParts(null, { day: '20260702' }), [])
})

test('buildParts: empty jobs -> []', () => {
  assert.deepEqual(buildParts([], { day: '20260702' }), [])
})

test('buildParts: no jobs on requested day -> []', () => {
  const jobs = [job({ day: '20260701' })]
  assert.deepEqual(buildParts(jobs, { day: '20260702' }), [])
})

// ---- day filter ----
test('buildParts: day filter — only the requested day is included', () => {
  const jobs = [
    job({ file: 'a.zzx', day: '20260702', partAmount: 5 }),
    job({ file: 'a.zzx', day: '20260701', partAmount: 99 }),
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards.length, 1)
  assert.equal(cards[0].pieces, 5)
})

// ---- collision guard (same sizeKey, different files -> different cards) ----
test('buildParts: same sizeKey but different files stay as separate cards', () => {
  const jobs = [
    job({ file: 'file_A.zzx', sizeKey: '30x20 t1.2', partAmount: 50 }),
    job({ file: 'file_B.zzx', sizeKey: '30x20 t1.2', partAmount: 30 }),
    job({ file: 'file_C.zzx', sizeKey: '30x20 t1.2', partAmount: 20 }),
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards.length, 3, '3 files with same sizeKey must produce 3 separate cards')
  // Verify each card has its expected piece count
  const pcs = cards.map((c) => c.pieces).sort((a, b) => b - a)
  assert.deepEqual(pcs, [50, 30, 20])
})

// ---- same file+size across multiple runs -> one card ----
test('buildParts: same file+sizeKey across 2 runs -> 1 card with combined pieces and runs=2', () => {
  const jobs = [
    job({ file: 'leg.zzx', sizeKey: '30x20 t1.2', partAmount: 40, timeTaken: 400 }),
    job({ file: 'leg.zzx', sizeKey: '30x20 t1.2', partAmount: 60, timeTaken: 600 }),
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards.length, 1)
  assert.equal(cards[0].pieces, 100)
  assert.equal(cards[0].runs, 2)
  assert.equal(cards[0].totalSec, 1000)
})

// ---- label fallback chain ----
test('buildParts: label fallback — portionName wins when present', () => {
  const jobs = [job({ portionName: 'Chair leg', parts: [{ name: 'partname', amount: 5 }], file: 'f.zzx' })]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards[0].label, 'Chair leg')
})

test('buildParts: label fallback — parts[0].name when portionName blank', () => {
  const jobs = [job({ portionName: '', parts: [{ name: 'Top rail', amount: 5 }], file: 'f.zzx' })]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards[0].label, 'Top rail')
})

test('buildParts: label fallback — file basename when portionName and parts blank', () => {
  const jobs = [job({ portionName: '', parts: [], file: 'some_part.zzx' })]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards[0].label, 'some_part.zzx')
})

test('buildParts: label fallback — sizeKey when file is also blank', () => {
  const jobs = [job({ portionName: '', parts: [], file: '', sizeKey: '40x40 t2' })]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards[0].label, '40x40 t2')
})

// ---- aborted / 0-qty runs excluded from secPerPiece / pcsPerMin ----
test('buildParts: aborted and 0-qty runs excluded from secPerPiece/pcsPerMin but counted in pieces/runs', () => {
  const jobs = [
    // good run: 10 pcs, 100s -> 10 s/pc
    job({ file: 'x.zzx', partAmount: 10, timeTaken: 100, aborted: false }),
    // aborted run: 0 pcs, 500s -> must not inflate s/pc
    job({ file: 'x.zzx', partAmount: 0, timeTaken: 500, aborted: true }),
    // 0-qty non-aborted: still excluded from good-run calc
    job({ file: 'x.zzx', partAmount: 0, timeTaken: 60, aborted: false }),
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards.length, 1)
  const c = cards[0]
  // runs includes all 3; pieces includes the aborted 0-qty (which is 0)
  assert.equal(c.runs, 3)
  assert.equal(c.pieces, 10)
  // goodSec = 100 (only the first run), goodPieces = 10
  assert.equal(c.secPerPiece, 10)                                   // 100/10
  // pcsPerMin: total pieces / (goodSec/60) = 10 / (100/60) = 6
  assert.ok(Math.abs(c.pcsPerMin - 6) < 0.001)
  assert.equal(c.aborted, true) // flagged because at least one run aborted
})

test('buildParts: all-aborted group -> secPerPiece=0, pcsPerMin=0, no crash', () => {
  const jobs = [
    job({ file: 'y.zzx', partAmount: 0, timeTaken: 300, aborted: true }),
    job({ file: 'y.zzx', partAmount: 0, timeTaken: 200, aborted: true }),
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards.length, 1)
  const c = cards[0]
  assert.equal(c.secPerPiece, 0)
  assert.equal(c.pcsPerMin, 0)
  assert.equal(c.pieces, 0)
})

test('buildParts: aborted run WITH pieces -> secPerPiece and pcsPerMin reconcile (same good-run basis)', () => {
  const jobs = [
    job({ file: 'z.zzx', partAmount: 10, timeTaken: 100, aborted: false }), // good: 10 pcs / 100s
    job({ file: 'z.zzx', partAmount: 5, timeTaken: 50, aborted: true }),    // aborted but has pieces -> excluded from rate
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  const c = cards[0]
  assert.equal(c.pieces, 15)          // both runs counted in total pieces
  assert.equal(c.secPerPiece, 10)     // good-run only: 100/10
  // the two speed metrics must agree: pcsPerMin ≈ 60 / secPerPiece
  assert.ok(Math.abs(c.pcsPerMin - 60 / c.secPerPiece) < 0.001)
  assert.ok(Math.abs(c.pcsPerMin - 6) < 0.001)
})

// ---- sort order ----
test('buildParts: sorted by pieces desc', () => {
  const jobs = [
    job({ file: 'small.zzx', sizeKey: '20x20 t1', partAmount: 10 }),
    job({ file: 'big.zzx', sizeKey: '40x40 t2', partAmount: 100 }),
    job({ file: 'mid.zzx', sizeKey: '30x30 t1.5', partAmount: 50 }),
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards[0].pieces, 100)
  assert.equal(cards[1].pieces, 50)
  assert.equal(cards[2].pieces, 10)
})

// ---- catPhoto: first non-empty wins ----
test('buildParts: catPhoto carried through — first non-empty in group', () => {
  const jobs = [
    job({ file: 'a.zzx', catPhoto: '' }),
    job({ file: 'a.zzx', catPhoto: 'data:img/photo' }),
    job({ file: 'a.zzx', catPhoto: 'data:img/other' }),
  ]
  const cards = buildParts(jobs, { day: '20260702' })
  assert.equal(cards[0].catPhoto, 'data:img/photo')
})
