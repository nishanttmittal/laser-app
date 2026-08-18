import { tubeWeightGrams } from './costing.js'

const num = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const round2 = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100

export function normalizeSection(value) {
  const text = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!text) return ''
  const round = text.match(/^(?:R|OD|Ø|DIA)?(\d+(?:\.\d+)?)$/)
  if (round) return `R${Number(round[1])}`
  const rect = text.match(/^(\d+(?:\.\d+)?)[X×*](\d+(?:\.\d+)?)$/)
  if (rect) return `${Number(rect[1])}x${Number(rect[2])}`
  return text
}

function profile(value) {
  const section = normalizeSection(value)
  const round = section.match(/^R(\d+(?:\.\d+)?)$/)
  if (round) return { shape: 'round', dims: [+round[1]] }
  const rect = section.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i)
  if (rect) return { shape: 'rect', dims: [+rect[1], +rect[2]].sort((a, b) => a - b) }
  return null
}

function sizeParts(size) {
  const key = String(size?.sizeKey || size?.section || '')
  const thicknessMatch = key.match(/\bt(?:hickness)?\s*(\d+(?:\.\d+)?)/i)
  const section = normalizeSection(size?.section || key.replace(/\bt(?:hickness)?\s*\d+(?:\.\d+)?.*$/i, '').trim())
  return {
    section,
    thickness: num(size?.thickness, thicknessMatch ? +thicknessMatch[1] : 0),
  }
}

export function nearestSecPerPiece(section, thickness, sizes) {
  const wantedSection = normalizeSection(section)
  const wanted = profile(wantedSection)
  const wantedThickness = num(thickness)
  if (!wanted || !(wantedThickness > 0)) return null

  let best = null
  for (const size of sizes || []) {
    if (!(num(size?.secPerPiece) > 0)) continue
    const candidate = sizeParts(size)
    const parsed = profile(candidate.section)
    if (!parsed || parsed.shape !== wanted.shape || parsed.dims.length !== wanted.dims.length) continue

    const dimScore = wanted.dims.reduce((sum, dim, index) =>
      sum + Math.abs(dim - parsed.dims[index]) / Math.max(dim, 1), 0) / wanted.dims.length
    const thicknessScore = candidate.thickness > 0
      ? Math.abs(wantedThickness - candidate.thickness) / wantedThickness
      : 1
    const score = dimScore * 0.75 + thicknessScore * 0.25

    if (!best || score < best.score) {
      best = {
        sizeKey: size.sizeKey,
        secPerPiece: num(size.secPerPiece),
        score,
        confidence: score < 0.001 ? 'exact' : 'nearest',
      }
    }
  }

  return best && best.score <= 0.35 ? best : null
}

