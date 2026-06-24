import React, { useEffect, useMemo, useState } from 'react'
import { loadCore, loadJobs, loadSizeMap } from './firebase'
import { rupee, fmt, prettyYmd, whenStr } from './lib/format.js'
import { ymd, lastCompleteDay, periodRange, filterDaysByRange, monthRollup } from './lib/period.js'
import { kWhCost } from './lib/energy.js'
import { enrichJobs, groupBySize } from './lib/sizemap.js'

/* ---------- helpers ---------- */
function computeSetup(jobs, setupCfg) {
  const ordered = [...jobs].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
  let len = 0, dim = 0, lf = null, ls = null
  for (const j of ordered) {
    if (j.file !== lf) { if (ls !== null && j.section && j.section === ls) len++; else dim++; lf = j.file; ls = j.section }
  }
  return { len, dim, min: len * (setupCfg?.lengthChangeMin ?? 15) + dim * (setupCfg?.dimensionChangeMin ?? 40) }
}

function useMonthly(days, jobs, cfg) {
  return useMemo(() => {
    const dd = days.filter((d) => d.cutTime)
    const totalCutMin = dd.reduce((a, d) => a + (d.cutTime || 0) / 60, 0)
    const ds = dd.map((d) => String(d.statDate)).sort()
    const toD = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
    const span = ds.length > 1 ? Math.max(1, (toD(ds[ds.length - 1]) - toD(ds[0])) / 864e5 + 1) : 30
    const mCut = (totalCutMin / span) * 30
    const setup = jobs ? computeSetup(jobs, cfg.setup) : { min: 0 }
    const mSetup = (setup.min / span) * 30
    const mBill = mCut + mSetup || 1
    return { mCut, mSetup, mBill, costPerBillMin: (cfg.totalMonthly || 0) / mBill, span }
  }, [days, jobs, cfg])
}

function piecesByDay(jobs) {
  const m = {}
  for (const j of jobs || []) m[j.day] = (m[j.day] || 0) + (j.partAmount || 0)
  return m
}

/* ---------- small UI ---------- */
const Card = ({ title, value, sub, accent }) => (
  <div className="card"><div className="card-t">{title}</div><div className="card-v" style={accent ? { color: accent } : null}>{value}</div>{sub && <div className="card-s">{sub}</div>}</div>
)

/* ---------- tabs ---------- */
function Dashboard({ days, cfg, mo }) {
  if (!days.length) return <Empty />
  const todayY = ymd(new Date())
  const headline = lastCompleteDay(days, todayY) || days[days.length - 1]
  const today = days.find((d) => d.statDate === todayY)
  const last14 = days.slice(-14)
  const maxPcs = Math.max(...last14.map((d) => d.pieces || 0), 1)
  const maxCut = Math.max(...last14.map((d) => d.cutTimeH || 0), 0.1)
  const charge = cfg.chargePerMin || 40
  const rate = cfg.electricityRate || 14
  const cutMin = (headline.cutTime || 0) / 60
  const kPcs = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n || '')
  return (
    <div>
      <h2>Last full day — {prettyYmd(headline.statDate)}</h2>
      {today && today.statDate !== headline.statDate && (
        <div className="todaystrip">Today ({prettyYmd(today.statDate)}, in progress): <b>{fmt(today.pieces || 0)}</b> pcs · {(today.cutTimeH || 0).toFixed(2)} h cutting</div>
      )}
      <div className="grid">
        <Card title="Pieces produced" value={fmt(headline.pieces || 0)} accent="#34d399" />
        <Card title="Lengths (runs)" value={fmt(headline.runs || 0)} />
        <Card title="Cutting" value={`${(headline.cutTimeH || 0).toFixed(2)} h`} />
        <Card title="Laser-on" value={`${(headline.laserOnH || 0).toFixed(2)} h`} />
        <Card title="Electricity" value={`${fmt(Math.round(headline.kWh || 0))} kWh`} sub={rupee(kWhCost(headline.kWh, rate))} />
        <Card title="Charge (cutting)" value={rupee(cutMin * charge)} accent="#34d399" />
      </div>

      <h2>Daily production — last 14 days (pieces)</h2>
      <div className="bars">
        {last14.map((d) => (
          <div className="bar-col" key={d.statDate} title={`${prettyYmd(d.statDate)}: ${fmt(d.pieces || 0)} pcs`}>
            <div className="bar-v">{kPcs(d.pieces || 0)}</div>
            <div className="bar prod" style={{ height: `${Math.max(4, ((d.pieces || 0) / maxPcs) * 82)}px` }} />
            <div className="bar-x">{String(d.statDate).slice(6, 8)}</div>
          </div>
        ))}
      </div>

      <h2>Cutting hours — last 14 days</h2>
      <div className="bars">
        {last14.map((d) => (
          <div className="bar-col" key={d.statDate} title={`${prettyYmd(d.statDate)}: ${(d.cutTimeH || 0).toFixed(1)}h`}>
            <div className="bar" style={{ height: `${Math.max(4, ((d.cutTimeH || 0) / maxCut) * 90)}px` }} />
            <div className="bar-x">{String(d.statDate).slice(6, 8)}</div>
          </div>
        ))}
      </div>

      <div className="note">
        Cost ≈ <b>{rupee(mo.costPerBillMin)}/billable-min</b> vs charge <b>{rupee(charge)}/min</b>.{' '}
        {mo.costPerBillMin <= charge
          ? 'Setup billed → small positive margin. Raise utilization to widen it.'
          : 'Below break-even at current utilization — fill the machine or bill more setup.'}
      </div>
    </div>
  )
}

