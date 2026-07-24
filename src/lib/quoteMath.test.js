import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLine, computeQuote, nearestSecPerPiece, normalizeSection } from './quoteMath.js'

test('normalizeSection accepts round and rectangular owner input', () => {
  assert.equal(normalizeSection('OD 50'), 'R50')
  assert.equal(normalizeSection('40 X 20'), '40x20')
  assert.equal(normalizeSection('R38.25'), 'R38.25')
})

test('computeLine combines wastage-adjusted material and cutting price', () => {
  const line = computeLine({
    name: 'Chair leg',
    section: '40x20',
    thickness: 1.2,
    length: 600,
    qty: 100,
    density: 7.85,
    pipeRate: 80,
    wastagePct: 5,
    secPerPiece: 12,
    cutRatePerMin: 40,
    cutCostPerMin: 25,
  })

  assert.equal(line.valid, true)
  assert.ok(line.baseWeightKg > 0)
  assert.ok(Math.abs(line.billedWeightKg - line.baseWeightKg * 1.05) < 1e-9)
  assert.equal(line.cuttingPerPc, 8)
  assert.equal(line.cutCostPerPc, 5)
  assert.ok(line.pricePerPc > line.costPerPc)
  assert.ok(Math.abs(line.amount - line.pricePerPc * 100) < 1e-9)
})

test('manual cutting price overrides time-based selling price but keeps internal cost', () => {
  const line = computeLine({
    name: 'Rail', section: 'R50', thickness: 2, length: 1000, qty: 10,
    pipeRate: 80, wastagePct: 0, secPerPiece: 60, cutRatePerMin: 40,
    cutCostPerMin: 20, cutPricePerPiece: 75,
  })
  assert.equal(line.cuttingPerPc, 75)
  assert.equal(line.cutCostPerPc, 20)
})

test('manual cutting price without cutting time does not invent an internal margin', () => {
  const line = computeLine({
    name: 'New part', section: 'R50', thickness: 2, length: 1000, qty: 10,
    pipeRate: 80, wastagePct: 0, cutRatePerMin: 40,
    cutCostPerMin: 20, cutPricePerPiece: 75,
  })
  const quote = computeQuote([line], 18)
  assert.equal(line.valid, true)
  assert.equal(line.costKnown, false)
  assert.equal(line.estimatedCost, null)
  assert.equal(quote.estimatedMargin, null)
})

test('computeQuote totals lines and GST without taxing the internal cost', () => {
  const quote = computeQuote([
    { name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 10, secPerPiece: 10 },
    { name: 'B', section: 'R50', thickness: 2, length: 800, qty: 5, secPerPiece: 20 },
  ], 18, { pipeRate: 80, wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 25 })

  assert.equal(quote.valid, true)
  assert.equal(quote.gst, Math.round(quote.subtotal * 0.18 * 100) / 100)
  assert.equal(quote.total, quote.subtotal + quote.gst)
  assert.ok(quote.estimatedMargin > 0)
})

test('invalid lines report missing commercial inputs', () => {
  const line = computeLine({ name: '', section: '', qty: 0 })
  assert.equal(line.valid, false)
  assert.ok(line.issues.includes('Part name'))
  assert.ok(line.issues.includes('Quantity'))
})

test('nearestSecPerPiece prefers exact size and rejects distant profiles', () => {
  const sizes = [
    { sizeKey: '40x20 t1.2', secPerPiece: 12 },
    { sizeKey: '50x25 t1.5', secPerPiece: 18 },
    { sizeKey: 'R38.25 t1.5', secPerPiece: 8 },
  ]
  assert.deepEqual(nearestSecPerPiece('20x40', 1.2, sizes), {
    sizeKey: '40x20 t1.2', secPerPiece: 12, score: 0, confidence: 'exact',
  })
  assert.equal(nearestSecPerPiece('R100', 5, sizes), null)
})
