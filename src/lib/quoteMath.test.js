import { test } from 'node:test'
const round = (v) => Math.round(v * 100) / 100
import assert from 'node:assert/strict'
import { computeLine, computeQuote, materialBasisNote, nearestSecPerPiece, normalizeSection } from './quoteMath.js'

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

test('job work: customer material drops out of price AND cost, and stops needing a rate', () => {
  const base = { name: 'Leg', section: '40x20', thickness: 1.2, length: 500, qty: 10, secPerPiece: 10,
    wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 25 }
  const supplied = computeLine({ ...base, pipeRate: 80 })
  const jobWork = computeLine({ ...base, pipeRate: 0, materialByCustomer: true })

  assert.equal(jobWork.valid, true, 'no material rate needed when the customer supplies tube')
  assert.equal(jobWork.materialPerPc, 0)
  assert.equal(jobWork.pricePerPc, jobWork.cuttingPerPc)
  assert.equal(jobWork.costPerPc, jobWork.cutCostPerPc, 'material must leave the cost too')
  assert.ok(jobWork.margin > 0, 'job work must not report a phantom loss')
  // weight still computed — the customer needs to know how much tube to send
  assert.ok(jobWork.billedWeightKg > 0)
  assert.equal(jobWork.billedWeightKg, supplied.billedWeightKg)
})

test('a missing material rate still blocks a normal supply line', () => {
  const line = computeLine({ name: 'Leg', section: '40x20', thickness: 1.2, length: 500, qty: 10,
    secPerPiece: 10, cutRatePerMin: 40, pipeRate: 0 })
  assert.equal(line.valid, false)
  assert.ok(line.issues.includes('Material rate'))
})

test('per-line material choice overrides the quote-level default in both directions', () => {
  const parts = [
    { name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 10, secPerPiece: 10 },
    { name: 'B', section: '40x20', thickness: 1.2, length: 500, qty: 10, secPerPiece: 10, materialBy: 'unico' },
  ]
  const opts = { pipeRate: 80, wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 25 }

  const jobWorkQuote = computeQuote(parts, 18, { ...opts, materialByCustomer: true })
  assert.equal(jobWorkQuote.lines[0].materialByCustomer, true, 'inherits the quote default')
  assert.equal(jobWorkQuote.lines[1].materialByCustomer, false, 'line override wins')
  assert.equal(jobWorkQuote.materialBasis, 'mixed')
  assert.equal(jobWorkQuote.customerMaterialLines, 1)

  const supplyQuote = computeQuote(
    [{ ...parts[0], materialBy: 'customer' }, parts[0]], 18, { ...opts, materialByCustomer: false })
  assert.equal(supplyQuote.lines[0].materialByCustomer, true, 'line can opt out under a supply quote')
  assert.equal(supplyQuote.lines[1].materialByCustomer, false)
  assert.equal(supplyQuote.materialBasis, 'mixed')
})

test('materialBasis names an all-job-work and an all-supply quote', () => {
  const part = { name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 10, secPerPiece: 10 }
  const opts = { pipeRate: 80, wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 25 }
  assert.equal(computeQuote([part], 18, opts).materialBasis, 'unico')
  assert.equal(computeQuote([part], 18, { ...opts, materialByCustomer: true }).materialBasis, 'customer')
  assert.equal(computeQuote([], 18, opts).materialBasis, 'unico', 'empty quote is not job work')
})

test('a stale materialByCustomer on a re-opened line cannot outrank the screen', () => {
  const opts = { pipeRate: 80, wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 25 }
  const stale = { name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 10, secPerPiece: 10,
    materialByCustomer: true }
  const quote = computeQuote([stale], 18, opts)
  assert.equal(quote.lines[0].materialByCustomer, false)
  assert.ok(quote.lines[0].materialPerPc > 0)
})

test('materialBasisNote states the basis on job-work and mixed quotes, and stays silent on full supply', () => {
  assert.match(materialBasisNote('customer'), /Cutting charges only/i)
  assert.match(materialBasisNote('customer'), /material supplied by customer/i)
  assert.match(materialBasisNote('mixed'), /by customer/i)
  assert.equal(materialBasisNote('unico'), '')
  assert.equal(materialBasisNote(undefined), '')
})

test('setup & loading uplift bills more than raw machine-on time', () => {
  const base = { name: 'Leg', section: '40x20', thickness: 1.2, length: 500, qty: 100,
    secPerPiece: 10, pipeRate: 80, wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 25 }
  const raw = computeLine(base)
  const loaded = computeLine({ ...base, setupLoadPct: 50 })

  assert.equal(loaded.billedSecPerPiece, 15)
  assert.equal(round(loaded.cuttingPerPc), round(raw.cuttingPerPc * 1.5))
  // the machine is genuinely occupied for that time, so cost rises with it
  assert.equal(round(loaded.cutCostPerPc), round(raw.cutCostPerPc * 1.5))
  // material is untouched by a time uplift
  assert.equal(loaded.materialPerPc, raw.materialPerPc)
})

test('uplift never inflates a manually typed cutting price, but still loads the cost', () => {
  const base = { name: 'Leg', section: '40x20', thickness: 1.2, length: 500, qty: 100,
    secPerPiece: 10, pipeRate: 80, cutRatePerMin: 40, cutCostPerMin: 25, cutPricePerPiece: 9 }
  const loaded = computeLine({ ...base, setupLoadPct: 50 })
  assert.equal(loaded.cuttingPerPc, 9, 'a typed price is the final price')
  assert.equal(round(loaded.cutCostPerPc), round((15 / 60) * 25))
})

