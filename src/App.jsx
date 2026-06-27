import React, { useEffect, useMemo, useState } from 'react'
import { loadCore, loadJobs, loadSizeMap, saveSizeMapEntry, onAuth, signInWithGoogle, signOutUser, getRole, saveMeterReading, listUsers, saveUser, loadCatalog, saveCatalogJob, forceRefresh } from './firebase'

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
import { ymd, lastCompleteDay, periodRange, filterDaysByRange, monthRollup } from './lib/period.js'
import { kWhCost } from './lib/energy.js'
import { enrichJobs, groupBySize, unlabelledFiles } from './lib/sizemap.js'
import { buildCatalogIndex, tagJobs, sizeCatalog } from './lib/catalog.js'
import { periodUtil, stateLabel } from './lib/util.js'
import { monthlyCost, quoteJob, whatIf, monthlyMargins, tubeWeightGrams } from './lib/costing.js'
import { periodReport } from './lib/reportData.js'
import { buildPeriodPDF } from './lib/pdf.js'

/* ---------- helpers ---------- */
const useMonthly = (days, jobs, cfg) => useMemo(() => monthlyCost(days, cfg, jobs), [days, jobs, cfg])

function piecesByDay(jobs) {
  const m = {}
  for (const j of jobs || []) m[j.day] = (m[j.day] || 0) + (j.partAmount || 0)
  return m
}

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
  const target = cfg.utilTargetPct || 50
  const fixedDaily = Math.round((mo.fixedExclElec || 0) / 30)
  const idleH = headline.powerOnPct != null ? +(24 - (headline.workH || 0)).toFixed(1) : null
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
    return (jobs || []).filter((j) => !t || (j.sizeKey + ' ' + j.file + ' ' + (j.catName || '') + ' ' + j.startTime + ' ' + whenStr(j.startTime)).toLowerCase().includes(t)).slice(0, 300)
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
              <span className="jobcard-when">{whenStr(j.startTime)}</span>
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
                {cat ? cat.name : s.sizeKey}
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
  const [newPart, setNewPart] = useState(false)
  const sel = sizes.find((s) => s.sizeKey === sizeKey)
  const spp = sel ? sel.secPerPiece || 0 : 0
  const piecesPerTube = sel && sel.goodPieces && sel.runs ? sel.goodPieces / sel.runs : (sel && sel.runs ? sel.pieces / sel.runs : 0)
  const { cutMin, setupMin, loadingMin, progMin, tubes, qcMin, billMin, quoteCharge, quoteCost, minApplied } =
    quoteJob({ secPerPiece: spp, qty, setupType, cfg, costPerBillMin: mo.costPerBillMin, piecesPerTube, newPart })
  const qcPct = cfg.qcPct ?? cfg.longJob?.bufferPct ?? 12
  const shareQuote = async () => {
    // customer-facing ONLY — never include cost or margin
    const text = [
      'UNICO Metal Products — Laser Cutting Quote',
      new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
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
    ['Depreciation', cfg.depreciationMonthly], ['Electricity (from real kWh)', mo.mElec],
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
        <label>Setup
          <select value={setupType} onChange={(e) => setSetupType(e.target.value)}>
            <option value="dimension">Dimension change (+{cfg.setup?.dimensionChangeMin ?? 40}m)</option>
            <option value="length">Length change (+{Math.round((cfg.setup?.lengthChangeMin ?? 1) * 60)} sec)</option>
            <option value="none">No setup</option>
          </select>
        </label>
        <label className="chk"><input type="checkbox" checked={newPart} onChange={(e) => setNewPart(e.target.checked)} /> New part — add one-time programming ({cfg.programmingMin ?? 25} min)</label>
      </div>
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
  const iso = (d) => d.toISOString().slice(0, 10)
  const now = new Date()
  const [from, setFrom] = useState(() => iso(new Date(now.getFullYear(), now.getMonth(), 1))) // 1st of this month
  const [to, setTo] = useState(() => iso(now))
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
          <label>To<input type="date" value={to} max={iso(now)} onChange={(e) => setTo(e.target.value)} /></label>
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
                <span>{(j.startTime || '').slice(11, 16)}</span>
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
  const y = +latest.slice(0, 4), m = +latest.slice(4, 6) - 1, day = +latest.slice(6, 8)
  const daysAgo = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(y, m, day).getTime()) / 864e5)
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

