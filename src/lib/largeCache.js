const DB_NAME = 'unico-laser-cache'
const STORE_NAME = 'entries'
const DB_VERSION = 1

let dbPromise

function openDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB unavailable'))
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB blocked'))
  }).catch((error) => {
    dbPromise = null
    throw error
  })

  return dbPromise
}

async function idbRead(key) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'))
  })
}

async function idbWrite(key, value) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'))
  })
}

export async function readLargeCache(key, fallbackRead = () => undefined) {
  try {
    const value = await idbRead(key)
    if (value !== undefined) return value
  } catch { /* private mode / unsupported browser -> legacy cache */ }
  return fallbackRead()
}

export async function writeLargeCache(key, value, fallbackWrite = () => {}) {
  try {
    await idbWrite(key, value)
    return 'indexeddb'
  } catch {
    fallbackWrite(value)
    return 'fallback'
  }
}
