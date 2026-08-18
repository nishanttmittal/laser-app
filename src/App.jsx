import React, { useEffect, useMemo, useState } from 'react'
import { loadCore, loadJobs, loadSizeMap, saveSizeMapEntry, onAuth, signInWithGoogle, signOutUser, getRole, saveMeterReading, listUsers, saveUser, loadCatalog, saveCatalogJob, saveConfig, forceRefresh } from './firebase'

// Downscale a phone photo to a small JPEG data URL (keeps Firestore docs tiny).
function compressImage(file, maxDim = 600, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    const done = (fn, arg) => { URL.revokeObjectURL(url); fn(arg) }
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
        const c = document.createElement('canvas'); c.width = w; c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) throw new Error('no canvas context')
        ctx.drawImage(img, 0, 0, w, h)
        done(resolve, c.toDataURL('image/jpeg', quality))
      } catch (e) { done(reject, e) }   // never leave the Save flow hanging
    }
    img.onerror = () => done(reject, new Error('image decode failed'))
    img.src = url
  })
}
import { rupee, fmt, prettyYmd, whenStr } from './lib/format.js'
import { lastCompleteDay, periodRange, filterDaysByRange, monthRollup } from './lib/period.js'
import { kWhCost } from './lib/energy.js'
import { enrichJobs, groupBySize, unlabelledFiles } from './lib/sizemap.js'
import { buildCatalogIndex, normFile, tagJobs, sizeCatalog, programOptions } from './lib/catalog.js'
import {
  filterProgramOptions,
  mergeMachineManifest,
  parseMachineManifest,
  programImageKind,
  programMachines,
  programPreviews,
} from './lib/machineManifest.js'
import { loadMachineManifest, saveMachineManifest } from './lib/machineManifestStore.js'
import { periodUtil, stateLabel } from './lib/util.js'
import { monthlyCost, quoteJob, whatIf, monthlyMargins, tubeWeightGrams } from './lib/costing.js'
import { periodReport } from './lib/reportData.js'
import { buildPeriodPDF } from './lib/pdf.js'
import { buildParts, daysWithJobs } from './lib/partsView.js'
import { BUSINESS_TIME_ZONE, businessDateKey, businessYmd, calendarDayDiff, displayStartTime } from './lib/time.js'
import Quote from './tabs/Quote.jsx'

/* ---------- helpers ---------- */
const useMonthly = (days, jobs, cfg) => useMemo(() => monthlyCost(days, cfg, jobs), [days, jobs, cfg])

/* ---------- small UI ---------- */
// Beam power-gauge — utilization shown as a radial machine readout (the signature element).
function Gauge({ pct = 0, target = 50 }) {
  const r = 82, L = Math.PI * r
  const frac = Math.max(0, Math.min(1, (pct || 0) / 100))
  const th = Math.PI - Math.max(0, Math.min(1, target / 100)) * Math.PI
  const x1 = 100 + (r - 11) * Math.cos(th), y1 = 100 - (r - 11) * Math.sin(th)
  const x2 = 100 + (r + 7) * Math.cos(th), y2 = 100 - (r + 7) * Math.sin(th)
  const col = (pct || 0) < target ? 'var(--heat)' : 'var(--accent)'
  return (
    <svg viewBox="0 0 200 118" className="gauge" role="img" aria-label={`Powered on ${Math.round(pct || 0)} percent, target ${target} percent`}>
      <path d="M 18 100 A 82 82 0 0 1 182 100" className="gauge-track" />
      <path d="M 18 100 A 82 82 0 0 1 182 100" className="gauge-val" style={{ stroke: col, color: col, strokeDasharray: `${frac * L} ${L}` }} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="gauge-target" />
      <text x="100" y="90" className="gauge-num">{Math.round(pct || 0)}<tspan className="gauge-pct">%</tspan></text>
      <text x="100" y="106" className="gauge-lbl">POWERED ON · TARGET {target}%</text>
    </svg>
  )
}
const Card = ({ title, value, sub, accent }) => (
  <div className="card"><div className="card-t">{title}</div><div className="card-v" style={accent ? { color: accent } : null}>{value}</div>{sub && <div className="card-s">{sub}</div>}</div>
)

