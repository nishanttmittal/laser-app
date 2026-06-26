import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
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
const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

// Costing/margins are competitively sensitive — require a Google login on an allowlist
// (bootstrap owner + active emails in apps/laser/users). No anonymous access.
const BOOTSTRAP = ['nspenterprises24@gmail.com']
export const onAuth = (cb) => onAuthStateChanged(auth, cb)
export async function signInWithGoogle() {
  try { return await signInWithPopup(auth, provider) }
  catch (e) {
    if (['auth/popup-blocked', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'].includes(e?.code)) {
      const { signInWithRedirect } = await import('firebase/auth')
      return signInWithRedirect(auth, provider)
    }
    throw e
  }
}
export const signOutUser = () => signOut(auth)
export async function isAllowed(user) {
  return (await getRole(user)) !== null
}
// Returns 'owner' | 'meter' (staff) | null (not allowed). Bootstrap email = owner.
export async function getRole(user) {
  const email = (user && user.email || '').toLowerCase()
  if (!email) return null
  if (BOOTSTRAP.includes(email)) return 'owner'
  try {
    const s = await getDoc(doc(db, 'apps', 'laser', 'users', email))
    if (s.exists() && s.data().active) return s.data().role || 'owner'
  } catch { /* denied */ }
  return null
}

// ---- Users & access (owner only) ----
export async function listUsers() {
  const snap = await getDocs(collection(db, 'apps', 'laser', 'users'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export async function saveUser({ email, role, active }) {
  const id = String(email).toLowerCase().trim()
  await setDoc(doc(db, 'apps', 'laser', 'users', id), { email: id, role: role || 'meter', active: active !== false, updatedAt: Date.now() }, { merge: true })
}

// Staff/owner record the daily meter (two cumulative readings). One doc per date.
export async function saveMeterReading({ date, meterA, meterB, note }) {
  const ymd = String(date).replace(/-/g, '')
  const total = (Number(meterA) || 0) + (Number(meterB) || 0)
  await setDoc(doc(db, 'laser_meter', `${CARD}_${ymd}`), {
    cardId: CARD, date: ymd, meterA: Number(meterA) || 0, meterB: Number(meterB) || 0, total,
    note: note || '', enteredAt: Date.now(),
  }, { merge: true })
}

export const CARD = '250811133266'

// ---- once-a-day read gate (data barely changes intraday; saves Firestore quota) ----
const CORE_KEY = `laser_core_${CARD}`
const today = () => new Date().toISOString().slice(0, 10)
const _ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* full/private */ } } }

// Refresh button -> clear the day stamps so the next load does a live read.
export function forceRefresh() {
  try {
    const c = _ls.get(CORE_KEY); if (c) _ls.set(CORE_KEY, { ...c, day: '' })
    const m = lsGet(META_KEY); if (m) lsSet(META_KEY, { ...m, lastReadDay: '' })
  } catch { /* ignore */ }
  _jobs = null
}

export async function loadCore() {
  const cached = _ls.get(CORE_KEY)
  if (cached && cached.day === today() && cached.core) return cached.core // already read today
  try {
    const [metaSnap, cfgSnap, daysSnap] = await Promise.all([
      getDoc(doc(db, 'laser_meta', CARD)),
      getDoc(doc(db, 'laser_config', 'settings')),
      getDocs(query(collection(db, 'laser_days'), where('cardId', '==', CARD))),
    ])
    const days = daysSnap.docs.map((d) => d.data()).sort((a, b) => a.statDate - b.statDate)
    const core = { meta: metaSnap.data() || {}, cfg: cfgSnap.data() || {}, days }
    _ls.set(CORE_KEY, { day: today(), core })
    return core
  } catch (e) {
    if (cached && cached.core) return cached.core // quota/offline -> serve last cache
    throw e
  }
}

export async function loadSizeMap() {
  const snap = await getDocs(query(collection(db, 'laser_size_map'), where('cardId', '==', CARD)))
  const m = {}
  snap.docs.forEach((d) => { const x = d.data(); if (x.file) m[x.file] = x })
  return m
}

export async function saveSizeMapEntry({ file, sizeKey }) {
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
  const now = Date.now()
  const meta = lsGet(META_KEY)
  const cache = lsGet(CACHE_KEY) || []

  // once-a-day gate: if jobs were already read today, serve the cache with no Firestore read.
  if (meta && meta.lastReadDay === today() && cache.length) { _jobs = cache.slice().sort(sortJobs); return _jobs }

  try {
    if (needFullRead(meta, now)) {
      const all = await fetchAllJobs()                 // full reconcile (first run / every 10 days)
      _jobs = all.sort(sortJobs)
      lsSet(CACHE_KEY, _jobs)
      lsSet(META_KEY, { lastFullAt: now, count: _jobs.length, lastReadDay: today() })
    } else {
      const recent = await fetchRecentJobs()           // light refresh: ~last 35 days only
      _jobs = mergeJobs(cache, recent).sort(sortJobs)
      lsSet(CACHE_KEY, _jobs)
      lsSet(META_KEY, { ...meta, lastReadDay: today() }) // keep lastFullAt; stamp today's read
    }
  } catch (e) {
    if (cache.length) { _jobs = cache.slice().sort(sortJobs); return _jobs } // offline/quota -> serve cache
    throw e
  }
  return _jobs
}
