import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDelimited, parseMatrix, parseSpreadsheetFile } from './parseUpload.js'

test('parseMatrix maps the approved Allwin BOM-style headers', () => {
  const result = parseMatrix([
    ['Customer BOM'],
    ['Part Name', 'OD', 'Thickness', 'Length', 'Total Quantity'],
    ['Main rail', 38.25, 1.5, 996.5, 34],
  ])
  assert.equal(result.errors.length, 0)
  assert.deepEqual(result.rows[0], {
    sourceRow: 3,
    name: 'Main rail',
    section: 'R38.25',
    thickness: 1.5,
    length: 996.5,
    qty: 34,
    issues: [],
  })
})

test('parseMatrix builds a rectangular section from width and height', () => {
  const result = parseMatrix([
    ['Item', 'Width', 'Height', 'Wall Thickness', 'Cut Length', 'Qty'],
    ['Leg', 40, 20, 1.2, 610, 18],
  ])
  assert.equal(result.rows[0].section, '40x20')
  assert.equal(result.rows[0].qty, 18)
})

test('parseDelimited handles tabs and quoted CSV values', () => {
  const tsv = parseDelimited('Part Name\tSection\tThickness\tLength\tQuantity\nRail\t40x20\t1.2\t610\t20')
  assert.equal(tsv.rows[0].name, 'Rail')
  assert.equal(tsv.rows[0].section, '40x20')

  const csv = parseDelimited('Part Name,Section,Thickness,Length,Qty\n"Rail, left",R50,2,1000,5')
  assert.equal(csv.rows[0].name, 'Rail, left')
  assert.equal(csv.rows[0].qty, 5)
})

test('invalid rows are retained and clearly flagged', () => {
  const result = parseDelimited('Part,Section,Thickness,Length,Qty\nBad row,,0,,0')
  assert.equal(result.rows.length, 1)
  assert.ok(result.rows[0].issues.includes('section/OD'))
  assert.ok(result.rows[0].issues.includes('quantity'))
})

test('missing headers returns an actionable error', () => {
  const result = parseMatrix([['A', 'B'], [1, 2]])
  assert.equal(result.rows.length, 0)
  assert.equal(result.errors.length, 1)
})

test('parseSpreadsheetFile reads a real xlsx workbook', async () => {
  const { utils, write } = await import('xlsx')
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ['Part Name', 'OD', 'Thickness', 'Length', 'Total Quantity'],
    ['Handle', 32, 1.5, 450, 12],
  ]), 'BOM')
  const bytes = write(workbook, { type: 'array', bookType: 'xlsx' })
  const result = await parseSpreadsheetFile({
    name: 'allwin-bom.xlsx',
    arrayBuffer: async () => bytes,
  })
  assert.equal(result.errors.length, 0)
  assert.equal(result.rows[0].name, 'Handle')
  assert.equal(result.rows[0].section, 'R32')
})
