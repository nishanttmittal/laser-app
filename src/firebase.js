import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth'
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, writeBatch, serverTimestamp, query, where } from 'firebase/firestore'
import { cutoffFromYmd, needFullRead, fullReadBlocked, jobsAfterRead, mergeJobs, WINDOW_DAYS } from './lib/jobcache.js'
import { readLargeCache, writeLargeCache } from './lib/largeCache.js'
import { businessDateKey, businessYmd, machineYmd, normalizeJobTime } from './lib/time.js'

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
// Machine id — declared up here because module-level constants below (CAT_KEY, CORE_KEY, …)
// interpolate it; declaring it later caused a "Cannot access 'CARD' before initialization"
// crash that blanked the whole app on load.
export const CARD = '250811133266'
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
    // Default to the LEAST-privileged role: a doc missing `role` must not silently
    // become owner (that would leak costing/margins). Owner is granted only explicitly.
    if (s.exists() && s.data().active) return s.data().role || 'meter'
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

// ---- Quote workspace (owner only; additive nested collections) ----
// The UI also keeps a device-local copy, so quoting remains usable while the separately-owned
// Firestore rules are awaiting deployment or when the factory connection is offline.
let _quoteWorkspace = null
let _quoteWorkspacePromise = null
let _quoteWorkspaceError = null
const quoteKinds = ['products', 'customers', 'quotes']

const cleanFirestoreValue = (value) => {
  if (Array.isArray(value)) return value.map(cleanFirestoreValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, cleanFirestoreValue(child)]))
  }
  return value
}