function Margin({ days, cfg, mo }) {
  const months = monthlyMargins(days, cfg)
  const [hrs, setHrs] = useState(8)
  const [wdays, setWdays] = useState(26)
  const charge = cfg.chargePerMin || 40
  const wi = whatIf(mo, cfg, { cuttingHoursPerDay: hrs, workingDaysPerMonth: wdays })
  return (
    <div>
      <h2>Actual margin — per month</h2>
      <div className="note">Revenue = production billed at {rupee(charge)}/min (cutting + setup + loading + QC). Cost = full monthly fixed + <b>actual electricity</b> (from the daily meter / calibrated kWh). Material is billed separately, so it's excluded here.</div>
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
      </div>
      <div className="note">Fixed cost is <b>{rupee(months[0]?.fixed || mo.fixedExclElec)}/month</b> regardless of output — months below that on revenue run at a loss. That's the utilization story in rupees.</div>

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
function CostingTab({ jobs, days, cfg, mo }) {
  return (<div><Costing jobs={jobs} cfg={cfg} mo={mo} /><Sep /><WeightCalc cfg={cfg} /><Sep /><Margin days={days} cfg={cfg} mo={mo} /></div>)
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
function Rates({ cfg, onSaved }) {
  const f0 = cfg.monthlyFixed || {}, s0 = cfg.setup || {}
  const [v, setV] = useState({
    chargePerMin: cfg.chargePerMin ?? 40, electricityRate: cfg.electricityRate ?? 14,
    operator: f0.operator ?? 0, rent: f0.rent ?? 0, maintenance: f0.maintenance ?? 0, consumables: f0.consumables ?? 0,
    depreciationMonthly: cfg.depreciationMonthly ?? 0,
    sizeChangesPerDay: s0.sizeChangesPerDay ?? 5.5, dimensionChangeMin: s0.dimensionChangeMin ?? 40, loadSecPerTube: s0.loadSecPerTube ?? 18,
    qcPct: cfg.qcPct ?? 12, rejectionPct: cfg.rejectionPct ?? 2, programmingMin: cfg.programmingMin ?? 25,
    minOrderCharge: cfg.minOrderCharge ?? 500, utilTargetPct: cfg.utilTargetPct ?? 50,
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }))
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0 }
  const save = async () => {
    setBusy(true); setMsg('')
    try {
      await saveConfig({
        chargePerMin: num(v.chargePerMin), electricityRate: num(v.electricityRate),
        monthlyFixed: { ...f0, operator: num(v.operator), rent: num(v.rent), maintenance: num(v.maintenance), consumables: num(v.consumables) },
        depreciationMonthly: num(v.depreciationMonthly),
        setup: { ...s0, sizeChangesPerDay: num(v.sizeChangesPerDay), dimensionChangeMin: num(v.dimensionChangeMin), loadSecPerTube: num(v.loadSecPerTube) },
        qcPct: num(v.qcPct), rejectionPct: num(v.rejectionPct), programmingMin: num(v.programmingMin),
        minOrderCharge: num(v.minOrderCharge), utilTargetPct: num(v.utilTargetPct),
      })
      setMsg('✓ Saved — refreshing…'); onSaved && onSaved()
    } catch (e) { setMsg('Could not save: ' + e.message) }
    finally { setBusy(false) }
  }
  const F = [
    ['chargePerMin', 'Charge ₹/min (price)'], ['operator', 'Operator salary ₹/mo'], ['rent', 'Rent ₹/mo'],
    ['maintenance', 'Maintenance ₹/mo'], ['consumables', 'Consumables ₹/mo'], ['depreciationMonthly', 'Depreciation ₹/mo'],
    ['electricityRate', 'Electricity ₹/unit'], ['sizeChangesPerDay', 'Size changes / cutting day'],
    ['dimensionChangeMin', 'Size-change setup (min)'], ['loadSecPerTube', 'Loading sec / tube'],
    ['qcPct', 'QC buffer %'], ['rejectionPct', 'Reject yield %'], ['programmingMin', 'New-part programming (min)'],
    ['minOrderCharge', 'Minimum order ₹'], ['utilTargetPct', 'Utilization target %'],
  ]
  return (
    <div>
      <h2>Cost rates</h2>
      <div className="note">Change a rate and Save — Costing &amp; Dashboard recompute on the next refresh. These are the live rates the app quotes with.</div>
      <div className="quote">
        {F.map(([k, label]) => <label key={k}>{label}<input type="number" inputMode="decimal" value={v[k]} onChange={set(k)} /></label>)}
      </div>
      <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rates'}</button>
      {msg && <div className="note" style={{ color: msg[0] === '✓' ? '#34d399' : '#f87171' }}>{msg}</div>}
      <div className="note">The nightly Telegram report still uses the factory-set defaults — ask to wire it to these rates if you want them identical.</div>
    </div>
  )
}
function Admin({ meta, days, jobs, cfg, onSaved, onCatalogSaved, onRatesSaved }) {
  return (<div><Rates cfg={cfg} onSaved={onRatesSaved} /><Sep /><MeterEntry /><Sep /><JobCatalog onSaved={onCatalogSaved} /><Sep /><Users /><Sep /><Assign jobs={jobs} onSaved={onSaved} /><Sep /><Machine meta={meta} days={days} jobs={jobs} /></div>)
}

/* ---------- shell ---------- */
const TABS = ['Dashboard', 'Utilization', 'Production', 'Costing', 'Reports', 'Admin']
const PERIODS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['lastMonth', 'Last month'], ['all', 'All']]
function Login() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="app"><div className="login">
      <div><span className="logo">UNICO</span> <span className="ttl">Laser</span></div>
      <p>Production, utilization & costing — sign in to view.</p>
      <button className="btn wa" disabled={busy} onClick={async () => { setBusy(true); try { await signInWithGoogle() } catch (e) { alert(e.message); setBusy(false) } }}>{busy ? 'Opening…' : 'Sign in with Google'}</button>
    </div></div>
  )
}
function Unauthorized({ email }) {
  return (
    <div className="app"><div className="login">
      <div><span className="logo">UNICO</span> <span className="ttl">Laser</span></div>
      <p className="err"><b>{email}</b> isn't authorized for this app.</p>
      <p className="note">Ask the admin to add your email, then sign in again.</p>
      <button className="btn" onClick={signOutUser}>Sign out</button>
    </div></div>
  )
}

