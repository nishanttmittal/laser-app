import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore, collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore'

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

let _jobs = null
export async function loadJobs() {
  if (_jobs) return _jobs
  await ensureAuth()
  const snap = await getDocs(query(collection(db, 'laser_jobs'), where('cardId', '==', CARD)))
  _jobs = snap.docs.map((d) => d.data()).sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''))
  return _jobs
}