function Jobs({ jobs }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (jobs || []).filter((j) => !t || (j.sizeKey + ' ' + j.file + ' ' + j.startTime + ' ' + whenStr(j.startTime)).toLowerCase().includes(t)).slice(0, 300)
  }, [jobs, q])
  return (
    <div>
      <h2>Jobs ({fmt((jobs || []).length)} runs)</h2>
      <input className="search" placeholder="Search size, file, month (e.g. 30x20 or Jun)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="joblist">
        {rows.map((j) => (
          <div className="jobcard" key={j.workUuid}>
            <div className="jobcard-head">
              <span className={'chip' + (j.hasSize ? '' : ' warn')}>{j.sizeKey}</span>
              <span className="jobcard-when">{whenStr(j.startTime)}</span>
            </div>
            <div className="jobcard-stats">
              <div><b>{fmt(j.partAmount)}</b><span>pieces</span></div>
              <div><b>{((j.timeTaken || 0) / 60).toFixed(1)}</b><span>min</span></div>
              <div><b>{j.secPerPiece ?? '-'}</b><span>sec/pc</span></div>
              <div><b>{fmt(j.pierceCount || 0)}</b><span>pierces</span></div>
            </div>
          </div>
        ))}
      </div>
      {rows.length === 300 && <div className="note">Showing first 300 — use search to narrow.</div>}
    </div>
  )
}