function MeterEntry() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const save = async () => {
    if (a === '' || b === '') { setMsg('Enter both meter readings.'); return }
    setBusy(true); setMsg('')
    try { await saveMeterReading({ date, meterA: a, meterB: b, note }); setMsg('✓ Saved. Thank you!'); setNote('') }
    catch (e) { setMsg('Could not save: ' + e.message) }
    finally { setBusy(false) }
  }
  return (
    <div>
      <h2>Daily meter reading</h2>
      <div className="note">Enter today's two meter totals (the full number on each meter).</div>
      <div className="quote">
        <label>Date
          <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
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

function JobCatalog({ onSaved }) {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [name, setName] = useState(''); const [photo, setPhoto] = useState(''); const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const load = () => loadCatalog().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const onPhoto = async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; try { setPhoto(await compressImage(f)) } catch { setMsg('Could not read that photo.') } }
  const save = async () => {
    if (!name.trim()) { setMsg('Give the job a name.'); return }
    setBusy(true); setMsg('')
    try { await saveCatalogJob({ name, photo, fileName }); setName(''); setPhoto(''); setFileName(''); setMsg('✓ Saved'); await load(); onSaved && onSaved() }
    catch (e) { setMsg('Could not save: ' + e.message) }
    finally { setBusy(false) }
  }
  const rows = (list || []).filter((j) => !q || (`${j.name} ${j.fileName || ''}`).toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <h2>Job catalog</h2>
      <div className="note">Photograph the job, name it, and (optional) link the machine file. Names are reusable; tagged files show the name in the rest of the app.</div>
      <div className="quote">
        <label>Job name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Varun table leg" /></label>
        <label>Photo<input type="file" accept="image/*" capture="environment" onChange={onPhoto} /></label>
        {photo && <img src={photo} alt="" className="catimg" />}
        <label>Link machine file (optional)<input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="e.g. 858x6010x31.75.zzx" /></label>
      </div>
      <button className="btn wa" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save job'}</button>
      {msg && <div className="note" style={{ color: msg[0] === '✓' ? '#34d399' : '#f87171' }}>{msg}</div>}
      <input className="search" placeholder="Search saved jobs" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: 14 }} />
      <div className="catgrid">
        {rows.map((j) => (
          <div className="catcard" key={j.id}>
            {j.photo ? <img src={j.photo} alt={j.name} /> : <div className="catnoimg">no photo</div>}
            <div className="catname">{j.name}</div>
            {j.fileName && <div className="catfile">{j.fileName}</div>}
          </div>
        ))}
        {list && !rows.length && <div className="note">No jobs saved yet — add the first one above.</div>}
        {!list && <div className="note">Loading…</div>}
      </div>
    </div>
  )
}

