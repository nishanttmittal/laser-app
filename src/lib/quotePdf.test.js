import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quoteFilename } from './quotePdf.js'

test('quoteFilename is customer-specific and filesystem-safe', () => {
  assert.equal(
    quoteFilename({ customerName: 'A/B Components Pvt. Ltd.', date: '2026-07-24' }),
    'UNICO-Quote-A-B-Components-Pvt-Ltd-20260724.pdf',
  )
})
