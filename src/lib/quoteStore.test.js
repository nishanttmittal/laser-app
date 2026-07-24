import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadLocalQuoteDefaults,
  loadLocalQuoteWorkspace,
  mergeQuoteWorkspaces,
  saveLocalQuoteDefaults,
  saveLocalQuoteEntity,
} from './quoteStore.js'

function memoryStorage() {
  const data = new Map()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  }
}

test('local quote workspace survives missing and corrupt storage', () => {
  const storage = memoryStorage()
  assert.deepEqual(loadLocalQuoteWorkspace(storage), { products: [], customers: [], quotes: [] })
  storage.setItem('unico_laser_quote_workspace_v1', '{bad')
  assert.deepEqual(loadLocalQuoteWorkspace(storage), { products: [], customers: [], quotes: [] })
})

test('saveLocalQuoteEntity updates an existing record without duplicating it', () => {
  const storage = memoryStorage()
  const first = saveLocalQuoteEntity('products', { id: 'p1', name: 'Rail' }, storage)
  const second = saveLocalQuoteEntity('products', { ...first, name: 'Long rail' }, storage)
  const workspace = loadLocalQuoteWorkspace(storage)
  assert.equal(workspace.products.length, 1)
  assert.equal(workspace.products[0].name, 'Long rail')
  assert.equal(second.createdAt, first.createdAt)
})

test('mergeQuoteWorkspaces keeps the newest local or cloud record', () => {
  const merged = mergeQuoteWorkspaces(
    { products: [{ id: 'p1', name: 'Old', updatedAt: 1 }], customers: [], quotes: [] },
    { products: [{ id: 'p1', name: 'New', updatedAt: 2 }], customers: [], quotes: [] },
  )
  assert.equal(merged.products.length, 1)
  assert.equal(merged.products[0].name, 'New')
})

test('quote defaults persist while retaining new fallback fields', () => {
  const storage = memoryStorage()
  saveLocalQuoteDefaults({ pipeRate: 91, wastagePct: 4 }, storage)
  assert.deepEqual(loadLocalQuoteDefaults({ pipeRate: 80, wastagePct: 5, gstPct: 18 }, storage), {
    pipeRate: 91,
    wastagePct: 4,
    gstPct: 18,
  })
})