function StaffMeter({ user }) {
  const [t, setT] = useState('Meter')
  return (
    <div className="app">
      <header className="top"><span className="logo">UNICO</span><span className="ttl">Laser</span>
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
  const [tab, setTab] = useState('Dashboard')
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
  const allowed = role === 'owner' || role === 'meter'

  useEffect(() => onAuth(async (u) => { setUser(u || null); setRole(u ? await getRole(u) : null) }), [])

  useEffect(() => {
    if (role !== 'owner') return // only the owner loads the full dataset; staff = meter screen only
    loadCore().then(setCore).catch((e) => setErr(e.message))
    loadJobs().then(setJobs).catch((e) => setErr(e.message))
    loadSizeMap().then(setSizeMap).catch(() => {})
    loadCatalog().then(setCatalog).catch(() => {})
  }, [role, refreshKey])

  const refresh = () => { forceRefresh(); setErr(''); setCore(null); setJobs(null); setRefreshKey((k) => k + 1) }

  const catIdx = useMemo(() => buildCatalogIndex(catalog), [catalog])
  const mappedJobs = useMemo(() => tagJobs(enrichJobs(jobs || [], sizeMap), catIdx), [jobs, sizeMap, catIdx])
  const mo = useMonthly(core?.days || [], mappedJobs, core?.cfg || {})

  if (user === undefined || (user && role === undefined)) return <div className="app"><div className="loader">Loading UNICO Laser…</div></div>
  if (!user) return <Login />
  if (!allowed) return <Unauthorized email={user.email} />
  if (role === 'meter') return <StaffMeter user={user} /> // staff: meter screen only
  if (err) return <div className="app"><div className="note err">Could not load data: {err}</div></div>
  if (!core) return <div className="app"><div className="loader">Loading UNICO Laser…</div></div>

  const { meta, cfg, days } = core
  const ready = jobs != null

  const todayY = ymd(new Date())
  const range = customDate
    ? { from: +customDate.replace(/-/g, ''), to: +customDate.replace(/-/g, '') } // single picked day
    : periodRange(period, todayY)
  const vdays = filterDaysByRange(days, range)
  const vjobs = mappedJobs.filter((j) => { const d = +j.day; return d >= range.from && d <= range.to })
  const showPeriod = ['Dashboard', 'Utilization', 'Production'].includes(tab)

  return (
    <div className="app">
      <header className="top"><span className="logo">UNICO</span><span className="ttl">Laser</span>
        {!ready && <span className="sync">loading runs…</span>}
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
        {tab === 'Dashboard' && <Dashboard days={vdays} cfg={cfg} mo={mo} meta={meta} />}
        {tab === 'Utilization' && <Utilization days={vdays} meta={meta} />}
        {tab === 'Production' && (ready ? <Production jobs={mappedJobs} vjobs={vjobs} cfg={cfg} mo={mo} /> : <Loading />)}
        {tab === 'Costing' && (ready ? <CostingTab jobs={mappedJobs} days={days} cfg={cfg} mo={mo} /> : <Loading />)}
        {tab === 'Reports' && (ready ? <Reports days={days} jobs={mappedJobs} cfg={cfg} mo={mo} /> : <Loading />)}
        {tab === 'Admin' && (ready ? <Admin meta={meta} days={days} jobs={mappedJobs} cfg={cfg} onSaved={() => loadSizeMap().then(setSizeMap)} onCatalogSaved={() => loadCatalog().then(setCatalog)} onRatesSaved={refresh} /> : <Loading />)}
      </main>
      <nav className="tabs">
        {TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </nav>
    </div>
  )
}
const Loading = () => <div className="loader">Loading runs…</div>
