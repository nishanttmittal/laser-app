import { readLargeCache, writeLargeCache } from './largeCache.js'

const KEY = 'unico-laser-machine-manifest-v1'

export function loadMachineManifest() {
  return readLargeCache(KEY, () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') }
    catch { return null }
  })
}

export function saveMachineManifest(manifest) {
  return writeLargeCache(KEY, manifest, (value) => {
    try { localStorage.setItem(KEY, JSON.stringify(value)) }
    catch { /* IndexedDB is the primary store; ignore quota/private-mode fallback failure. */ }
  })
}