export function computeLine(input = {}) {
  const section = normalizeSection(input.section)
  const thickness = num(input.thickness)
  const length = num(input.length)
  const qty = Math.max(0, num(input.qty))
  const density = num(input.density, 7.85)
  const pipeRate = Math.max(0, num(input.pipeRate))
  const wastagePct = Math.max(0, num(input.wastagePct))
  const secPerPiece = Math.max(0, num(input.secPerPiece))
  const cutRatePerMin = Math.max(0, num(input.cutRatePerMin))
  const cutCostPerMin = Math.max(0, num(input.cutCostPerMin))
  // BOCHU's sec/pc is machine-ON time only — it excludes loading the tube, size/length
  // changes, program set-up and QC. Billing raw cut seconds therefore gives away every
  // one of those minutes. The uplift loads them back on, and applies to the COST as well
  // because the machine is genuinely occupied for them (cutCostPerMin is already a cost
  // per BILLABLE minute, so raw cut minutes alone understate what the job consumes).
  const setupLoadPct = Math.max(0, num(input.setupLoadPct))
  const billedSecPerPiece = secPerPiece * (1 + setupLoadPct / 100)
  // One-time work per part: the size change on the machine plus, for a brand-new part,
  // nesting/programming. It happens once whatever the quantity, so it is spread over the
  // order — which is exactly why small orders were being underquoted. Minutes come from
  // the owner's own Admin rates (40 min size change, 25 min programming), not a new guess.
  // An absent setupType means 'none' so a quote saved before this can never inflate itself.
  const setupChangeMin =
    input.setupType === 'dimension' ? Math.max(0, num(input.dimensionChangeMin, 40)) :
    input.setupType === 'length' ? Math.max(0, num(input.lengthChangeMin, 1)) : 0
  const programmingMin = input.newPart ? Math.max(0, num(input.programmingMin, 25)) : 0
  const setupMin = setupChangeMin + programmingMin
  const manualCutPrice = input.cutPricePerPiece !== '' && input.cutPricePerPiece != null
    ? Math.max(0, num(input.cutPricePerPiece))
    : null
  // Job work: the customer sends their own tube, so we neither charge nor carry the
  // material. It must leave the COST as well as the price — keeping it in the cost
  // would make every job-work quote report a loss it isn't making.
  const materialByCustomer = !!input.materialByCustomer

  const grams = tubeWeightGrams({ section, thickness, length, density })
  const baseWeightKg = grams == null ? 0 : grams / 1000
  const billedWeightKg = baseWeightKg * (1 + wastagePct / 100)
  const materialPerPc = materialByCustomer ? 0 : billedWeightKg * pipeRate
  // A typed ₹/pc is the owner's stated final price — never uplift that. Cost always uses
  // the loaded time, whatever we chose to charge.
  const cuttingPerPc = manualCutPrice == null ? (billedSecPerPiece / 60) * cutRatePerMin : manualCutPrice
  const cutCostPerPc = (billedSecPerPiece / 60) * cutCostPerMin
  // setupMin is already MINUTES and the rates are per MINUTE — no /60 here (that division
  // belongs to the cutting line, where the input is seconds).
  const setupPerPc = qty > 0 ? (setupMin * cutRatePerMin) / qty : 0
  const setupCostPerPc = qty > 0 ? (setupMin * cutCostPerMin) / qty : 0
  const pricePerPc = materialPerPc + cuttingPerPc + setupPerPc
  const costPerPc = materialPerPc + cutCostPerPc + setupCostPerPc
  const amount = pricePerPc * qty
  const costKnown = secPerPiece > 0
  const estimatedCost = costKnown ? costPerPc * qty : null

  const issues = []
  if (!String(input.name || '').trim()) issues.push('Part name')
  if (!section || grams == null) issues.push('Valid tube section')
  if (!(thickness > 0)) issues.push('Thickness')
  if (!(length > 0)) issues.push('Length')
  if (!(qty > 0)) issues.push('Quantity')
  if (!materialByCustomer && !(pipeRate > 0)) issues.push('Material rate')
  if (!(cuttingPerPc > 0)) issues.push('Cutting time or price')

  return {
    ...input,
    name: String(input.name || '').trim(),
    section,
    thickness,
    length,
    qty,
    density,
    pipeRate,
    wastagePct,
    secPerPiece,
    setupLoadPct,
    billedSecPerPiece,
    setupType: input.setupType || 'none',
    newPart: !!input.newPart,
    setupMin,
    setupPerPc,
    setupCostPerPc,
    cutRatePerMin,
    cutCostPerMin,
    cutPricePerPiece: manualCutPrice,
    materialByCustomer,
    baseWeightKg,
    billedWeightKg,
    materialPerPc,
    cuttingPerPc,
    cutCostPerPc,
    pricePerPc,
    costPerPc,
    amount,
    estimatedCost,
    margin: costKnown ? amount - estimatedCost : null,
    costKnown,
    issues,
    valid: issues.length === 0,
  }
}

// A line's own `materialBy` ('unico' | 'customer') wins; anything else means "follow the
// quote-level setting". Resolved here rather than in computeLine so a stale flag on a
// re-opened saved line can never outrank what the quote screen currently shows.
function resolveMaterialByCustomer(line, defaults) {
  if (line?.materialBy === 'customer') return true
  if (line?.materialBy === 'unico') return false
  return !!defaults?.materialByCustomer
}

// The one sentence that keeps a job-work quote from being read as an all-in price.
// Shared by the screen, the PDF and the WhatsApp message so all three say the same thing.
export function materialBasisNote(basis) {
  if (basis === 'customer') return 'Cutting charges only — material supplied by customer.'
  if (basis === 'mixed') return 'Material supplied by customer on the parts marked "by customer"; all other parts include material.'
  return ''
}

export function computeQuote(lines, gstPct = 18, defaults = {}) {
  const computedLines = (lines || []).map((line) => computeLine({
    ...defaults,
    ...line,
    materialByCustomer: resolveMaterialByCustomer(line, defaults),
  }))
  const subtotal = computedLines.reduce((sum, line) => sum + line.amount, 0)
  const costKnown = computedLines.length > 0 && computedLines.every((line) => line.costKnown)
  const estimatedCost = costKnown
    ? computedLines.reduce((sum, line) => sum + line.estimatedCost, 0)
    : null
  const gstRate = Math.max(0, num(gstPct))
  const gst = subtotal * gstRate / 100
  const total = subtotal + gst
  // Drives the "material supplied by customer" wording that MUST appear on any quote
  // where material isn't charged, so the customer can never read cutting-only as all-in.
  const customerMaterialLines = computedLines.filter((line) => line.materialByCustomer).length
  const setupTotal = computedLines.reduce((sum, line) => sum + line.setupPerPc * line.qty, 0)
  return {
    lines: computedLines,
    setupTotal: round2(setupTotal),
    customerMaterialLines,
    materialBasis: !customerMaterialLines ? 'unico'
      : customerMaterialLines === computedLines.length ? 'customer' : 'mixed',
    subtotal: round2(subtotal),
    gstPct: gstRate,
    gst: round2(gst),
    total: round2(total),
    estimatedCost: costKnown ? round2(estimatedCost) : null,
    estimatedMargin: costKnown ? round2(subtotal - estimatedCost) : null,
    costKnown,
    valid: computedLines.length > 0 && computedLines.every((line) => line.valid),
  }
}