export async function loadQuoteWorkspace() {
  if (_quoteWorkspace) return _quoteWorkspace
  if (_quoteWorkspaceError) throw _quoteWorkspaceError
  if (_quoteWorkspacePromise) return _quoteWorkspacePromise
  _quoteWorkspacePromise = Promise.all(quoteKinds.map(async (kind) => {
    const snap = await getDocs(collection(db, 'apps', 'laser', kind))
    return [kind, snap.docs.map((item) => ({ id: item.id, ...item.data() }))]
  })).then((entries) => {
    _quoteWorkspace = Object.fromEntries(entries)
    for (const kind of quoteKinds) {
      _quoteWorkspace[kind].sort((a, b) =>
        (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    }
    return _quoteWorkspace
  }).catch((error) => {
    _quoteWorkspaceError = error
    throw error
  }).finally(() => { _quoteWorkspacePromise = null })
  return _quoteWorkspacePromise
}

async function saveQuoteEntity(kind, entity) {
  if (!quoteKinds.includes(kind)) throw new Error(`Unknown quote collection: ${kind}`)
  const ref = entity?.id
    ? doc(db, 'apps', 'laser', kind, entity.id)
    : doc(collection(db, 'apps', 'laser', kind))
  const now = Date.now()
  const { id: _id, ...data } = entity || {}
  const record = cleanFirestoreValue({
    ...data,
    createdAt: data.createdAt || now,
    updatedAt: now,
  })
  await setDoc(ref, record, { merge: true })
  _quoteWorkspaceError = null
  const saved = { id: ref.id, ...record }
  if (_quoteWorkspace) {
    _quoteWorkspace[kind] = [
      saved,
      ..._quoteWorkspace[kind].filter((item) => item.id !== saved.id),
    ]
  }
  return saved
}

export const saveQuoteProduct = (product) => saveQuoteEntity('products', product)
export const saveQuoteCustomer = (customer) => saveQuoteEntity('customers', customer)
export const saveQuoteRecord = (quote) => saveQuoteEntity('quotes', quote)

// ---- Job catalog (name + photo, optional machine-file link) ----
// Catalog docs carry base64 photos, so reads are heavy. Cache like the rest of the app:
// one read per day, shared across every caller (owner join + worker Jobs tab) via _catalog.
const CAT_KEY = `laser_catalog_${CARD}`
let _catalog = null
export async function loadCatalog() {
  if (_catalog) return _catalog                                   // same session -> no read
  const cached = _ls.get(CAT_KEY)
  if (cached && cached.day === today() && cached.list) { _catalog = cached.list; return _catalog }
  try {
    const snap = await getDocs(query(collection(db, 'laser_job_catalog'), where('cardId', '==', CARD)))
    _catalog = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    _ls.set(CAT_KEY, { day: today(), list: _catalog })            // best-effort; lsSet no-ops if too big for storage
    return _catalog
  } catch (e) {
    if (cached && cached.list) { _catalog = cached.list; return _catalog } // quota/offline -> last cache
    throw e
  }
}
export async function saveCatalogJob({ id, name, photo, sizeKey, fileName, notes, matchMode }) {
  const docId = id || `${CARD}_${Date.now()}`
  await setDoc(doc(db, 'laser_job_catalog', docId), {
    cardId: CARD, name: name || '', photo: photo || '', sizeKey: (sizeKey || '').trim(),
    fileName: (fileName || '').trim(), matchMode: matchMode || (fileName ? 'file' : 'size'),
    notes: notes || '', updatedAt: Date.now(),
  }, { merge: true })
  _catalog = null; try { localStorage.removeItem(CAT_KEY) } catch { /* ignore */ } // invalidate -> next load re-reads
  return docId
}

// Staff/owner record the daily meter (two cumulative readings). One doc per date.
// Meter readings feed laser_days.kWh, which sets cost-per-minute and therefore every margin
// in the app. A reading is therefore CREATE-ONLY: staff record a missing date, nobody
// overwrites or deletes one, and an owner correction leaves a permanent record of what
// changed and why. The rules enforce this server-side; the checks here are for a usable
// message and to keep the old rule honest until the rules release lands.
export const meterDocId = (ymd) => `${CARD}_${String(ymd).replace(/-/g, '')}`

export async function loadMeterReading(date) {
  const s = await getDoc(doc(db, 'laser_meter', meterDocId(date)))
  return s.exists() ? { id: s.id, ...s.data() } : null
}

// The most recent reading before `date`, so the screen can show the expected delta. Walks
// back day by day (single-doc gets) rather than an ordered query — that would need a
// composite index this project doesn't have, and a missing index fails the whole read.
export async function loadPreviousMeterReading(date, maxBackDays = 10) {
  const start = String(date).replace(/-/g, '')
  const d = new Date(Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8)))
  for (let i = 1; i <= maxBackDays; i++) {
    d.setUTCDate(d.getUTCDate() - 1)
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    const prev = await loadMeterReading(ymd)   // sequential on purpose: stop at the first hit
    if (prev) return prev
  }
  return null
}

export async function saveMeterReading({ date, meterA, meterB, note }) {
  const ymd = String(date).replace(/-/g, '')
  const enteredBy = (auth.currentUser?.email || '').toLowerCase()
  if (!enteredBy) throw new Error('Sign in again before saving a reading.')
  const existing = await loadMeterReading(ymd)
  if (existing) throw new Error(`A reading for ${ymd} already exists. The owner can correct it, but it cannot be overwritten.`)
  const a = Number(meterA), b = Number(meterB)
  await setDoc(doc(db, 'laser_meter', meterDocId(ymd)), {
    cardId: CARD, date: ymd, meterA: a, meterB: b, total: a + b,
    note: note || '', enteredBy, createdAt: serverTimestamp(), schemaVersion: 2,
  })
}