/* ---------- tabs ---------- */
function Dashboard({ days, cfg, mo, meta }) {
  if (!days.length) return <Empty />
  const todayY = businessYmd()
  const headline = lastCompleteDay(days, todayY) || days[days.length - 1]
  const today = days.find((d) => d.statDate === todayY)
  const last14 = days.slice(-14)
  const maxPcs = Math.max(...last14.map((d) => d.pieces || 0), 1)
  const maxCut = Math.max(...last14.map((d) => d.cutTimeH || 0), 0.1)
  const charge = cfg.chargePerMin || 40
  const rate = cfg.electricityRate || 14
  const cutMin = (headline.cutTime || 0) / 60
  const kPcs = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n || '')
  const target = cfg.utilTargetPct || 50
  const fixedDaily = Math.round((mo.fixedExclElec || 0) / 30)
  const idleH = headline.powerOnPct != null ? +Math.max(0, 24 - (headline.workH || 0)).toFixed(1) : null
  return (
    <div>
      <StatusStrip meta={meta} />
      {headline.powerOnPct != null && (
        <div className="hero">
          <div className="hero-t">Utilization — your #1 profit lever</div>
          <Gauge pct={headline.powerOnPct} target={target} />
          <div className="hero-stats">
            <span>Idle <b>{idleH} h</b> (not cutting)</span>
            <span>Fixed cost <b>{rupee(fixedDaily)}/day</b> paid anyway</span>
            <span>Cutting <b>{(headline.workH || 0).toFixed(1)} h</b></span>
          </div>
          <div className="hero-note">Every extra cutting hour turns idle overhead into margin — this is the laser job-work opportunity. Fill the machine.</div>
        </div>
      )}
      <h2>Last full day — {prettyYmd(headline.statDate)}</h2>
      {today && today.statDate !== headline.statDate && (
        <div className="todaystrip">Today ({prettyYmd(today.statDate)}, in progress): <b>{fmt(today.pieces || 0)}</b> pcs · {(today.cutTimeH || 0).toFixed(2)} h cutting</div>
      )}
      <div className="grid">
        <Card title="Pieces produced" value={fmt(headline.pieces || 0)} accent="#34d399" />
        <Card title="Lengths (runs)" value={fmt(headline.runs || 0)} />
        <Card title="Cutting" value={`${(headline.cutTimeH || 0).toFixed(2)} h`} />
        <Card title="Laser-on" value={`${(headline.laserOnH || 0).toFixed(2)} h`} />
        <Card title="Electricity" value={`${fmt(Math.round(headline.kWh || 0))} kWh`} sub={`${rupee(kWhCost(headline.kWh, rate))} · ${headline.kWhSource === 'meter-actual' ? 'actual' : 'est'}`} />
        <Card title="Charge (cutting)" value={rupee(cutMin * charge)} accent="#34d399" />
      </div>

      {headline.powerOnPct != null ? (
        <>
          <h2>Utilization — {prettyYmd(headline.statDate)}</h2>
          <div className="grid">
            <Card title="Powered on" value={`${headline.powerOnPct}%`} sub={`${(headline.runningH || 0).toFixed(1)} h of 24`} accent={headline.powerOnPct < 30 ? '#f59e0b' : '#34d399'} />
            <Card title="Cutting (of on-time)" value={`${headline.workUtilPct}%`} sub={`${(headline.workH || 0).toFixed(1)} h working`} accent={headline.workUtilPct < 50 ? '#f59e0b' : '#34d399'} />
            <Card title="Offline" value={`${(headline.offlineH || 0).toFixed(1)} h`} sub={`${(24 - (headline.offlineH || 0)).toFixed(1)} h online`} />
            <Card title="Alarms" value={fmt(headline.alarmCount || 0)} sub={`${(headline.alarmPeriodH || 0).toFixed(2)} h`} accent={(headline.alarmCount || 0) > 0 ? '#f87171' : null} />
          </div>
          <h2>Powered-on rate — last 14 days</h2>
          <div className="bars">
            {last14.map((d) => (
              <div className="bar-col" key={d.statDate} title={`${prettyYmd(d.statDate)}: ${d.powerOnPct ?? '—'}% on · ${d.workUtilPct ?? '—'}% cutting`}>
                <div className="bar-v">{d.powerOnPct != null ? Math.round(d.powerOnPct) : ''}</div>
                <div className="bar" style={{ height: `${Math.max(4, ((d.powerOnPct || 0) / 100) * 90)}px`, background: (d.powerOnPct || 0) < 30 && d.powerOnPct != null ? '#f59e0b' : undefined }} />
                <div className="bar-x">{String(d.statDate).slice(6, 8)}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="note">Utilization (powered-on %, cutting %, offline hours) is syncing — appears after the next nightly data pull.</div>
      )}

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
    return (jobs || []).filter((j) => {
      const shownTime = displayStartTime(j)
      return !t || (j.sizeKey + ' ' + j.file + ' ' + (j.catName || '') + ' ' + j.startTime + ' ' + shownTime + ' ' + whenStr(shownTime)).toLowerCase().includes(t)
    }).slice(0, 300)
  }, [jobs, q])
  return (
    <div>
      <h2>Jobs ({fmt((jobs || []).length)} runs)</h2>
      <input className="search" placeholder="Search name, size, file, month (e.g. table leg or Jun)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="joblist">
        {rows.map((j) => (
          <div className="jobcard" key={j.workUuid}>
            <div className="jobcard-head">
              {j.catPhoto && <img className="jobthumb" src={j.catPhoto} alt="" />}
              <span className={'chip' + (j.hasSize ? '' : ' warn')}>{j.catName || j.sizeKey}</span>
              <span className="jobcard-when">{whenStr(displayStartTime(j))} IST</span>
            </div>
            {j.catName && <div className="jobcard-sub">{j.sizeKey} · {j.file}</div>}
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
  // catalog name/photo per size: group tagged jobs by sizeKey, then resolve a single name.
  const catBySize = useMemo(() => {
    const bySize = {}
    for (const j of jobs || []) (bySize[j.sizeKey] = bySize[j.sizeKey] || []).push(j)
    const m = {}
    for (const k in bySize) m[k] = sizeCatalog(bySize[k])
    return m
  }, [jobs])
  return (
    <div>
      <h2>By size ({rows.length})</h2>
      <div className="note">Shows the <b>size</b> read from the file name. <span className="warn">Unlabelled</span> = file names with no readable size — fix them on the Fix sizes tab.</div>
      <div className="tbl">
        <div className="tr th sz4"><span>Size</span><span>Pieces</span><span>₹/pc</span><span>Margin/pc</span></div>
        {rows.map((s) => {
          const spp = s.secPerPiece || 0
          const chgPc = (spp / 60) * charge
          const costPc = (spp / 60) * mo.costPerBillMin
          const cat = catBySize[s.sizeKey]
          return (
            <div className="tr sz4" key={s.sizeKey}>
              <span className={'szcell' + (s.hasSize ? '' : ' isname')}>
                {cat && cat.photo && <img className="szthumb" src={cat.photo} alt="" />}
                {!cat && <i className={'dot' + (s.hasSize ? '' : ' warn')} />}
                {s.sizeKey}{cat && cat.name ? <span style={{ opacity: 0.7 }}> · {cat.name}</span> : ''}
              </span>
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
  const [quoteRate, setQuoteRate] = useState(charge) // per-quote ₹/min override (defaults to global)
  const [newPart, setNewPart] = useState(false)
  const rateNum = +quoteRate > 0 ? +quoteRate : charge
  const sel = sizes.find((s) => s.sizeKey === sizeKey)
  const spp = sel ? sel.secPerPiece || 0 : 0
  const piecesPerTube = sel && sel.goodPieces && sel.runs ? sel.goodPieces / sel.runs : (sel && sel.runs ? sel.pieces / sel.runs : 0)
  const { cutMin, setupMin, loadingMin, progMin, tubes, qcMin, billMin, quoteCharge, quoteCost, minApplied } =
    quoteJob({ secPerPiece: spp, qty, setupType, cfg, costPerBillMin: mo.costPerBillMin, piecesPerTube, newPart, chargePerMin: rateNum })
  // Warn only when THIS job actually loses money (true margin, incl. the min-order floor) —
  // not a rate-level proxy that over-warns on tiny jobs the ₹ minimum makes profitable.
  const quoteLoss = quoteCharge - quoteCost < 0
  const qcPct = cfg.qcPct ?? cfg.longJob?.bufferPct ?? 12
  const shareQuote = async () => {
    // customer-facing ONLY — never include cost or margin
    const text = [
      'UNICO Metal Products — Laser Cutting Quote',
      new Date().toLocaleDateString('en-IN', { timeZone: BUSINESS_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }),
      '',
      `Item: ${sizeKey}`,
      `Quantity: ${fmt(qty)} pcs`,
      `Laser cutting time: ~${billMin.toFixed(0)} min`,
      `Quote: ${rupee(quoteCharge)}`,
      '',
      '(Laser cutting + setup only; tube / material billed separately.)',
    ].join('\n')
    try {
      if (navigator.share) await navigator.share({ text })
      else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank')
    } catch { /* user cancelled share */ }
  }
  const f = cfg.monthlyFixed || {}
  const items = [
    ['Operator', f.operator], ['Maintenance', f.maintenance], ['Rent', f.rent], ['Consumables', f.consumables],
    ['Depreciation', cfg.depreciationMonthly], ['Electricity', mo.mElec],
  ]
  return (
    <div>
      <h2>Costing (itemized)</h2>
      <div className="tbl">
        {items.map(([k, v]) => <div className="tr" key={k}><span>{k}</span><span>{rupee(v)}</span><span /><span /><span /></div>)}
        <div className="tr th"><span>Total / month</span><span>{rupee(mo.totalMonthly)}</span><span /><span /><span /></div>
      </div>
      <div className="grid">
        <Card title="Cost / billable-min" value={rupee(mo.costPerBillMin)} />
        <Card title="Charge / min" value={rupee(charge)} accent="#34d399" />
        <Card title="Setup basis" value={`${cfg.setup?.sizeChangesPerDay ?? 5.5} size-changes/day`} sub={`× ${cfg.setup?.dimensionChangeMin ?? 40} min + length changes auto (${Math.round((cfg.setup?.lengthChangeMin ?? 1) * 60)}s each)`} />
        <Card title="Loading / tube" value={`${cfg.setup?.loadSecPerTube ?? 18} sec`} sub="explicit per tube loaded" />
        <Card title="QC" value={`+${qcPct}%`} sub="of cutting time" />
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
        <label>₹/min for this quote
          <input type="number" inputMode="decimal" value={quoteRate} onChange={(e) => setQuoteRate(e.target.value)} />
        </label>
        <label>Setup
          <select value={setupType} onChange={(e) => setSetupType(e.target.value)}>
            <option value="dimension">Dimension change (+{cfg.setup?.dimensionChangeMin ?? 40}m)</option>
            <option value="length">Length change (+{Math.round((cfg.setup?.lengthChangeMin ?? 1) * 60)} sec)</option>
            <option value="none">No setup</option>
          </select>
        </label>
        <label className="chk"><input type="checkbox" checked={newPart} onChange={(e) => setNewPart(e.target.checked)} /> New part — add one-time programming ({cfg.programmingMin ?? 25} min)</label>
      </div>
      {sel && (
        <div className={'note' + (quoteLoss ? ' err' : '')}>
          {rateNum !== charge ? `Custom rate ₹${rateNum}/min (default ₹${charge}/min). ` : `Using default ₹${charge}/min. `}
          Cost ≈ ₹{Math.round(mo.costPerBillMin || 0)}/min.
          {quoteLoss ? ' ⚠ This quote is BELOW cost — it loses money (see margin below).' : ' You keep the difference as margin.'}
        </div>
      )}
      {sel ? (
        <div className="tbl">
          <div className="tr"><span>Avg sec/piece (history)</span><span>{spp.toFixed(1)} s</span><span /><span /><span /></div>
          <div className="tr"><span>Cutting time{(cfg.rejectionPct ?? 0) > 0 ? ` (incl ${cfg.rejectionPct}% reject yield)` : ''}</span><span>{cutMin.toFixed(1)} min</span><span /><span /><span /></div>
          <div className="tr"><span>QC ({qcPct}% of cutting)</span><span>{qcMin.toFixed(1)} min</span><span /><span /><span /></div>
          <div className="tr"><span>Setup</span><span>{setupMin} min</span><span /><span /><span /></div>
          {progMin > 0 && <div className="tr"><span>Programming (new part, one-time)</span><span>{progMin} min</span><span /><span /><span /></div>}
          <div className="tr"><span>Loading ({fmt(tubes)} tube{tubes === 1 ? '' : 's'} × {cfg.setup?.loadSecPerTube ?? 18}s)</span><span>{loadingMin.toFixed(1)} min</span><span /><span /><span /></div>
          <div className="tr"><span>Billable time</span><span>{billMin.toFixed(1)} min</span><span /><span /><span /></div>
          <div className="tr th"><span>Quote (charge){minApplied ? ' · min order' : ''}</span><span style={{ color: '#34d399' }}>{rupee(quoteCharge)}</span><span /><span /><span /></div>
          <div className="tr"><span>Est. cost</span><span>{rupee(quoteCost)}</span><span /><span /><span /></div>
          <div className="tr"><span>Est. margin</span><span style={{ color: quoteCharge - quoteCost >= 0 ? '#34d399' : '#f87171' }}>{rupee(quoteCharge - quoteCost)}</span><span /><span /><span /></div>
        </div>
      ) : <div className="note">Pick a size to estimate a quote (uses that size's real average cutting speed).</div>}
      {sel && <button className="btn wa" onClick={shareQuote}>Share quote on WhatsApp</button>}
    </div>
  )
}

function Reports({ days, jobs, cfg, mo }) {
  const charge = cfg.chargePerMin || 40
  const rate = cfg.electricityRate || 14
  const todayIso = businessDateKey()
  const [from, setFrom] = useState(() => `${todayIso.slice(0, 7)}-01`) // 1st of this IST month
  const [to, setTo] = useState(() => todayIso)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const fromN = +from.replace(/-/g, ''), toN = +to.replace(/-/g, '')
  const rangeDays = (days || []).filter((d) => { const x = +d.statDate; return x >= fromN && x <= toN })
  const months = monthRollup(rangeDays)

  const csv = () => {
    const head = 'Date,Laser-on h,Cut h,Cut length m,Pierces,Pieces,Runs,Charge(cutting)\n'
    const body = days.map((d) => [prettyYmd(d.statDate), d.laserOnH || 0, d.cutTimeH || 0, d.cutLengthM || 0, d.pierceCount || 0, d.pieces || 0, d.runs || 0, Math.round(((d.cutTime || 0) / 60) * charge)].join(',')).join('\n')
    const blob = new Blob([head + body], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'unico-laser-days.csv'; a.click()
  }

  const makePDF = async (detailed) => {
    if (fromN > toN) { setMsg('“From” date is after “To”.'); return }
    setBusy(detailed ? 'detailed' : 'summary'); setMsg('')
    try {
      const report = periodReport(days, jobs, cfg, mo, { from: fromN, to: toN })
      const { blob, filename } = await buildPeriodPDF(report, { detailed })
      const file = new File([blob], filename, { type: 'application/pdf' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })   // iPhone: share sheet -> WhatsApp
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
    } catch (e) { if (e?.name !== 'AbortError') setMsg('Could not make PDF: ' + e.message) }
    finally { setBusy('') }
  }

  return (
    <div>
      <h2>Reports</h2>
      <div className="quote">
        <div className="rangerow">
          <label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} max={todayIso} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </div>
      <div className="pdfrow">
        <button className="btn wa" disabled={!!busy} onClick={() => makePDF(false)}>{busy === 'summary' ? 'Making…' : '⬇ PDF — Summary'}</button>
        <button className="btn" disabled={!!busy} onClick={() => makePDF(true)}>{busy === 'detailed' ? 'Making…' : '⬇ PDF — Detailed'}</button>
      </div>
      <div className="note">PDF covers the dates above and downloads to your phone — tap the share sheet to send it on WhatsApp. <b>Summary</b> = 1 page; <b>Detailed</b> adds day-by-day + top parts.</div>
      {msg && <div className="note err">{msg}</div>}

      <h2>Month-wise summary</h2>
      <div className="tbl">
        <div className="tr th sz4"><span>Month</span><span>Pieces</span><span>Cut h</span><span>Electricity ₹</span></div>
        {months.length ? months.map((m) => (
          <div className="tr sz4" key={m.ym}>
            <span>{m.ym}</span><span>{fmt(m.pieces)}</span><span>{m.cutH.toFixed(1)}</span>
            <span>{rupee(kWhCost(m.kWh, rate))}</span>
          </div>
        )) : <div className="note">No production in this range.</div>}
      </div>
      <h2>Day-wise production</h2>
      <div className="note">A full <b>end-of-day PDF</b> is auto-generated nightly and sent to your Telegram (WhatsApp once set up). The complete history is also saved on your laptop at <code>Desktop\UNICO-Laser-Reports\</code>.</div>
      <button className="btn" onClick={csv}>⬇ Download all days (CSV)</button>
      <div className="tbl">
        <div className="tr th wide"><span>Date</span><span>Pieces</span><span>Runs</span><span>Cut h</span><span>Cut m</span><span>Charge</span></div>
        {[...rangeDays].reverse().map((d) => (
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
      <div className="note">Data auto-syncs once nightly from BOCHU IoT (and on demand via the desktop “Refresh Laser Now” shortcut), and is archived permanently on your laptop (kept beyond BOCHU's 3-month limit).</div>
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
            <Card title="Electricity" value={`${fmt(Math.round(d.kWh || 0))} kWh`} sub={`${rupee(kWhCost(d.kWh, rate))} · ${d.kWhSource === 'meter-actual' ? 'actual' : 'est'}`} />
            <Card title="Charge (cutting)" value={rupee(((d.cutTime || 0) / 60) * charge)} accent="#34d399" />
          </div>
          <h2>Runs that day ({dayJobs.length})</h2>
          <div className="tbl">
            <div className="tr th sz4"><span>Size</span><span>Pieces</span><span>Min</span><span>When</span></div>
            {dayJobs.map((j) => (
              <div className="tr sz4" key={j.workUuid}>
                <span className={'szcell' + (j.hasSize ? '' : ' isname')}>{j.sizeKey}</span>
                <span>{fmt(j.partAmount)}</span><span>{((j.timeTaken || 0) / 60).toFixed(1)}</span>
                <span>{whenStr(displayStartTime(j))}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Assign({ jobs, onSaved }) {
  const files = useMemo(() => unlabelledFiles(jobs), [jobs])
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState('')
  const save = async (file) => {
    const v = (draft[file] || '').trim()
    if (!v) return
    setBusy(file)
    try { await saveSizeMapEntry({ file, sizeKey: v }); onSaved && await onSaved() }
    finally { setBusy('') }
  }
  return (
    <div>
      <h2>Fix unlabelled sizes ({files.length})</h2>
      <div className="note">These runs came from machine file names with no readable size. Type the real size once — it sticks for all past and future runs of that file.</div>
      {!files.length && <div className="note">Nothing to fix — every run has a size. 🎉</div>}
      <div className="joblist">
        {files.map((f) => (
          <div className="jobcard" key={f.file}>
            <div className="jobcard-head"><span className="chip warn">{f.file}</span><span className="jobcard-when">{f.runs} runs · {fmt(f.pieces)} pcs</span></div>
            <div className="quote">
              <input className="search" placeholder="Real size e.g. 40x40 t2" value={draft[f.file] || ''} onChange={(e) => setDraft({ ...draft, [f.file]: e.target.value })} />
              <button className="btn" disabled={busy === f.file} onClick={() => save(f.file)}>{busy === f.file ? 'Saving…' : 'Save size'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const StatusStrip = ({ meta }) => {
  const s = stateLabel(meta && meta.deviceState)
  return <div className={'statusstrip ' + s.tone}><span className="dotlive" />Machine (last sync): <b>{s.text}</b></div>
}

// Shows how fresh the data is. Costing/margins drift silently if the nightly sync stops —
// this is the only visible signal that the numbers are running on stale data.
function FreshnessBanner({ days }) {
  const dd = (days || []).filter((d) => d.statDate)
  if (!dd.length) return null
  const latest = String(dd.reduce((a, d) => Math.max(a, +d.statDate), 0))
  const daysAgo = calendarDayDiff(latest, businessYmd())
  // Sync runs nightly for the previous day, so "1 day ago" is normal/current.
  const stale = daysAgo >= 2
  return (
    <div className={'freshbar' + (stale ? ' stale' : '')}>
      {stale ? '⚠ ' : ''}Data as of <b>{prettyYmd(latest)}</b>
      {daysAgo <= 1 ? ' · current' : ` · ${daysAgo} days ago — the nightly sync may have stopped`}
    </div>
  )
}

function Utilization({ days, meta }) {
  if (!days.length) return <Empty />
  const u = periodUtil(days)
  if (!u.nDays) return <div><StatusStrip meta={meta} /><div className="note">No utilization data for this period yet — it fills in nightly from the machine's on/off timeline.</div></div>
  const total = u.runningH + u.offlineH || 1
  const bar = [
    { label: 'Cutting', h: u.workH, cls: 'good' },
    { label: 'Idle (on)', h: u.idleH, cls: 'warn' },
    { label: 'Offline', h: u.offlineH, cls: 'mut' },
  ]
  return (
    <div>
      <StatusStrip meta={meta} />
      <h2>Utilization — {u.nDays} day{u.nDays > 1 ? 's' : ''} in view</h2>
      <div className="grid">
        <Card title="Powered on" value={`${u.powerOnPct}%`} sub={`${u.runningH} h of ${u.nDays * 24} h`} accent={u.powerOnPct < 30 ? '#f59e0b' : '#34d399'} />
        <Card title="Cutting (of on-time)" value={`${u.workUtilPct}%`} sub={`${u.workH} h cutting`} accent={u.workUtilPct < 50 ? '#f59e0b' : '#34d399'} />
        <Card title="Offline" value={`${u.offlineH} h`} sub={`idle ${u.idleH} h`} />
        <Card title="Alarms" value={fmt(u.alarmCount)} sub={`${u.alarmH} h`} accent={u.alarmCount > 0 ? '#f87171' : null} />
      </div>
      <h2>Where the time went</h2>
      <div className="splitbar">
        {bar.map((b) => b.h > 0 && (
          <div key={b.label} className={'seg ' + b.cls} style={{ width: `${(b.h / total) * 100}%` }} title={`${b.label}: ${b.h} h`}>
            {(b.h / total) > 0.12 ? b.label : ''}
          </div>
        ))}
      </div>
      <div className="note">
        Over this period the machine was <b>powered on {u.powerOnPct}%</b> of the time, and of that on-time only <b>{u.workUtilPct}%</b> was actually cutting. The rest is idle or off — that gap is your spare capacity (and fixed cost) to fill.
      </div>
    </div>
  )
}

function Margin({ days, cfg, mo, rateHistory }) {
  const { months, total } = monthlyMargins(days, cfg, rateHistory)
  const [hrs, setHrs] = useState(8)
  const [wdays, setWdays] = useState(26)
  const charge = cfg.chargePerMin || 40
  const wi = whatIf(mo, cfg, { cuttingHoursPerDay: hrs, workingDaysPerMonth: wdays })
  return (
    <div>
      <h2>Actual margin — per month</h2>
      <div className="note">Each month uses the <b>rates in force then</b> — changing a rate never re-costs old work. Price (₹/min) &amp; electricity apply <b>from the exact day</b> you change them; rent/salary changes apply <b>from the next month</b>. Revenue = production billed at the period's ₹/min (cutting + setup + loading + QC); cost = monthly fixed + <b>actual electricity</b>. Material billed separately.</div>
      <div className="tbl">
        <div className="tr th wide"><span>Month</span><span>Cut h</span><span>Revenue</span><span>Elec</span><span>Margin</span></div>
        {months.map((m) => (
          <div className="tr wide" key={m.ym}>
            <span>{m.ym}</span><span>{m.cutH}</span>
            <span style={{ color: '#34d399' }}>{rupee(m.revenue)}</span>
            <span>{rupee(m.elecCost)}</span>
            <span style={{ color: m.margin >= 0 ? '#34d399' : '#f87171' }}>{rupee(m.margin)} · {m.marginPct}%</span>
          </div>
        ))}
        {months.length > 0 && (
          <div className="tr wide" style={{ fontWeight: 700, borderTop: '2px solid #2dd4ee44' }}>
            <span>Total</span><span>{total.cutH}</span>
            <span style={{ color: '#34d399' }}>{rupee(total.revenue)}</span>
            <span>{rupee(total.elecCost)}</span>
            <span style={{ color: total.margin >= 0 ? '#34d399' : '#f87171' }}>{rupee(total.margin)} · {total.marginPct}%</span>
          </div>
        )}
      </div>
      <div className="note">Cumulative <b>effective</b> revenue {rupee(total.revenue)} and margin {rupee(total.margin)} — the correct blend of every month at its own rate (not everything re-priced at today's rate).</div>

      <h2>What-if — run the machine longer</h2>
      <div className="quote">
        <label>Cutting hours / day
          <input type="number" step="0.5" value={hrs} onChange={(e) => setHrs(+e.target.value || 0)} />
        </label>
        <label>Working days / month
          <input type="number" value={wdays} onChange={(e) => setWdays(+e.target.value || 0)} />
        </label>
      </div>
      <div className="grid">
        <Card title="Cost / billable-min" value={rupee(wi.costPerBillMin)} accent={wi.costPerBillMin < charge ? '#34d399' : '#f87171'} />
        <Card title="Margin / min" value={rupee(wi.marginPerMin)} accent="#34d399" />
        <Card title="Billable hours / mo" value={`${(wi.mBill / 60).toFixed(0)} h`} />
        <Card title="Projected margin / mo" value={rupee(wi.monthlyMargin)} accent={wi.monthlyMargin >= 0 ? '#34d399' : '#f87171'} />
      </div>
      <div className="note">At <b>{hrs} h/day × {wdays} days</b>: cost ≈ <b>{rupee(wi.costPerBillMin)}/min</b> vs charge {rupee(charge)}/min. Fixed cost stays the same — every extra cutting hour spreads it thinner and widens the margin.</div>
    </div>
  )
}

// Inline SVG tube icon — round when section starts with R (e.g. R25), rect/square otherwise.
function TubeIcon({ section }) {
  const isRound = /^R/i.test(section || '')
  if (isRound) {
    return (
      <div className="particon" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="16" stroke="#2dd4ee" strokeWidth="3" />
          <circle cx="20" cy="20" r="9" stroke="#2dd4ee" strokeWidth="1.5" strokeDasharray="3 2" opacity=".45" />
        </svg>
      </div>
    )
  }
  return (
    <div className="particon" aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="10" width="32" height="20" rx="2" stroke="#2dd4ee" strokeWidth="3" />
        <rect x="10" y="15" width="20" height="10" rx="1" stroke="#2dd4ee" strokeWidth="1.5" strokeDasharray="3 2" opacity=".45" />
      </svg>
    </div>
  )
}

function Parts({ jobs, days, cfg, role }) {
  const allDays = useMemo(() => daysWithJobs(jobs), [jobs])
  const [day, setDay] = useState(() => allDays[0] || '')
  const [q, setQ] = useState('')
  const [manifest, setManifest] = useState(null)
  const [manifestBusy, setManifestBusy] = useState(false)
  const [manifestMsg, setManifestMsg] = useState('')

  // Keep day in sync if jobs load after initial render
  const effectiveDay = allDays.includes(day) ? day : (allDays[0] || '')

  const cards = useMemo(() => buildParts(jobs, { day: effectiveDay }), [jobs, effectiveDay])
  const machineOptions = useMemo(() => {
    if (!manifest) return new Map()
    const merged = mergeMachineManifest(programOptions(jobs), manifest)
    return new Map(merged
      .filter((option) => option.runs > 0)
      .map((option) => [normFile(option.fileName), option]))
  }, [jobs, manifest])
  const visualCards = useMemo(() => cards.map((card) => {
    const option = machineOptions.get(normFile(card.fileName))
    const machineAmbiguous = Boolean(option?.machineCandidates?.length)
    const previews = machineAmbiguous ? [] : programPreviews(option)
    const machine = option?.machine || null
    return {
      ...card,
      machinePreview: previews[0]?.dataUrl || '',
      machineDetails: machine?.details || null,
      machineMatched: Boolean(machine),
      machineAmbiguous,
    }
  }), [cards, machineOptions])

  useEffect(() => {
    loadMachineManifest()
      .then((stored) => setManifest(stored))
      .catch(() => setManifest(null))
  }, [])

  const onManifest = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setManifestBusy(true)
    setManifestMsg('')
    try {
      const next = parseMachineManifest(await file.text())
      await saveMachineManifest(next)
      setManifest(next)
      setManifestMsg(`Imported ${fmt(next.programs.length)} machine programs on this browser.`)
    } catch (error) {
      setManifestMsg(`Could not import: ${error.message}`)
    } finally {
      setManifestBusy(false)
      e.target.value = ''
    }
  }

  // Monthly cost basis — computed once per full dataset unconditionally (hook rule).
  // Render is gated on role==='owner' below; the hook itself must always run.
  const mo = useMemo(() => monthlyCost(days || [], cfg || {}, jobs || []), [days, cfg, jobs])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return visualCards
    return visualCards.filter((c) => (c.label + ' ' + c.sizeKey + ' ' + c.section).toLowerCase().includes(t))
  }, [visualCards, q])
  const matchedCount = visualCards.filter((card) => card.machinePreview).length
  const profileOnlyCount = visualCards.filter((card) =>
    card.machineMatched && !card.machinePreview).length

  return (
    <div>
      <h2>Parts ({fmt(cards.length)} types · {fmt(cards.reduce((a, c) => a + c.pieces, 0))} pcs)</h2>
      <div className={`manifestbar parts-manifest${manifest ? ' active' : ''}`}>
        <div>
          <strong>{manifest
            ? `${fmt(matchedCount)} of ${fmt(visualCards.length)} parts have an exact machine drawing`
            : 'Machine drawings are not loaded on this browser'}</strong>
          <span>{manifest
            ? `${fmt(manifest.programs.length)} programs available · ${fmt(profileOnlyCount)} exact ${profileOnlyCount === 1 ? 'package has' : 'packages have'} profile data only`
            : 'Import the extracted machine manifest once to show drawings beside production quantities'}</span>
          {manifestMsg && <span className={`manifest-message${manifestMsg.startsWith('Could not') ? ' error' : ''}`}>{manifestMsg}</span>}
        </div>
        <label className="btn secondary compact">
          {manifest ? 'Replace manifest' : 'Import manifest'}
          <input type="file" accept="application/json,.json" onChange={onManifest} disabled={manifestBusy} />
        </label>
      </div>
      <div className="partpicker">
        <select value={effectiveDay} onChange={(e) => setDay(e.target.value)} aria-label="Select day">
          {allDays.length ? allDays.map((d) => (
            <option key={d} value={d}>{prettyYmd(d)}</option>
          )) : <option value="">No data</option>}
        </select>
        <input className="search" style={{ margin: 0, flex: 2, minWidth: 160 }}
          placeholder="Search label, size…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!filtered.length && <div className="note">{allDays.length ? 'No parts match.' : 'No production data yet.'}</div>}
      <div className="joblist">
        {filtered.map((c) => {
          // ₹ costing — owner only, computed per card
          let costPerPc = null, pricePerPc = null, marginPerPc = null
          if (role === 'owner' && c.secPerPiece > 0 && c.pieces > 0) {
            const qr = quoteJob({ secPerPiece: c.secPerPiece, qty: c.pieces, setupType: 'none', cfg: cfg || {}, costPerBillMin: mo.costPerBillMin, chargePerMin: (cfg || {}).chargePerMin })
            const n = c.pieces
            // Analytics view (what was actually cut), NOT a customer quote: use rawCharge so the
            // ₹500 min-order floor doesn't inflate per-piece price/margin on small-batch cards.
            costPerPc = qr.quoteCost / n
            pricePerPc = qr.rawCharge / n
            marginPerPc = (qr.rawCharge - qr.quoteCost) / n
          }
          const lengthStr = c.length != null ? `${c.length} mm · ` : ''
          const thkStr = c.thickness != null ? `t${c.thickness} mm` : (c.sizeKey || '')
          return (
            <div className="jobcard" key={c.key}>
              <div className="jobcard-head">
                <div className="partvisuals">
                  {c.catPhoto && <img className="jobthumb" src={c.catPhoto} alt={`${c.label} product`} />}
                  {c.machinePreview && <img className="jobthumb machinepreview" src={c.machinePreview} alt={`${c.fileName} cutting drawing`} />}
                  {!c.catPhoto && !c.machinePreview && (
                    c.machineDetails
                      ? <TubeProfileVisual details={c.machineDetails} />
                      : <TubeIcon section={c.section || c.sizeKey} />
                  )}
                </div>
                <span className={'chip' + (c.hasSize ? '' : ' warn')}>{c.label}</span>
                <span className="jobcard-when">×{fmt(c.pieces)}</span>
              </div>
              <div className="jobcard-sub">{lengthStr}{thkStr}{c.runs > 1 ? ` · (${c.runs} runs)` : ''}</div>
              {c.machinePreview && <div className="part-match">Exact machine drawing · {c.fileName}</div>}
              {c.machineMatched && !c.machinePreview && (
                <div className="part-match profile-only">Exact machine package · profile only (thumbnail missing) · {c.fileName}</div>
              )}
              {c.machineAmbiguous && <div className="part-match ambiguous">Drawing hidden: filename collision</div>}
              <div className="jobcard-stats">
                <div><b>{c.totalMin.toFixed(1)}</b><span>min</span></div>
                <div><b>{c.pcsPerMin > 0 ? c.pcsPerMin.toFixed(1) : '—'}</b><span>/min</span></div>
                <div><b>{c.secPerPiece > 0 ? c.secPerPiece.toFixed(1) : '—'}</b><span>s/pc</span></div>
                <div><b>{fmt(c.pieces)}</b><span>pcs</span></div>
              </div>
              {role === 'owner' && costPerPc != null && (
                <div className="partcard-cost">
                  cost {rupee(costPerPc)}/pc · price {rupee(pricePerPc)}/pc · margin {rupee(marginPerPc)}/pc
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const Sep = () => <div className="sep" />

function Production({ jobs, vjobs, cfg, mo }) {
  return (<div><Jobs jobs={jobs} /><Sep /><BySize jobs={vjobs} cfg={cfg} mo={mo} /></div>)
}
function WeightCalc({ cfg }) {
  const [shape, setShape] = useState('rect')
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [d, setD] = useState('')
  const [t, setT] = useState(''); const [len, setLen] = useState(''); const [qty, setQty] = useState(1)
  const [mat, setMat] = useState('MS')
  const m = cfg.material || {}
  const density = mat === 'SS' ? (m.densitySS ?? 8.0) : (m.densityMS ?? 7.85)
  const rate = mat === 'SS' ? (m.ratePerKgSS ?? 220) : (m.ratePerKgMS ?? 80)
  const section = shape === 'rect' ? `${a}x${b}` : `R${d}`
  const g = tubeWeightGrams({ section, thickness: t, length: len, density })
  const pieceKg = g != null ? g / 1000 : null
  const orderKg = pieceKg != null ? pieceKg * (qty || 0) : null
  return (
    <div>
      <h2>Weight & material</h2>
      <div className="note">Auto weight of a cut piece from the tube size. Material is billed separately — this gives you the figure.</div>
      <div className="quote">
        <label>Tube shape
          <select value={shape} onChange={(e) => setShape(e.target.value)}><option value="rect">Rectangular / square</option><option value="round">Round</option></select>
        </label>
        {shape === 'rect' ? (
          <div className="quote" style={{ gridTemplateColumns: '1fr 1fr', margin: 0 }}>
            <label>Side A (mm)<input type="number" value={a} onChange={(e) => setA(e.target.value)} /></label>
            <label>Side B (mm)<input type="number" value={b} onChange={(e) => setB(e.target.value)} /></label>
          </div>
        ) : <label>Outer diameter (mm)<input type="number" value={d} onChange={(e) => setD(e.target.value)} /></label>}
        <div className="quote" style={{ gridTemplateColumns: '1fr 1fr', margin: 0 }}>
          <label>Wall thickness (mm)<input type="number" value={t} onChange={(e) => setT(e.target.value)} /></label>
          <label>Cut length (mm)<input type="number" value={len} onChange={(e) => setLen(e.target.value)} /></label>
        </div>
        <div className="quote" style={{ gridTemplateColumns: '1fr 1fr', margin: 0 }}>
          <label>Quantity<input type="number" value={qty} onChange={(e) => setQty(+e.target.value || 0)} /></label>
          <label>Material<select value={mat} onChange={(e) => setMat(e.target.value)}><option value="MS">Mild steel</option><option value="SS">Stainless</option></select></label>
        </div>
      </div>
      {pieceKg != null ? (
        <div className="grid">
          <Card title="Per piece" value={`${pieceKg.toFixed(3)} kg`} />
          <Card title="Per piece material" value={rupee(pieceKg * rate)} sub={`@ ${rupee(rate)}/kg`} />
          <Card title={`Order weight (${fmt(qty)} pcs)`} value={`${orderKg.toFixed(1)} kg`} accent="#34d399" />
          <Card title="Order material" value={rupee(orderKg * rate)} accent="#34d399" />
        </div>
      ) : <div className="note">Enter the tube size, wall thickness and cut length to get the weight.</div>}
    </div>
  )
}
function CostingTab({ jobs, days, cfg, mo, rateHistory }) {
  return (<div><Costing jobs={jobs} cfg={cfg} mo={mo} /><Sep /><WeightCalc cfg={cfg} /><Sep /><Margin days={days} cfg={cfg} mo={mo} rateHistory={rateHistory} /></div>)
}
function Users() {
  const [list, setList] = useState(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('meter')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => listUsers().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const add = async () => {
    if (!email.trim()) { setMsg('Enter an email.'); return }
    setBusy(true); setMsg('')
    try { await saveUser({ email, role, active: true }); setEmail(''); setMsg('✓ Added'); await load() }
    catch (e) { setMsg('Could not save: ' + e.message) }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2>Users &amp; access</h2>
      <div className="note"><b>Meter</b> = staff, sees only the meter screen. <b>Owner</b> = full access. You (bootstrap owner) are always allowed.</div>
      <div className="quote">
        <label>Google email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" /></label>
        <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="meter">Meter (staff)</option><option value="owner">Owner</option></select></label>
      </div>
      <button className="btn" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add user'}</button>
      {msg && <div className="note" style={{ color: msg[0] === '✓' ? '#34d399' : '#f87171' }}>{msg}</div>}
      <div className="tbl">
        <div className="tr th"><span>Email</span><span>Role</span><span>Active</span><span /><span /></div>
        {(list || []).map((u) => <div className="tr" key={u.id}><span>{u.email || u.id}</span><span>{u.role || 'owner'}</span><span>{u.active ? 'yes' : 'no'}</span><span /><span /></div>)}
        {list && !list.length && <div className="tr"><span>No staff added yet.</span><span /><span /><span /><span /></div>}
      </div>
    </div>
  )
}
// Owner-editable cost rates. Writes the raw fields onto laser_config/settings; the app's
// costing recomputes from them, so a saved change flows into Costing + Dashboard on refresh.
// Field label + [min, max] sanity bound. A value outside the bound is rejected (a typo like
// rent=3000000 or charge=4 would otherwise silently corrupt every quote).
const RATE_FIELDS = [
  ['chargePerMin', 'Charge ₹/min (price)', [1, 5000]], ['operator', 'Operator salary ₹/mo', [0, 5000000]],
  ['rent', 'Rent ₹/mo', [0, 5000000]], ['maintenance', 'Maintenance ₹/mo', [0, 5000000]],
  ['consumables', 'Consumables ₹/mo', [0, 5000000]], ['depreciationMonthly', 'Depreciation ₹/mo', [0, 5000000]],
  ['electricityRate', 'Electricity ₹/unit', [1, 200]], ['sizeChangesPerDay', 'Size changes / cutting day', [0, 50]],
  ['dimensionChangeMin', 'Size-change setup (min)', [0, 240]], ['loadSecPerTube', 'Loading sec / tube', [0, 600]],
  ['qcPct', 'QC buffer %', [0, 100]], ['rejectionPct', 'Reject yield %', [0, 50]],
  ['programmingMin', 'New-part programming (min)', [0, 600]], ['minOrderCharge', 'Minimum order ₹', [0, 1000000]],
  ['utilTargetPct', 'Utilization target %', [0, 100]],
]
function Rates({ cfg, onSaved, userEmail }) {
  const f0 = cfg.monthlyFixed || {}, s0 = cfg.setup || {}
  const OLD = {
    chargePerMin: cfg.chargePerMin ?? 40, electricityRate: cfg.electricityRate ?? 14,
    operator: f0.operator ?? 0, rent: f0.rent ?? 0, maintenance: f0.maintenance ?? 0, consumables: f0.consumables ?? 0,
    depreciationMonthly: cfg.depreciationMonthly ?? 0,
    sizeChangesPerDay: s0.sizeChangesPerDay ?? 5.5, dimensionChangeMin: s0.dimensionChangeMin ?? 40, loadSecPerTube: s0.loadSecPerTube ?? 18,
    qcPct: cfg.qcPct ?? 12, rejectionPct: cfg.rejectionPct ?? 2, programmingMin: cfg.programmingMin ?? 25,
    minOrderCharge: cfg.minOrderCharge ?? 500, utilTargetPct: cfg.utilTargetPct ?? 50,
  }
  const [v, setV] = useState({ ...OLD })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }))
  const save = async () => {
    setMsg('')
    // 1) validate: every field must be a finite number inside its bound
    const bad = []
    for (const [k, label, [lo, hi]] of RATE_FIELDS) {
      const n = Number(v[k])
      if (v[k] === '' || !Number.isFinite(n) || n < lo || n > hi) bad.push(`${label} must be ${lo}–${hi}`)
    }
    if (bad.length) { setMsg('Fix: ' + bad.join('; ')); return }
    // 2) build old->new diff; nothing to do if unchanged
    const changes = RATE_FIELDS
      .filter(([k]) => Number(v[k]) !== Number(OLD[k]))
      .map(([k, label]) => ({ field: label, old: Number(OLD[k]), new: Number(v[k]) }))
    if (!changes.length) { setMsg('No changes to save.'); return }
    // 3) confirm old->new before touching the live pricing basis
    if (!window.confirm('Save these rate changes?\n\n' + changes.map((c) => `${c.field}: ${c.old} → ${c.new}`).join('\n'))) return
    const n = (k) => Number(v[k])
    setBusy(true)
    try {
      await saveConfig({
        chargePerMin: n('chargePerMin'), electricityRate: n('electricityRate'),
        monthlyFixed: { ...f0, operator: n('operator'), rent: n('rent'), maintenance: n('maintenance'), consumables: n('consumables') },
        depreciationMonthly: n('depreciationMonthly'),
        setup: { ...s0, sizeChangesPerDay: n('sizeChangesPerDay'), dimensionChangeMin: n('dimensionChangeMin'), loadSecPerTube: n('loadSecPerTube') },
        qcPct: n('qcPct'), rejectionPct: n('rejectionPct'), programmingMin: n('programmingMin'),
        minOrderCharge: n('minOrderCharge'), utilTargetPct: n('utilTargetPct'),
      }, { by: userEmail || '', changes })
      setMsg('✓ Saved — refreshing…'); onSaved && onSaved()
    } catch (e) { setMsg('Could not save: ' + e.message) }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2>Cost rates</h2>
      <div className="note">Change a rate and Save — Costing &amp; Dashboard recompute on the next refresh. You'll be asked to confirm each change; every edit is logged.</div>
      <div className="quote">
        {RATE_FIELDS.map(([k, label]) => <label key={k}>{label}<input type="number" inputMode="decimal" value={v[k]} onChange={set(k)} /></label>)}
      </div>
      <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rates'}</button>
      {msg && <div className="note" style={{ color: msg[0] === '✓' ? '#34d399' : '#f87171' }}>{msg}</div>}
    </div>
  )
}
function Admin({ meta, days, jobs, cfg, userEmail, onSaved, onCatalogSaved, onRatesSaved }) {
  return (<div><Rates cfg={cfg} onSaved={onRatesSaved} userEmail={userEmail} /><Sep /><MeterEntry /><Sep /><JobCatalog jobs={jobs} onSaved={onCatalogSaved} /><Sep /><Users /><Sep /><Assign jobs={jobs} onSaved={onSaved} /><Sep /><Machine meta={meta} days={days} jobs={jobs} /></div>)
}

/* ---------- shell ---------- */
const TABS = ['Quote', 'Parts', 'Library', 'Dashboard', 'Utilization', 'Production', 'Costing', 'Reports', 'Admin']
const PERIODS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['lastMonth', 'Last month'], ['all', 'All']]
// Real UNICO logo (maroon-on-white) in a white badge — replaces the old text wordmark. base-aware.
const LOGO = import.meta.env.BASE_URL + 'unico-logo.png'
function Brand() {
  return (<span className="brand"><img className="brandlogo" src={LOGO} alt="UNICO" /><span className="ttl">Laser</span></span>)
}
function Login() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="app"><div className="login">
      <div><Brand /></div>
      <p>Production, utilization & costing — sign in to view.</p>
      <button className="btn wa" disabled={busy} onClick={async () => { setBusy(true); try { await signInWithGoogle() } catch (e) { alert(e.message); setBusy(false) } }}>{busy ? 'Opening…' : 'Sign in with Google'}</button>
    </div></div>
  )
}
function Unauthorized({ email }) {
  return (
    <div className="app"><div className="login">
      <div><Brand /></div>
      <p className="err"><b>{email}</b> isn't authorized for this app.</p>
      <p className="note">Ask the admin to add your email, then sign in again.</p>
      <button className="btn" onClick={signOutUser}>Sign out</button>
    </div></div>
  )
}

function MeterEntry() {
  const [date, setDate] = useState(() => businessDateKey())
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const save = async () => {
    if (a === '' || b === '') { setMsg('Enter both meter readings.'); return }
    const ma = Number(a), mb = Number(b)
    if (!Number.isFinite(ma) || !Number.isFinite(mb) || ma < 0 || mb < 0) { setMsg('Enter valid meter readings (positive numbers only).'); return }
    setBusy(true); setMsg('')
    try { await saveMeterReading({ date, meterA: ma, meterB: mb, note }); setMsg('✓ Saved. Thank you!'); setNote('') }
    catch (e) { setMsg('Could not save: ' + e.message) }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2>Daily meter reading</h2>
      <div className="note">Enter today's two meter totals (the full number on each meter).</div>
      <div className="quote">
        <label>Date
          <input type="date" value={date} max={businessDateKey()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>Meter 1 — machine + UPS + dust collector
          <input type="number" inputMode="decimal" value={a} placeholder="e.g. 2101" onChange={(e) => setA(e.target.value)} />
        </label>
        <label>Meter 2 — air compressor
          <input type="number" inputMode="decimal" value={b} placeholder="e.g. 5157" onChange={(e) => setB(e.target.value)} />
        </label>
        <label>Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button className="btn wa" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save reading'}</button>
      {msg && <div className="note" style={{ color: msg[0] === '✓' ? '#34d399' : '#f87171' }}>{msg}</div>}
    </div>
  )
}

function TubeProfileVisual({ details = {}, large = false }) {
  const section = String(details.section || '').toLowerCase()
  const shape = section.includes('circle') || section.includes('round')
    ? 'circle'
    : section.includes('rect')
      ? 'rect'
      : section.includes('square')
        ? 'square'
        : 'shaped'
  const label = `${details.section || 'Tube'} profile`
  return (
    <span className={`tube-profile ${shape}${large ? ' large' : ''}`} role="img" aria-label={label}>
      <i />
    </span>
  )
}

export function JobCatalog({ jobs: suppliedJobs = null, catalog: suppliedCatalog = null, onSaved }) {
  const [list, setList] = useState(null)
  const [opts, setOpts] = useState([])
  const [historyOpts, setHistoryOpts] = useState([])
  const [manifest, setManifest] = useState(null)
  const [q, setQ] = useState('')
  const [programQ, setProgramQ] = useState('')
  const [programFilter, setProgramFilter] = useState('machine')
  const [visiblePrograms, setVisiblePrograms] = useState(40)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [photo, setPhoto] = useState('')
  const [fileName, setFileName] = useState('')
  const [sizeKey, setSizeKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    const catalog = suppliedCatalog || await loadCatalog().catch(() => [])
    try {
      let sourceJobs = suppliedJobs
      if (!sourceJobs) {
        const [rawJobs, map] = await Promise.all([loadJobs(), loadSizeMap()])
        sourceJobs = enrichJobs(rawJobs || [], map)
      }
      const localManifest = await loadMachineManifest().catch(() => null)
      const history = programOptions(sourceJobs || [], catalog)
      setList(catalog)
      setHistoryOpts(history)
      setManifest(localManifest)
      setOpts(mergeMachineManifest(history, localManifest, catalog))
    } catch {
      setList(catalog)
      setOpts([])
    }
  }
  useEffect(() => {
    load()
    // suppliedJobs is stable in the owner shell; staff use the existing cached loader.
  }, [suppliedJobs, suppliedCatalog])
  useEffect(() => {
    setVisiblePrograms(40)
  }, [programFilter, programQ])

  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    try { setPhoto(await compressImage(file)) }
    catch { setMsg('Could not read that photo.') }
  }
  const onManifest = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setBusy(true); setMsg('')
    try {
      const next = parseMachineManifest(await file.text())
      await saveMachineManifest(next)
      setManifest(next)
      setOpts(mergeMachineManifest(historyOpts, next, list || suppliedCatalog || []))
      setMsg(`✓ Imported ${fmt(next.programs.length)} machine programs on this device.`)
    } catch (error) {
      setMsg(`Could not import: ${error.message}`)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }
  const clear = () => {
    setId(''); setName(''); setPhoto(''); setFileName(''); setSizeKey(''); setProgramQ('')
  }
  const optionMatchesFile = (option, value) => {
    const key = normFile(value)
    return normFile(option?.fileName) === key
      || programMachines(option).some((machine) => normFile(machine.fileName) === key)
  }
  const selectProgram = (option) => {
    setFileName(option.machine?.fileName || option.fileName)
    setSizeKey(option.sizeKey || '')
    setMsg(option.machineCandidates?.length
      ? `${option.machineCandidates.length} different machine files use this filename. Rename one on the machine before linking a product photo.`
      : '')
    if (option.linkedId) {
      const linked = (list || []).find((item) => item.id === option.linkedId)
      if (linked) {
        setId(linked.id)
        setName(linked.name || '')
        setPhoto(linked.photo || '')
      }
    } else {
      if (id) { setName(''); setPhoto('') }
      setId('')
    }
  }
  const edit = (item) => {
    setId(item.id || '')
    setName(item.name || '')
    setPhoto(item.photo || '')
    setFileName(item.fileName || '')
    setSizeKey(item.sizeKey || '')
    setProgramQ(item.fileName || '')
    setMsg(item.fileName ? 'Editing exact program link.' : 'Choose the exact machine program to upgrade this size-only card.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const save = async () => {
    if (!name.trim()) { setMsg('Give the job a name.'); return }
    if (!fileName) { setMsg('Select the exact machine program for this product.'); return }
    if (!photo) { setMsg('Take or choose a product photo first.'); return }
    const selectedOption = opts.find((option) => optionMatchesFile(option, fileName))
    if (selectedOption?.machineCandidates?.length) {
      setMsg('This filename belongs to different machine files. Rename one on the machine before linking a photo.')
      return
    }
    setBusy(true); setMsg('')
    try {
      const exactMachineFile = selectedOption?.machine?.fileName || fileName
      await saveCatalogJob({ id, name, photo, sizeKey, fileName: exactMachineFile, matchMode: 'file' })
      clear()
      setMsg('✓ Photo linked to the exact machine program.')
      await load()
      onSaved && onSaved()
    } catch (e) { setMsg('Could not save: ' + e.message) }
    finally { setBusy(false) }
  }

  const rows = (list || []).filter((item) =>
    !q || `${item.name} ${item.sizeKey || ''} ${item.fileName || ''}`.toLowerCase().includes(q.toLowerCase()))
  const search = programQ.trim().toLowerCase()
  const machineOptions = filterProgramOptions(opts, 'machine')
  const filteredOptions = filterProgramOptions(opts, programFilter)
  const matchingOptions = search
    ? filteredOptions.filter((option) =>
      `${option.fileName} ${option.machine?.fileName || ''} ${option.sizeKey} ${option.linkedName}`.toLowerCase().includes(search))
    : filteredOptions
  const picker = matchingOptions.slice(0, visiblePrograms)
  const linkedCount = machineOptions.filter((option) => option.linkedId).length
  const embeddedCount = (manifest?.programs || []).filter((program) =>
    program.previews?.some((preview) => preview.dataUrl) || program.preview?.dataUrl).length
  const profileOnlyCount = Math.max(0, (manifest?.programs?.length || 0) - embeddedCount)
  const ambiguousCount = filterProgramOptions(opts, 'ambiguous').length
  const filterTabs = [
    { id: 'machine', label: 'Machine', count: machineOptions.length },
    { id: 'product', label: 'Product', count: filterProgramOptions(opts, 'product').length },
    { id: 'geometry', label: 'Geometry', count: filterProgramOptions(opts, 'geometry').length },
    { id: 'profile', label: 'Profile', count: filterProgramOptions(opts, 'profile').length },
    ...(ambiguousCount ? [{ id: 'ambiguous', label: 'Ambiguous', count: ambiguousCount }] : []),
    { id: 'history', label: 'History', count: filterProgramOptions(opts, 'history').length },
  ]
  const selected = opts.find((option) => optionMatchesFile(option, fileName))
  const selectedMachines = programMachines(selected)
  const selectedMachine = selectedMachines[0] || null
  const selectedPreviews = programPreviews(selected)
  const selectedPreview = selectedPreviews[0]?.dataUrl || ''
  const visiblePreviews = selectedPreviews.slice(0, 12)
  const ambiguousSelection = Boolean(selected?.machineCandidates?.length)
  const selectedDetails = selected?.machine?.details || {}
  const showNumber = (value, suffix = '') => value == null || !Number.isFinite(Number(value))
    ? '-'
    : `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`

  return (
    <div>
      <h2>Visual job library</h2>
      <div className="library-summary">
        <div><strong>{fmt(manifest?.programs?.length || machineOptions.length)}</strong><span>cutting files</span></div>
        <div><strong>{fmt(embeddedCount)}</strong><span>matched geometry</span></div>
        <div><strong>{fmt(linkedCount)}</strong><span>product photos</span></div>
        <div><strong>{fmt(profileOnlyCount)}</strong><span>profile only</span></div>
      </div>
      <div className="manifestbar">
        <div>
          <strong>{manifest ? `${fmt(manifest.programs.length)} programs imported` : 'Machine manifest not imported'}</strong>
          <span>{manifest?.generatedAt
            ? `Generated ${manifest.generatedAt.replace('T', ' ').slice(0, 16)} · ${fmt(manifest.inventory?.previewsEmbedded || 0)} views · ${fmt(embeddedCount)} files with exact geometry`
            : 'Device-local staging; nothing is uploaded'}</span>
        </div>
        <label className="btn secondary compact">
          Import manifest
          <input type="file" accept="application/json,.json" onChange={onManifest} disabled={busy} />
        </label>
      </div>
      <div className="quote">
        <label>Job name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Varun table leg" /></label>
        <label>Product photo<input type="file" accept="image/*" capture="environment" onChange={onPhoto} /></label>
        {photo && <img src={photo} alt="" className="catimg" />}
      </div>
      <div className="programwrap">
        <div className="programhead">
          <span>{fmt(matchingOptions.length)} {programFilter === 'history' ? 'history programs' : 'machine programs'}</span>
          {fileName && <button type="button" className="textbtn" onClick={() => { setFileName(''); setSizeKey('') }}>Clear selection</button>}
        </div>
        <div className="programfilters" role="group" aria-label="Program image filter">
          {filterTabs.map((filter) => (
            <button type="button" key={filter.id} className={programFilter === filter.id ? 'on' : ''}
              aria-pressed={programFilter === filter.id} onClick={() => setProgramFilter(filter.id)}>
              <span>{filter.label}</span><b>{fmt(filter.count)}</b>
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search filename, size, or product name" value={programQ} onChange={(e) => setProgramQ(e.target.value)} />
        <div className="programpick">
          {picker.map((option) => {
            const machines = programMachines(option)
            const previews = programPreviews(option)
            const preview = option.linkedPhoto || previews[0]?.dataUrl || ''
            const imageKind = programImageKind(option)
            const isSelected = optionMatchesFile(option, fileName)
            return (
              <button type="button" key={option.key}
                className={'programbtn' + (isSelected ? ' on' : '') + (option.linkedId ? ' linked' : '') + (preview || machines.length ? ' hasvisual' : '')}
                onClick={() => selectProgram(option)}>
                {preview
                  ? <img src={preview} alt={option.linkedPhoto ? option.linkedName || option.fileName : `${option.fileName} cutting geometry`}
                    className={option.linkedPhoto ? '' : 'machinepreview'} />
                  : machines.length
                    ? <TubeProfileVisual details={machines[0].details} />
                    : null}
                <span className="programcopy">
                  <strong>{option.linkedName || option.fileName}</strong>
                  {option.linkedName && <small>{option.machine?.fileName || option.fileName}</small>}
                  <small>{option.sizeKey || option.machine?.details?.section || 'Unlabelled'} · {fmt(option.pieces)} pcs · {option.lastDay ? prettyYmd(option.lastDay) : 'not in run history'}</small>
                </span>
                <span className="programstate">{option.machineCandidates?.length
                  ? 'Ambiguous'
                  : imageKind === 'product' ? 'Product'
                    : imageKind === 'geometry' ? 'Geometry'
                      : imageKind === 'profile' ? 'Profile'
                        : 'History'}</span>
              </button>
            )
          })}
          {!picker.length && <div className="note">{opts.length ? 'No program matches that search.' : 'No cutting programs are available yet.'}</div>}
        </div>
        {picker.length < matchingOptions.length && (
          <button type="button" className="btn secondary compact programmore"
            onClick={() => setVisiblePrograms((count) => count + 40)}>
            Show {fmt(Math.min(40, matchingOptions.length - picker.length))} more
          </button>
        )}
      </div>
      {fileName && (
        <div className="program-detail">
          <div className="selected-program">
            <span>Selected program</span><strong>{selectedMachine?.fileName || fileName}</strong>
            <small>{sizeKey || selectedDetails.section || 'Unlabelled size'}</small>
          </div>
          {(photo || selectedPreview || selectedMachines.length > 0) && (
            <div className="program-images">
              {photo && <figure><img src={photo} alt="" /><figcaption>Product photo</figcaption></figure>}
              {visiblePreviews.map((preview, index) => {
                const variantViews = selectedPreviews.filter((item) => item.machineIndex === preview.machineIndex)
                const variantIndex = variantViews.indexOf(preview) + 1
                return (
                  <figure key={`${preview.machineIndex}-${preview.sha256 || preview.sourcePath || index}`}>
                    <img src={preview.dataUrl} alt={`${selectedMachine?.fileName || fileName} cutting geometry`} className="machinepreview" />
                    <figcaption>{selectedMachines.length > 1
                      ? `Variant ${preview.machineIndex + 1} · view ${variantIndex} of ${variantViews.length}`
                      : `Machine view ${index + 1} of ${selectedPreviews.length}`}</figcaption>
                  </figure>
                )
              })}
              {!selectedPreviews.length && selectedMachines.map((machine, index) => (
                <figure key={machine.sha256 || machine.sourcePath || index}>
                  <TubeProfileVisual details={machine.details} large />
                  <figcaption>{selectedMachines.length > 1 ? `Variant ${index + 1} · profile only` : 'Machine profile only'}</figcaption>
                </figure>
              ))}
              {selectedPreviews.length > visiblePreviews.length && (
                <div className="preview-more">+{fmt(selectedPreviews.length - visiblePreviews.length)} more geometry views in the manifest</div>
              )}
            </div>
          )}
          <div className="program-metrics">
            <div><span>Observed speed</span><strong>{showNumber(selected?.secPerPiece, ' sec/pc')}</strong></div>
            <div><span>Historical output</span><strong>{selected ? `${fmt(selected.pieces)} pcs` : '-'}</strong></div>
            <div><span>Runs</span><strong>{selected ? fmt(selected.runs) : '-'}</strong></div>
            <div><span>Pierces</span><strong>{selected ? fmt(selected.pierces) : '-'}</strong></div>
            <div><span>Tube length</span><strong>{showNumber(selectedDetails.tubeLength ?? selected?.tubeLength, ' mm')}</strong></div>
            <div><span>Thickness</span><strong>{showNumber(selectedDetails.thickness ?? selected?.thickness, ' mm')}</strong></div>
            <div><span>Part length</span><strong>{showNumber(selectedDetails.partLength, ' mm')}</strong></div>
            <div><span>Last cut</span><strong>{selected?.lastDay ? prettyYmd(selected.lastDay) : '-'}</strong></div>
            <div><span>Nested parts</span><strong>{showNumber(selectedDetails.quantity)}</strong></div>
            <div><span>Program saved (IST)</span><strong>{selected?.machine?.savedAtIst ? selected.machine.savedAtIst.slice(0, 16) : '-'}</strong></div>
          </div>
          {selectedMachine && !ambiguousSelection && (
            <div className="machine-evidence">
              <strong>{selectedMachine.sourceApp}{selectedMachine.sourceVersion ? ` ${selectedMachine.sourceVersion}` : ''}</strong>
              <span>{selectedPreviews.length
                ? `${fmt(selectedPreviews.length)} embedded geometry view${selectedPreviews.length === 1 ? '' : 's'}`
                : 'Profile visual generated from machine metadata'}</span>
            </div>
          )}
          {ambiguousSelection && (
            <div className="machine-evidence ambiguous">
              <strong>Filename collision</strong>
              <span>{fmt(selected.machineCandidates.length)} different machine files have this exact name. Automatic metadata and photo matching are disabled.</span>
            </div>
          )}
        </div>
      )}
      <button className="btn wa" disabled={busy || !name.trim() || !photo || !fileName || ambiguousSelection} onClick={save}>{busy ? 'Saving…' : (id ? 'Update photo link' : 'Link photo to program')}</button>
      {msg && <div className="note" style={{ color: msg[0] === '✓' ? '#34d399' : '#f87171' }}>{msg}</div>}
      <h2>Saved visual jobs ({rows.length})</h2>
      <input className="search" placeholder="Search saved name, program, or size" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="catgrid">
        {rows.map((item) => {
          const option = opts.find((candidate) => optionMatchesFile(candidate, item.fileName))
          const machine = programMachines(option)[0]
          const cardImage = item.photo || programPreviews(option)[0]?.dataUrl || ''
          return (
          <div className="catcard" key={item.id}>
            {cardImage
              ? <img src={cardImage} alt={item.name} className={item.photo ? '' : 'machinepreview'} />
              : machine
                ? <TubeProfileVisual details={machine.details} large />
                : <div className="catnoimg">no photo</div>}
            <div className="catname">{item.name}</div>
            <div className="catfile">{item.fileName || item.sizeKey || 'Not linked'}</div>
            {item.sizeKey && item.fileName && <div className="catmeta">{item.sizeKey}</div>}
            <button type="button" className="catedit" onClick={() => edit(item)}>{item.fileName ? 'Edit link' : 'Choose exact program'}</button>
          </div>
          )
        })}
        {list && !rows.length && <div className="note">No visual jobs saved yet.</div>}
        {!list && <div className="note">Loading…</div>}
      </div>
    </div>
  )
}

function StaffMeter({ user }) {
  const [t, setT] = useState('Meter')
  return (
    <div className="app">
      <header className="top"><Brand />
        <button className="signout" onClick={signOutUser} title="Sign out" style={{ marginLeft: 'auto' }}>Sign out</button>
      </header>
      <main>{t === 'Meter' ? <MeterEntry /> : <JobCatalog />}<div className="note">Signed in as {user.email}</div></main>
      <nav className="tabs">
        <button className={t === 'Meter' ? 'on' : ''} onClick={() => setT('Meter')}>Meter</button>
        <button className={t === 'Jobs' ? 'on' : ''} onClick={() => setT('Jobs')}>Jobs</button>
      </nav>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState('Quote')
  const [period, setPeriod] = useState('month')
  const [customDate, setCustomDate] = useState('')
  const [core, setCore] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [sizeMap, setSizeMap] = useState({})
  const [catalog, setCatalog] = useState([])
  const [err, setErr] = useState('')
  const [user, setUser] = useState(undefined) // undefined = checking, null = signed out
  const [role, setRole] = useState(undefined) // undefined=checking, null=not allowed, 'owner'|'meter'
  const [refreshKey, setRefreshKey] = useState(0)
  const [histSyncing, setHistSyncing] = useState(false)
  const allowed = role === 'owner' || role === 'meter'

  useEffect(() => onAuth(async (u) => { setUser(u || null); setRole(u ? await getRole(u) : null) }), [])

  useEffect(() => {
    if (role !== 'owner') return // only the owner loads the full dataset; staff = meter screen only
    loadCore().then(setCore).catch((e) => setErr(e.message))
    // Progressive: recent window paints first; full history merges in when it lands.
    loadJobs((partial) => { setJobs(partial); setHistSyncing(true) })
      .then((all) => { setJobs(all); setHistSyncing(false) })
      .catch((e) => { setHistSyncing(false); setErr(e.message) })
    loadSizeMap().then(setSizeMap).catch(() => {})
    loadCatalog().then(setCatalog).catch(() => {})
  }, [role, refreshKey])

  const refresh = () => { forceRefresh(); setErr(''); setCore(null); setJobs(null); setHistSyncing(false); setRefreshKey((k) => k + 1) }

  const catIdx = useMemo(() => buildCatalogIndex(catalog), [catalog])
  const mappedJobs = useMemo(() => tagJobs(enrichJobs(jobs || [], sizeMap), catIdx), [jobs, sizeMap, catIdx])
  const mo = useMonthly(core?.days || [], mappedJobs, core?.cfg || {})
  const todayY = businessYmd()
  const range = useMemo(() => customDate
    ? { from: +customDate.replace(/-/g, ''), to: +customDate.replace(/-/g, '') }
    : periodRange(period, todayY), [customDate, period, todayY])
  const vdays = useMemo(() => filterDaysByRange(core?.days || [], range), [core?.days, range])
  const vjobs = useMemo(() => mappedJobs.filter((j) => {
    const d = +j.day
    return d >= range.from && d <= range.to
  }), [mappedJobs, range])

  if (user === undefined || (user && role === undefined)) return <div className="app"><div className="loader">Loading UNICO Laser…</div></div>
  if (!user) return <Login />
  if (!allowed) return <Unauthorized email={user.email} />
  if (role === 'meter') return <StaffMeter user={user} /> // staff: meter screen only
  if (err) return <div className="app"><div className="note err">Could not load data: {err}</div></div>
  if (!core) return <div className="app"><div className="loader">Loading UNICO Laser…</div></div>

  const { meta, cfg, days } = core
  const ready = jobs != null

  const showPeriod = ['Dashboard', 'Utilization', 'Production'].includes(tab)

  return (
    <div className="app">
      <header className="top"><Brand />
        {!ready && <span className="sync">loading runs…</span>}
        {ready && histSyncing && <span className="sync">syncing history…</span>}
        <button className="signout" onClick={refresh} title="Refresh (live read)" style={{ marginLeft: 'auto' }}>↻ Refresh</button>
        <button className="signout" onClick={signOutUser} title="Sign out" style={{ marginLeft: 8 }}>Sign out</button>
      </header>
      {showPeriod && (
        <div className="periodbar">
          {PERIODS.map(([k, l]) => (
            <button key={k} className={!customDate && period === k ? 'on' : ''} onClick={() => { setPeriod(k); setCustomDate('') }}>{l}</button>
          ))}
          <input type="date" className={'datepick' + (customDate ? ' on' : '')} value={customDate} max={`${String(todayY).slice(0,4)}-${String(todayY).slice(4,6)}-${String(todayY).slice(6,8)}`} onChange={(e) => setCustomDate(e.target.value)} title="Pick a specific day" />
        </div>
      )}
      <main>
        <FreshnessBanner days={days} />
        {tab === 'Quote' && (ready ? <Quote jobs={mappedJobs} catalog={catalog} cfg={cfg} mo={mo} userEmail={user.email} /> : <Loading />)}
        {tab === 'Parts' && (ready ? <Parts jobs={mappedJobs} days={days} cfg={cfg} role={role} /> : <Loading />)}
        {tab === 'Library' && (ready ? <JobCatalog jobs={mappedJobs} catalog={catalog} onSaved={() => loadCatalog().then(setCatalog)} /> : <Loading />)}
        {tab === 'Dashboard' && <Dashboard days={vdays} cfg={cfg} mo={mo} meta={meta} />}
        {tab === 'Utilization' && <Utilization days={vdays} meta={meta} />}
        {tab === 'Production' && (ready ? <Production jobs={mappedJobs} vjobs={vjobs} cfg={cfg} mo={mo} /> : <Loading />)}
        {tab === 'Costing' && (ready ? <CostingTab jobs={mappedJobs} days={days} cfg={cfg} mo={mo} rateHistory={core.rateHistory} /> : <Loading />)}
        {tab === 'Reports' && (ready ? <Reports days={days} jobs={mappedJobs} cfg={cfg} mo={mo} /> : <Loading />)}
        {tab === 'Admin' && (ready ? <Admin meta={meta} days={days} jobs={mappedJobs} cfg={cfg} userEmail={user.email} onSaved={() => loadSizeMap().then(setSizeMap)} onCatalogSaved={() => loadCatalog().then(setCatalog)} onRatesSaved={refresh} /> : <Loading />)}
      </main>
      <nav className="tabs">
        {TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </nav>
    </div>
  )
}
const Loading = () => <div className="loader">Loading runs…</div>