function BySize({ jobs, cfg, mo }) {
  const rows = groupBySize(jobs)
  const charge = cfg.chargePerMin || 40
  return (
    <div>
      <h2>By size ({rows.length})</h2>
      <div className="note">Shows the <b>size</b> read from the file name. <span className="warn">Unlabelled</span> = file names with no readable size — fix them on the Fix sizes tab.</div>
      <div className="tbl">
        <div className="tr th sz4"><span>Size</span><span>Pieces</span><span>₹/pc</span><span>Margin/pc</span></div>
        {rows.map((s) => {
          const spp = s.pieces ? s.sec / s.pieces : 0
          const chgPc = (spp / 60) * charge
          const costPc = (spp / 60) * mo.costPerBillMin
          return (
            <div className="tr sz4" key={s.sizeKey}>
              <span className={'szcell' + (s.hasSize ? '' : ' isname')}><i className={'dot' + (s.hasSize ? '' : ' warn')} />{s.sizeKey}</span>
              <span>{fmt(s.pieces)}</span>
              <span>{'₹' + chgPc.toFixed(2)}</span>
              <span style={{ color: chgPc - costPc >= 0 ? '#34d399' : '#f87171' }}>{'₹' + (chgPc - costPc).toFixed(2)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Costing({ jobs, cfg, mo }) {
  const sizes = groupBySize(jobs).filter((s) => !s.unlabelled)
  const [sizeKey, setSizeKey] = useState('')
  const [qty, setQty] = useState(100)
  const [setupType, setSetupType] = useState('dimension')
  const charge = cfg.chargePerMin || 40
  const sel = sizes.find((s) => s.sizeKey === sizeKey)
  const spp = sel && sel.pieces ? sel.sec / sel.pieces : 0
  const cutMin = (qty * spp) / 60
  const setupMin = setupType === 'dimension' ? (cfg.setup?.dimensionChangeMin ?? 40) : setupType === 'length' ? (cfg.setup?.lengthChangeMin ?? 15) : 0
  const stdMin = cutMin + setupMin
  const isLong = stdMin > (cfg.longJob?.thresholdMin ?? 60)
  const billMin = isLong ? stdMin * (1 + (cfg.longJob?.bufferPct ?? 20) / 100) : stdMin
  const quoteCharge = billMin * charge
  const quoteCost = billMin * mo.costPerBillMin
  const f = cfg.monthlyFixed || {}
  const items = [
    ['Operator', f.operator], ['Maintenance', f.maintenance], ['Rent', f.rent], ['Consumables', f.consumables],
    ['Depreciation', cfg.depreciationMonthly], ['Electricity (est)', cfg.electricityMonthly],
  ]
  return (
    <div>
      <h2>Costing (itemized)</h2>
      <div className="tbl">
        {items.map(([k, v]) => <div className="tr" key={k}><span>{k}</span><span>{rupee(v)}</span><span /><span /><span /></div>)}
        <div className="tr th"><span>Total / month</span><span>{rupee(cfg.totalMonthly)}</span><span /><span /><span /></div>
      </div>
      <div className="grid">
        <Card title="Cost / billable-min" value={rupee(mo.costPerBillMin)} />
        <Card title="Charge / min" value={rupee(charge)} accent="#34d399" />
        <Card title="Setup (length / dim)" value={`${cfg.setup?.lengthChangeMin ?? 15} / ${cfg.setup?.dimensionChangeMin ?? 40} min`} />
        <Card title="Long job +20% over" value={`${cfg.longJob?.thresholdMin ?? 60} min`} />
      </div>

      <h2>Quote a job</h2>
      <div className="quote">
        <label>Size
          <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}>
            <option value="">— pick a size —</option>
            {sizes.map((s) => <option key={s.sizeKey} value={s.sizeKey}>{s.sizeKey} ({s.pieces} pcs history)</option>)}
          </select>
        </label>
        <label>Quantity (pieces)
          <input type="number" value={qty} onChange={(e) => setQty(+e.target.value || 0)} />
        </label>
        <label>Setup
          <select value={setupType} onChange={(e) => setSetupType(e.target.value)}>
            <option value="dimension">Dimension change (+{cfg.setup?.dimensionChangeMin ?? 40}m)</option>
            <option value="length">Length change (+{cfg.setup?.lengthChangeMin ?? 15}m)</option>
            <option value="none">No setup</option>
          </select>
        </label>
      </div>
      {sel ? (
        <div className="tbl">
          <div className="tr"><span>Avg sec/piece (history)</span><span>{spp.toFixed(1)} s</span><span /><span /><span /></div>
          <div className="tr"><span>Cutting time</span><span>{cutMin.toFixed(1)} min</span><span /><span /><span /></div>
          <div className="tr"><span>Setup</span><span>{setupMin} min</span><span /><span /><span /></div>
          <div className="tr"><span>Standard time</span><span>{stdMin.toFixed(1)} min</span><span /><span /><span /></div>
          {isLong && <div className="tr"><span>Long-job +{cfg.longJob?.bufferPct ?? 20}%</span><span>{billMin.toFixed(1)} min</span><span /><span /><span /></div>}
          <div className="tr th"><span>Quote (charge)</span><span style={{ color: '#34d399' }}>{rupee(quoteCharge)}</span><span /><span /><span /></div>
          <div className="tr"><span>Est. cost</span><span>{rupee(quoteCost)}</span><span /><span /><span /></div>
          <div className="tr"><span>Est. margin</span><span style={{ color: quoteCharge - quoteCost >= 0 ? '#34d399' : '#f87171' }}>{rupee(quoteCharge - quoteCost)}</span><span /><span /><span /></div>
        </div>
      ) : <div className="note">Pick a size to estimate a quote (uses that size's real average cutting speed).</div>}
    </div>
  )
}

function Reports({ days, cfg }) {
  const charge = cfg.chargePerMin || 40
  const rate = cfg.electricityRate || 14
  const months = monthRollup(days)
  const csv = () => {
    const head = 'Date,Laser-on h,Cut h,Cut length m,Pierces,Pieces,Runs,Charge(cutting)\n'
    const body = days.map((d) => [prettyYmd(d.statDate), d.laserOnH || 0, d.cutTimeH || 0, d.cutLengthM || 0, d.pierceCount || 0, d.pieces || 0, d.runs || 0, Math.round(((d.cutTime || 0) / 60) * charge)].join(',')).join('\n')
    const blob = new Blob([head + body], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'unico-laser-days.csv'; a.click()
  }
  return (
    <div>
      <h2>Month-wise summary</h2>
      <div className="tbl">
        <div className="tr th sz4"><span>Month</span><span>Pieces</span><span>Cut h</span><span>Electricity ₹</span></div>
        {months.map((m) => (
          <div className="tr sz4" key={m.ym}>
            <span>{m.ym}</span><span>{fmt(m.pieces)}</span><span>{m.cutH.toFixed(1)}</span>
            <span>{rupee(kWhCost(m.kWh, rate))}</span>
          </div>
        ))}
      </div>
      <h2>Day-wise production</h2>
      <div className="note">A full <b>end-of-day PDF</b> is auto-generated daily and sent to your Telegram (WhatsApp once set up). The complete history is also saved on your laptop at <code>Desktop\UNICO-Laser-Reports\</code>.</div>
      <button className="btn" onClick={csv}>⬇ Download all days (CSV)</button>
      <div className="tbl">
        <div className="tr th wide"><span>Date</span><span>Pieces</span><span>Runs</span><span>Cut h</span><span>Cut m</span><span>Charge</span></div>
        {[...days].reverse().map((d) => (
          <div className="tr wide" key={d.statDate}>
            <span>{prettyYmd(d.statDate)}</span><span style={{ color: '#34d399' }}>{fmt(d.pieces || 0)}</span><span>{fmt(d.runs || 0)}</span>
            <span>{(d.cutTimeH || 0).toFixed(1)}</span><span>{fmt(d.cutLengthM || 0)}</span><span>{rupee(((d.cutTime || 0) / 60) * charge)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Machine({ meta, days, jobs }) {
  const rows = [
    ['Name', meta.nickname], ['Model', meta.laserModel], ['Power', (meta.laserPower || '') + ' W'],
    ['Range', meta.range], ['Serial', meta.serial], ['Software', `${meta.appName || ''} ${meta.appVer || ''}`],
    ['Days tracked', days.length], ['Runs tracked', (jobs || []).length],
  ]
  return (
    <div>
      <h2>Machine</h2>
      <div className="tbl">{rows.map(([k, v]) => <div className="tr" key={k}><span>{k}</span><span>{v || '-'}</span><span /><span /><span /></div>)}</div>
      <div className="note">Data auto-syncs 4×/day from BOCHU IoT and is archived permanently on your laptop (kept beyond BOCHU's 3-month limit).</div>
    </div>
  )
}

const Empty = () => <div className="note">No data yet. The sync runs 4×/day — check back after the machine has cut.</div>

function DayDetail({ days, jobs, cfg }) {
  const ymds = days.map((d) => String(d.statDate)).sort()
  const [iso, setIso] = useState(() => { const s = ymds[ymds.length - 1] || ''; return s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '' })
  const pick = iso.replace(/-/g, '')
  const d = days.find((x) => String(x.statDate) === pick)
  const dayJobs = (jobs || []).filter((j) => j.day === pick)
  const rate = cfg.electricityRate || 14
  const charge = cfg.chargePerMin || 40
  return (
    <div>
      <h2>Pick a day</h2>
      <input className="search" type="date" value={iso} onChange={(e) => setIso(e.target.value)} />
      {!d ? <div className="note">No production recorded on {iso || 'that day'}.</div> : (
        <>
          <h2>{prettyYmd(d.statDate)}</h2>
          <div className="grid">
            <Card title="Pieces produced" value={fmt(d.pieces || 0)} accent="#34d399" />
            <Card title="Lengths (runs)" value={fmt(d.runs || 0)} />
            <Card title="Cutting" value={`${(d.cutTimeH || 0).toFixed(2)} h`} />
            <Card title="Laser-on" value={`${(d.laserOnH || 0).toFixed(2)} h`} />
            <Card title="Electricity" value={`${fmt(Math.round(d.kWh || 0))} kWh`} sub={rupee(kWhCost(d.kWh, rate))} />
            <Card title="Charge (cutting)" value={rupee(((d.cutTime || 0) / 60) * charge)} accent="#34d399" />
          </div>
          <h2>Runs that day ({dayJobs.length})</h2>
          <div className="tbl">
            <div className="tr th sz4"><span>Size</span><span>Pieces</span><span>Min</span><span>When</span></div>
            {dayJobs.map((j) => (
              <div className="tr sz4" key={j.workUuid}>
                <span className={'szcell' + (j.hasSize ? '' : ' isname')}>{j.sizeKey}</span>
                <span>{fmt(j.partAmount)}</span><span>{((j.timeTaken || 0) / 60).toFixed(1)}</span>
                <span>{(j.startTime || '').slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- shell ---------- */
const TABS = ['Dashboard', 'Day', 'Jobs', 'By Size', 'Costing', 'Reports', 'Machine']
const PERIODS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['lastMonth', 'Last month'], ['all', 'All']]
export default function App() {
  const [tab, setTab] = useState('Dashboard')
  const [period, setPeriod] = useState('month')
  const [core, setCore] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [sizeMap, setSizeMap] = useState({})
  const [err, setErr] = useState('')

  useEffect(() => {
    loadCore().then(setCore).catch((e) => setErr(e.message))
    loadJobs().then(setJobs).catch((e) => setErr(e.message))
    loadSizeMap().then(setSizeMap).catch(() => {})
  }, [])

  const mappedJobs = useMemo(() => enrichJobs(jobs || [], sizeMap), [jobs, sizeMap])
  const mo = useMonthly(core?.days || [], mappedJobs, core?.cfg || {})

  if (err) return <div className="app"><div className="note err">Could not load data: {err}</div></div>
  if (!core) return <div className="app"><div className="loader">Loading UNICO Laser…</div></div>

  const { meta, cfg, days } = core
  const ready = jobs != null

  const todayY = ymd(new Date())
  const range = periodRange(period, todayY)
  const vdays = filterDaysByRange(days, range)
  const vjobs = mappedJobs.filter((j) => { const d = +j.day; return d >= range.from && d <= range.to })
  const showPeriod = ['Dashboard', 'By Size', 'Reports'].includes(tab)

  return (
    <div className="app">
      <header className="top"><span className="logo">UNICO</span><span className="ttl">Laser</span>
        {!ready && <span className="sync">loading runs…</span>}
      </header>
      {showPeriod && (
        <div className="periodbar">
          {PERIODS.map(([k, l]) => (
            <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>
          ))}
        </div>
      )}
      <main>
        {tab === 'Dashboard' && <Dashboard days={vdays} cfg={cfg} mo={mo} />}
        {tab === 'Day' && (ready ? <DayDetail days={days} jobs={mappedJobs} cfg={cfg} /> : <Loading />)}
        {tab === 'Jobs' && (ready ? <Jobs jobs={mappedJobs} /> : <Loading />)}
        {tab === 'By Size' && (ready ? <BySize jobs={vjobs} cfg={cfg} mo={mo} /> : <Loading />)}
        {tab === 'Costing' && (ready ? <Costing jobs={mappedJobs} cfg={cfg} mo={mo} /> : <Loading />)}
        {tab === 'Reports' && <Reports days={vdays} cfg={cfg} />}
        {tab === 'Machine' && <Machine meta={meta} days={days} jobs={jobs || []} />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </nav>
    </div>
  )
}
const Loading = () => <div className="loader">Loading runs…</div>