test('zero or missing uplift keeps the old raw-cut-time behaviour', () => {
  const base = { name: 'Leg', section: '40x20', thickness: 1.2, length: 500, qty: 100,
    secPerPiece: 10, pipeRate: 80, cutRatePerMin: 40, cutCostPerMin: 25 }
  const none = computeLine(base)
  const zero = computeLine({ ...base, setupLoadPct: 0 })
  assert.equal(none.billedSecPerPiece, 10)
  assert.equal(zero.cuttingPerPc, none.cuttingPerPc)
  assert.equal(zero.cutCostPerPc, none.cutCostPerPc)
})

test('uplift flows from quote defaults into every line and lifts the total', () => {
  const part = { name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 100, secPerPiece: 10 }
  const opts = { pipeRate: 80, wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 25 }
  const plain = computeQuote([part], 18, opts)
  const loaded = computeQuote([part], 18, { ...opts, setupLoadPct: 50 })
  assert.equal(loaded.lines[0].setupLoadPct, 50)
  assert.ok(loaded.subtotal > plain.subtotal)
  // cutting-only quote: the whole price is cut time, so a 50% uplift is a 50% bigger bill
  const jobPlain = computeQuote([part], 18, { ...opts, materialByCustomer: true })
  const jobLoaded = computeQuote([part], 18, { ...opts, materialByCustomer: true, setupLoadPct: 50 })
  assert.equal(round(jobLoaded.subtotal), round(jobPlain.subtotal * 1.5))
})

test('per-order setup is spread over the quantity, so small orders stop being underquoted', () => {
  const base = { name: 'Leg', section: '40x20', thickness: 1.2, length: 500, secPerPiece: 10,
    pipeRate: 80, cutRatePerMin: 40, cutCostPerMin: 25, dimensionChangeMin: 40, setupType: 'dimension' }
  const small = computeLine({ ...base, qty: 20 })
  const big = computeLine({ ...base, qty: 1000 })

  // 40 min x Rs40/min = Rs1,600 of setup, however many pieces
  assert.equal(round(small.setupPerPc * small.qty), 1600)
  assert.equal(round(big.setupPerPc * big.qty), 1600)
  // which is Rs80/pc on 20 pieces but only Rs1.60 on 1000 - the whole point
  assert.equal(round(small.setupPerPc), 80)
  assert.equal(round(big.setupPerPc), 1.6)
  assert.ok(small.pricePerPc > big.pricePerPc)
  // and it lands in the cost too, so margin stays honest
  assert.equal(round(small.setupCostPerPc), round(40 * 25 / 20))
})

test('setup type picks the right minutes and a new part adds programming once', () => {
  const base = { name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 100, secPerPiece: 10,
    pipeRate: 80, cutRatePerMin: 40, dimensionChangeMin: 40, lengthChangeMin: 1, programmingMin: 25 }
  assert.equal(computeLine({ ...base, setupType: 'dimension' }).setupMin, 40)
  assert.equal(computeLine({ ...base, setupType: 'length' }).setupMin, 1)
  assert.equal(computeLine({ ...base, setupType: 'none' }).setupMin, 0)
  assert.equal(computeLine({ ...base, setupType: 'dimension', newPart: true }).setupMin, 65)
  assert.equal(computeLine({ ...base, setupType: 'none', newPart: true }).setupMin, 25)
})

test('a line with no setupType carries no setup, so old saved quotes never inflate', () => {
  const line = computeLine({ name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 10,
    secPerPiece: 10, pipeRate: 80, cutRatePerMin: 40, dimensionChangeMin: 40 })
  assert.equal(line.setupMin, 0)
  assert.equal(line.setupPerPc, 0)
  assert.equal(line.setupType, 'none')
})

test('setup never divides by zero on a quantity-less line', () => {
  const line = computeLine({ name: 'A', section: '40x20', thickness: 1.2, length: 500, qty: 0,
    secPerPiece: 10, pipeRate: 80, cutRatePerMin: 40, setupType: 'dimension', dimensionChangeMin: 40 })
  assert.equal(line.setupPerPc, 0)
  assert.ok(Number.isFinite(line.pricePerPc))
  assert.equal(line.valid, false)
})

test('a mixed quote round-trips: the per-line material override survives save and reopen', () => {
  const opts = { pipeRate: 80, wastagePct: 5, density: 7.85, cutRatePerMin: 40, cutCostPerMin: 29.62 }
  const drafted = [
    { name: 'Inherits', section: '40x20', thickness: 1.2, length: 500, qty: 100, secPerPiece: 10 },
    { name: 'Overrides', section: '40x20', thickness: 1.2, length: 500, qty: 100, secPerPiece: 10, materialBy: 'unico' },
  ]
  // what the app saves is computeQuote's lines, so the raw choice must survive computeLine
  const saved = computeQuote(drafted, 18, { ...opts, materialByCustomer: true })
  assert.equal(saved.lines[1].materialBy, 'unico', 'the override must be persisted, not just resolved')
  assert.equal(saved.materialBasis, 'mixed')

  // reopening feeds those saved lines back in with the quote's own saved basis
  const reopened = computeQuote(saved.lines, 18, { ...opts, materialByCustomer: true })
  assert.equal(reopened.lines[0].materialByCustomer, true)
  assert.equal(reopened.lines[1].materialByCustomer, false, 'the overridden line must not flip to job work')
  assert.equal(round(reopened.subtotal), round(saved.subtotal), 'a reopened quote must reprice identically')
})