// Owner-only. Never routed through saveMeterReading — a correction must be deliberate and
// must leave evidence, so it writes the canonical doc and an immutable correction record in
// one batch: both land or neither does.
export async function correctMeterReading({ date, meterA, meterB, note, reason }) {
  const ymd = String(date).replace(/-/g, '')
  const correctedBy = (auth.currentUser?.email || '').toLowerCase()
  if (!correctedBy) throw new Error('Sign in again before correcting a reading.')
  if (!String(reason || '').trim()) throw new Error('A correction needs a reason.')
  const before = await loadMeterReading(ymd)
  if (!before) throw new Error(`There is no reading for ${ymd} to correct.`)
  const a = Number(meterA), b = Number(meterB)
  const at = Date.now()
  const operationId = `${at}_${Math.random().toString(36).slice(2, 8)}`
  const after = { cardId: CARD, date: ymd, meterA: a, meterB: b, total: a + b, note: note || '' }

  const batch = writeBatch(db)
  batch.set(doc(db, 'laser_meter', meterDocId(ymd)), {
    ...after, correctedBy, correctedAt: serverTimestamp(), correctionId: operationId, schemaVersion: 2,
  }, { merge: true })
  batch.set(doc(db, 'laser_meter_corrections', operationId), {
    operationId, cardId: CARD, meterDocId: meterDocId(ymd), date: ymd,
    before: { meterA: before.meterA ?? null, meterB: before.meterB ?? null, total: before.total ?? null, note: before.note || '' },
    after,
    reason: String(reason).trim(), correctedBy, correctedAt: serverTimestamp(),
  })
  await batch.commit()
}

// ---- once-a-day read gate (data barely changes intraday; saves Firestore quota) ----
const CORE_KEY = `laser_core_${CARD}`
const today = () => businessDateKey()
const _ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* full/private */ } } }

// Refresh button -> clear the day stamps so the next load does a live read.
export function forceRefresh() {
  try {
    const c = _ls.get(CORE_KEY); if (c) _ls.set(CORE_KEY, { ...c, day: '' })
    const m = lsGet(META_KEY); if (m) lsSet(META_KEY, { ...m, lastReadDay: '', lastFullErrorAt: 0 })
    localStorage.removeItem(CAT_KEY)
  } catch { /* ignore */ }
  _jobs = null
  _catalog = null
}

export async function loadCore() {
  const cached = _ls.get(CORE_KEY)
  if (cached && cached.day === today() && cached.core) return cached.core // already read today
  try {
    const [metaSnap, cfgSnap, daysSnap, histSnap] = await Promise.all([
      getDoc(doc(db, 'laser_meta', CARD)),
      getDoc(doc(db, 'laser_config', 'settings')),
      getDocs(query(collection(db, 'laser_days'), where('cardId', '==', CARD))),
      getDocs(collection(db, 'laser_rate_history')), // effective-dated rate snapshots (small)
    ])
    const days = daysSnap.docs.map((d) => d.data()).sort((a, b) => a.statDate - b.statDate)
    const rateHistory = histSnap.docs.map((d) => d.data())
    const core = { meta: metaSnap.data() || {}, cfg: cfgSnap.data() || {}, days, rateHistory }
    _ls.set(CORE_KEY, { day: today(), core })
    return core
  } catch (e) {
    if (cached && cached.core) return cached.core // quota/offline -> serve last cache
    throw e
  }
}

