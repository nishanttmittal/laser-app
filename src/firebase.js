import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, query, where } from 'firebase/firestore'
import { cutoffYmd, needFullRead, mergeJobs, WINDOW_DAYS } from './lib/jobcache.js'

const firebaseConfig = {
  apiKey: 'AIzaSyCK0M-EfmOp9nh1-ZJcrBqT7c4plNxL2FM',
  authDomain: 'unico-operations.firebaseapp.com',
  projectId: 'unico-operations',
  storageBucket: 'unico-operations.firebasestorage.app',
  messagingSenderId: '367786260524',
  appId: '1:367786260524:web:ae49d5da0ef1a71a9e3989',
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
const auth = getAuth(app)

let signedIn = null
export function ensureAuth() {
  if (!signedIn) signedIn = signInAnonymously(auth).catch((e) => { console.error('auth', e); throw e })
  return signedIn
}

export const CARD = '250811133266'

export async function loadCore() {
  await ensureAuth()
  const [metaSnap, cfgSnap, daysSnap] = await Promise.all([
    getDoc(doc(db, 'laser_meta', CARD)),
    getDoc(doc(db, 'laser_config', 'settings')),
    getDocs(query(collection(db, 'laser_days'), where('cardId', '==', CARD))),
  ])
  const days = daysSnap.docs.map((d) => d.data()).sort((a, b) => a.statDate - b.statDate)
  return { meta: metaSnap.data() || {}, cfg: cfgSnap.data() || {}, days }
}

export async function loadSizeMap() {
  await ensureAuth()
  const snap = await getDocs(query(collection(db, 'laser_size_map'), where('cardId', '==', CARD)))
  const m = {}
  snap.docs.forEach((d) => { const x = d.data(); if (x.file) m[x.file] = x })
  return m
}

export async function saveSizeMapEntry({ file, sizeKey }) {
  await ensureAuth()
  const id = `${CARD}__${file}`.replace(/[\/#?]/g, '_')
  await setDoc(doc(db, 'laser_size_map', id), { cardId: CARD, file, sizeKey, updatedAt: Date.now() }, { merge: true })
}

// ---- laser_jobs read-reduction (device cache + windowed refetch + 10-day reconcile) ----
const CACHE_KEY = `laser_jobs_${CARD}`
const META_KEY = `laser_jobs_meta_${CARD}`
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode / full */ } }
const sortJobs = (a, b) => (b.startTime || '').localeCompare(a.startTime || '')

async function fetchAllJobs() {
  const snap = await getDocs(query(collection(db, 'laser_jobs'), where('cardId', '==', CARD)))
  return snap.docs.map((d) => d.data())
}
async function fetchRecentJobs() {
  // single-field range query (no composite index needed); filter to this card in JS.
  const cutoff = cutoffYmd(new Date(), WINDOW_DAYS)
  const snap = await getDocs(query(collection(db, 'laser_jobs'), where('day', '>=', cutoff)))
  return snap.docs.map((d) => d.data()).filter((j) => j.cardId === CARD)
}

let _jobs = null
export async function loadJobs() {
  if (_jobs) return _jobs
  await ensureAuth()
  const now = Date.now()
  const meta = lsGet(META_KEY)
  const cache = lsGet(CACHE_KEY) || []

  try {
    if (needFullRead(meta, now)) {
      const all = await fetchAllJobs()                 // full reconcile (first run / every 10 days)
      _jobs = all.sort(sortJobs)
      lsSet(CACHE_KEY, _jobs)
      lsSet(META_KEY, { lastFullAt: now, count: _jobs.length })
    } else {
      const recent = await fetchRecentJobs()           // light refresh: ~last 35 days only
      _jobs = mergeJobs(cache, recent).sort(sortJobs)
      lsSet(CACHE_KEY, _jobs)                           // keep meta.lastFullAt unchanged
    }
  } catch (e) {
    if (cache.length) { _jobs = cache.slice().sort(sortJobs); return _jobs } // offline/quota -> serve cache
    throw e
  }
  return _jobs
}