// ---- Cost rates (owner only) ----
// Writes the edited rate fields onto laser_config/settings (merge — never clobbers fields the
// editor doesn't touch). The app's costing recomputes from these raw fields on next load.
// `meta.by` + `meta.changes` (old->new) are stamped on the doc and appended to an audit log
// (laser_config_log) so a fat-finger on ₹/min or rent is traceable. Log is best-effort.
// Live rates, the effective-dated snapshot and the audit event are ONE change, written in a
// single batch. They used to be three sequential writes with the last two swallowing their
// errors, so the screen could say "saved" while the rate history it is costed against was
// missing — every later report on that period would then be quietly wrong with nothing to
// show why. All three land or none do, and a failure now reaches the owner.
export async function saveConfig(patch, meta = {}) {
  const at = Date.now()
  // Effective-dated snapshot: a full copy of the rates that take effect FROM TODAY. Past days
  // keep their earlier snapshot, so this change never re-costs already-supplied work.
  // Use the LOCAL (IST) date — laser_days.statDate is local-dated, and a UTC date would mis-stamp
  // an early-morning edit as the previous day.
  const effYmd = businessYmd()
  const operationId = `${at}_${Math.random().toString(36).slice(2, 8)}`
  const by = meta.by || ''

  const batch = writeBatch(db)
  batch.set(doc(db, 'laser_config', 'settings'),
    { ...patch, ratesUpdatedAt: at, ratesUpdatedBy: by, ratesOperationId: operationId }, { merge: true })
  batch.set(doc(db, 'laser_rate_history', String(effYmd)),
    { ...patch, effectiveFrom: effYmd, by, at, operationId }, { merge: true })
  if (meta.changes && meta.changes.length) {
    batch.set(doc(db, 'laser_config_log', String(at)),
      { at, by, operationId, changes: meta.changes })
  }
  await batch.commit()
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
const prepareJobs = (jobs) => (jobs || []).map(normalizeJobTime).sort(sortJobs)

async function fetchAllJobs() {
  const snap = await getDocs(query(collection(db, 'laser_jobs'), where('cardId', '==', CARD)))
  return snap.docs.map((d) => d.data())
}
async function fetchRecentJobs() {
  // single-field range query (no composite index needed); filter to this card in JS.
  const cutoff = cutoffFromYmd(machineYmd(), WINDOW_DAYS)
  const snap = await getDocs(query(collection(db, 'laser_jobs'), where('day', '>=', cutoff)))
  return snap.docs.map((d) => d.data()).filter((j) => j.cardId === CARD)
}

let _jobs = null
// onPartial (optional): called with the recent-window jobs so the UI can render
// immediately while the full-history reconcile (~7k docs, minutes on a phone)
// finishes in the background. Without it a full-read day blanked every tab
// behind "loading runs…" until the whole collection had downloaded.
export async function loadJobs(onPartial) {
  if (_jobs) return _jobs
  const now = Date.now()
  const meta = lsGet(META_KEY)
  const cache = await readLargeCache(CACHE_KEY, () => lsGet(CACHE_KEY) || []) || []

  // once-a-day gate: if jobs were already read today, serve the cache with no Firestore read.
  if (meta && meta.lastReadDay === today() && cache.length) { _jobs = prepareJobs(cache); return _jobs }

  const full = needFullRead(meta, now) && !fullReadBlocked(meta, now)
  let partial = null
  try {
    const recent = await fetchRecentJobs()             // light window: ~last 35 days (fast)
    partial = prepareJobs(mergeJobs(cache, recent))
    if (full) {
      if (onPartial && partial.length) onPartial(partial) // first paint while history downloads
      const all = await fetchAllJobs()                 // full reconcile (first run / every 10 days)
      _jobs = prepareJobs(jobsAfterRead({ cache, recent, all }))
      await writeLargeCache(CACHE_KEY, _jobs, (value) => lsSet(CACHE_KEY, value))
      lsSet(META_KEY, { lastFullAt: now, count: _jobs.length, lastReadDay: today(), lastFullErrorAt: 0 })
    } else {
      _jobs = prepareJobs(jobsAfterRead({ cache, recent }))
      await writeLargeCache(CACHE_KEY, _jobs, (value) => lsSet(CACHE_KEY, value))
      lsSet(META_KEY, { ...meta, lastReadDay: today() }) // keep lastFullAt; stamp today's read
    }
  } catch (e) {
    // history read failed/stalled -> at least the recent window works this open
    if (partial && partial.length) {
      _jobs = partial
      // Keep what we did get, so re-opening the app doesn't re-read the same docs and
      // burn the shared 50k/day quota. lastFullAt is deliberately NOT stamped, so the
      // reconcile is still owed. Only claim the day's read when we already held history:
      // on a first-ever run an empty cache would otherwise trap the user on 35 days.
      try {
        await writeLargeCache(CACHE_KEY, _jobs, (value) => lsSet(CACHE_KEY, value))
        // Mark the failure so the expensive full read isn't re-attempted on every open.
        const failMeta = { ...meta, ...(full ? { lastFullErrorAt: now } : {}) }
        lsSet(META_KEY, cache.length ? { ...failMeta, lastReadDay: today() } : failMeta)
      } catch { /* cache write is best-effort */ }
      return _jobs
    }
    if (cache.length) { _jobs = prepareJobs(cache); return _jobs } // offline/quota -> serve cache
    throw e
  }
  return _jobs
}
