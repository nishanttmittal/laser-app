import React, { useEffect, useMemo, useState } from 'react'
import { loadQuoteWorkspace, saveQuoteCustomer, saveQuoteProduct, saveQuoteRecord } from '../firebase.js'
import { groupBySize } from '../lib/sizemap.js'
import { businessDateKey } from '../lib/time.js'
import { computeQuote, materialBasisNote, nearestSecPerPiece, normalizeSection } from '../lib/quoteMath.js'
import { parseDelimited, parseSpreadsheetFile } from '../lib/parseUpload.js'
import { buildQuotePDF } from '../lib/quotePdf.js'
import { buildQuoteProgramChoices, quoteDraftFromProgram, updateExactProgramField } from '../lib/quotePrograms.js'
import { loadMachineManifest } from '../lib/machineManifestStore.js'
import {
  loadLocalQuoteDefaults,
  loadLocalQuoteWorkspace,
  mergeQuoteWorkspaces,
  saveLocalQuoteDefaults,
  saveLocalQuoteEntity,
} from '../lib/quoteStore.js'

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const newId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const blankPart = () => ({
  name: '', section: '', thickness: '', length: '', qty: '', secPerPiece: '',
  cutPricePerPiece: '', matchSizeKey: '',
})

function inputLine(line) {
  return {
    id: line.id || newId('line'),
    name: line.name || '',
    section: line.section || '',
    thickness: line.thickness || '',
    length: line.length || '',
    qty: line.qty || '',
    secPerPiece: line.secPerPiece || '',
    cutPricePerPiece: line.cutPricePerPiece ?? '',
    // '' = follow the quote-level material setting; 'unico' / 'customer' = this line decides.
    materialBy: line.materialBy === 'unico' || line.materialBy === 'customer' ? line.materialBy : '',
    matchSizeKey: line.matchSizeKey || '',
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function Quote({ jobs, catalog = [], cfg, mo, userEmail }) {
  const initialDefaults = {
    pipeRate: cfg.quoteDefaults?.pipeRate ?? cfg.material?.ratePerKgMS ?? 80,
    wastagePct: cfg.quoteDefaults?.wastagePct ?? 5,
    density: cfg.quoteDefaults?.density ?? 7.85,
    gstPct: cfg.quoteDefaults?.gstPct ?? 18,
    cutRatePerMin: cfg.chargePerMin ?? 40,
    setupLoadPct: cfg.quoteDefaults?.setupLoadPct ?? 50,
  }
  const [settings, setSettings] = useState(() => loadLocalQuoteDefaults(initialDefaults))
  const [customer, setCustomer] = useState({ id: '', name: '', phone: '' })
  const [notes, setNotes] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [draft, setDraft] = useState(blankPart)
  const [paste, setPaste] = useState('')
  const [lines, setLines] = useState([])
  const [workspace, setWorkspace] = useState(() => loadLocalQuoteWorkspace())
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState('')
  const [manifest, setManifest] = useState(null)
  const [programSearch, setProgramSearch] = useState('')
  const [materialByCustomer, setMaterialByCustomer] = useState(false)

  const knownSizes = useMemo(() =>
    groupBySize(jobs).filter((size) => size.hasSize && size.secPerPiece > 0), [jobs])
  const programChoices = useMemo(() =>
    buildQuoteProgramChoices(jobs, manifest, catalog), [jobs, manifest, catalog])
  const visiblePrograms = useMemo(() => {
    const search = programSearch.trim().toLowerCase()
    const rows = search
      ? programChoices.filter((choice) =>
        `${choice.name} ${choice.fileName} ${choice.section} ${choice.thickness}`.toLowerCase().includes(search))
      : programChoices
    return rows.slice(0, 12)
  }, [programChoices, programSearch])
  const totals = useMemo(() => computeQuote(lines, settings.gstPct, {
    pipeRate: settings.pipeRate,
    wastagePct: settings.wastagePct,
    density: settings.density,
    cutRatePerMin: settings.cutRatePerMin,
    cutCostPerMin: mo.costPerBillMin || 0,
    setupLoadPct: settings.setupLoadPct,
    materialByCustomer,
  }), [lines, settings, mo.costPerBillMin, materialByCustomer])

  useEffect(() => {
    let active = true
    loadQuoteWorkspace()
      .then((cloud) => { if (active) setWorkspace((local) => mergeQuoteWorkspaces(local, cloud)) })
      .catch(() => { if (active) setStatus('Cloud quote storage is not enabled yet. Quotes still save on this device.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    loadMachineManifest()
      .then((stored) => { if (active) setManifest(stored) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    try { saveLocalQuoteDefaults(settings) } catch { /* private mode: quote still works in memory */ }
  }, [settings])

  const rematch = (part) => {
    if (Number(part.secPerPiece) > 0) return part
    const match = nearestSecPerPiece(part.section, part.thickness, knownSizes)
    return match
      ? { ...part, secPerPiece: +match.secPerPiece.toFixed(2), matchSizeKey: match.sizeKey }
      : part
  }

  const addParts = (parts) => {
    const added = parts.map((part) => inputLine(rematch({ ...part, section: normalizeSection(part.section) })))
    setLines((current) => [...current, ...added])
    const unmatched = added.filter((part) => !(Number(part.secPerPiece) > 0)).length
    setStatus(unmatched
      ? `${added.length} part${added.length === 1 ? '' : 's'} added. Enter cutting time or cutting price for ${unmatched} unmatched part${unmatched === 1 ? '' : 's'}.`
      : `${added.length} part${added.length === 1 ? '' : 's'} added with machine cutting history.`)
  }

  const addDraft = () => {
    addParts([draft])
    setDraft(blankPart())
    setProgramSearch('')
  }

  const selectProgram = (choice) => {
    setDraft((current) => quoteDraftFromProgram(choice, current))
    setProgramSearch(choice.fileName)
  }

  const updateDraft = (field, value) => {
    const next = updateExactProgramField(draft, field, value)
    setDraft(next)
    if (draft.matchSizeKey && !next.matchSizeKey) {
      setStatus('Exact program cutting time cleared because the tube size changed.')
    }
  }

  const importResult = (result) => {
    if (result.errors?.length) { setStatus(result.errors.join(' ')); return }
    addParts(result.rows)
    setPaste('')
  }

  const importFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy('import')
    try { importResult(await parseSpreadsheetFile(file)) }
    catch (error) { setStatus(`Could not import ${file.name}: ${error.message}`) }
    finally { setBusy(''); event.target.value = '' }
  }

  const updateLine = (id, field, value) => {
    setLines((current) => current.map((line) =>
      line.id === id ? updateExactProgramField(line, field, value) : line))
  }
  const matchLine = (id) => {
    setLines((current) => current.map((line) => {
      if (line.id !== id) return line
      if (line.matchSizeKey.startsWith('Exact program') && Number(line.secPerPiece) > 0) return line
      return rematch({ ...line, secPerPiece: '' })
    }))
  }

  const customerFromName = (name) => {
    const hit = workspace.customers.find((item) => item.name.toLowerCase() === name.trim().toLowerCase())
    setCustomer(hit ? { id: hit.id, name: hit.name, phone: hit.phone || '' } : { id: '', name, phone: customer.phone })
  }

  const quoteRecord = (id = quoteId || newId('quote')) => ({
    id,
    customerId: customer.id || '',
    customerName: customer.name.trim(),
    customerPhone: customer.phone.trim(),
    date: businessDateKey(),
    lines: totals.lines,
    materialByCustomer,
    materialBasis: totals.materialBasis,
    setupLoadPct: Number(settings.setupLoadPct) || 0,
    pipeRate: Number(settings.pipeRate),
    wastagePct: Number(settings.wastagePct),
    density: Number(settings.density),
    cutRatePerMin: Number(settings.cutRatePerMin),
    subtotal: totals.subtotal,
    gst: totals.gst,
    gstPct: totals.gstPct,
    total: totals.total,
    estimatedCost: totals.estimatedCost,
    estimatedMargin: totals.estimatedMargin,
    notes: notes.trim(),
    createdBy: userEmail || '',
    company: { gstin: cfg.company?.gstin || cfg.gstin || '' },
  })

  const validate = () => {
    if (!customer.name.trim()) { setStatus('Enter the customer name.'); return false }
    if (!totals.valid) { setStatus('Fix the highlighted part fields before making the quote.'); return false }
    return true
  }

  const persistCustomer = async () => {
    if (!customer.name.trim()) return null
    const local = saveLocalQuoteEntity('customers', {
      id: customer.id || undefined,
      name: customer.name.trim(),
      phone: customer.phone.trim(),
    })
    setCustomer({ id: local.id, name: local.name, phone: local.phone || '' })
    try { await saveQuoteCustomer(local); return { record: local, cloud: true } }
    catch { return { record: local, cloud: false } }
  }

  const saveQuote = async () => {
    if (!validate()) return
    setBusy('save')
    try {
      const savedCustomer = await persistCustomer()
      const local = saveLocalQuoteEntity('quotes', {
        ...quoteRecord(),
        customerId: savedCustomer?.record.id || customer.id || '',
      })
      setQuoteId(local.id)
      let cloud = savedCustomer?.cloud !== false
      try { await saveQuoteRecord(local) } catch { cloud = false }
      setWorkspace((current) => mergeQuoteWorkspaces(current, loadLocalQuoteWorkspace()))
      setStatus(cloud ? 'Quote saved on this device and in the cloud.' : 'Quote saved on this device. Cloud saving awaits quote permissions.')
    } catch (error) {
      setStatus(`Could not save this quote: ${error.message}`)
    } finally { setBusy('') }
  }

  const saveProduct = async (line) => {
    const product = saveLocalQuoteEntity('products', {
      name: line.name,
      section: normalizeSection(line.section),
      thickness: Number(line.thickness),
      length: Number(line.length),
      secPerPiece: Number(line.secPerPiece) || 0,
      note: '',
      active: true,
    })
    let cloud = true
    try { await saveQuoteProduct(product) } catch { cloud = false }
    setWorkspace((current) => mergeQuoteWorkspaces(current, loadLocalQuoteWorkspace()))
    setStatus(cloud ? `${product.name} saved for reuse.` : `${product.name} saved on this device for reuse.`)
  }

  const makePdf = async () => {
    if (!validate()) return
    setBusy('pdf')
    try {
      const record = quoteRecord()
      const { blob, filename } = await buildQuotePDF(record, { logoUrl: `${import.meta.env.BASE_URL}unico-logo.png` })
      const file = new File([blob], filename, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `UNICO quote for ${record.customerName}` })
      } else {
        downloadBlob(blob, filename)
        setStatus('Quote PDF downloaded.')
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus(`Could not make the PDF: ${error.message}`)
    } finally { setBusy('') }
  }

  const shareWhatsApp = async () => {
    if (!validate()) return
    const record = quoteRecord()
    const text = [
      `UNICO Laser Cutting Quote`,
      `Customer: ${record.customerName}`,
      ...record.lines.map((line) => `${line.name}: ${line.qty} pcs x ${money(line.pricePerPc)} = ${money(line.amount)}${line.materialByCustomer ? ' (cutting only)' : ''}`),
      `Subtotal: ${money(record.subtotal)}`,
      `GST (${record.gstPct}%): ${money(record.gst)}`,
      `Total: ${money(record.total)}`,
      ...(materialBasisNote(record.materialBasis) ? [materialBasisNote(record.materialBasis)] : []),
    ].join('\n')
    try {
      if (navigator.share) await navigator.share({ title: 'UNICO Laser Cutting Quote', text })
      else {
        const phone = customer.phone.replace(/\D/g, '')
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus(`Could not share the quote: ${error.message}`)
    }
  }

  const reopen = (quote) => {
    setQuoteId(quote.id)
    setCustomer({ id: quote.customerId || '', name: quote.customerName || '', phone: quote.customerPhone || '' })
    setSettings({
      pipeRate: quote.pipeRate ?? initialDefaults.pipeRate,
      wastagePct: quote.wastagePct ?? initialDefaults.wastagePct,
      density: quote.density ?? initialDefaults.density,
      gstPct: quote.gstPct ?? initialDefaults.gstPct,
      cutRatePerMin: quote.cutRatePerMin ?? initialDefaults.cutRatePerMin,
      // Quotes saved before the uplift existed were priced on raw cut time. Falling back to
      // today's default would silently re-price a reopened old quote — so it falls back to 0.
      setupLoadPct: quote.setupLoadPct ?? 0,
    })
    setMaterialByCustomer(!!quote.materialByCustomer)
    setLines((quote.lines || []).map(inputLine))
    setNotes(quote.notes || '')
    setStatus(`Reopened quote for ${quote.customerName}.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const clearQuote = () => {
    setQuoteId('')
    setCustomer({ id: '', name: '', phone: '' })
    setMaterialByCustomer(false) // every new quote starts on full supply, never inherits job work
    setLines([])
    setNotes('')
    setStatus('')
  }

  return (
    <div className="quote-workspace">
      <div className="quote-head">
        <div>
          <h1>Customer quote</h1>
          <div className="quote-id">{quoteId ? `Saved quote ${quoteId.slice(-12)}` : 'New quotation'}</div>
        </div>
        <button type="button" className="iconbtn" title="Start a new quote" aria-label="Start a new quote" onClick={clearQuote}>+</button>
      </div>

      <section className="quote-section">
        <h2>Customer</h2>
        <div className="quote-fields two">
          <label>Name
            <input list="quote-customers" value={customer.name} onChange={(event) => customerFromName(event.target.value)} placeholder="Customer or company" />
            <datalist id="quote-customers">{workspace.customers.map((item) => <option key={item.id} value={item.name} />)}</datalist>
          </label>
          <label>WhatsApp number
            <input inputMode="tel" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="91..." />
          </label>
        </div>
      </section>

      <section className="quote-section">
        <h2>Pricing basis</h2>
        <div className="matbasis">
          <button type="button" className={materialByCustomer ? '' : 'on'}
            onClick={() => setMaterialByCustomer(false)}>UNICO supplies material</button>
          <button type="button" className={materialByCustomer ? 'on' : ''}
            onClick={() => setMaterialByCustomer(true)}>Customer supplies (job work)</button>
        </div>
        {materialByCustomer && (
          <div className="note">Cutting charges only — material is <b>not</b> priced. Weight is still shown so the customer knows how much tube to send. This prints on the quote, PDF and WhatsApp message.</div>
        )}
        <div className="quote-fields six">
          <label>Pipe ₹/kg<input type="number" inputMode="decimal" min="0" value={settings.pipeRate} onChange={(event) => setSettings({ ...settings, pipeRate: event.target.value })} /></label>
          <label>Wastage %<input type="number" inputMode="decimal" min="0" value={settings.wastagePct} onChange={(event) => setSettings({ ...settings, wastagePct: event.target.value })} /></label>
          <label>Material
            <select value={settings.density} onChange={(event) => setSettings({ ...settings, density: event.target.value })}>
              <option value="7.85">MS · 7.85</option>
              <option value="8">SS · 8.00</option>
            </select>
          </label>
          <label>Cut ₹/min<input type="number" inputMode="decimal" min="0" value={settings.cutRatePerMin} onChange={(event) => setSettings({ ...settings, cutRatePerMin: event.target.value })} /></label>
          <label>GST %<input type="number" inputMode="decimal" min="0" value={settings.gstPct} onChange={(event) => setSettings({ ...settings, gstPct: event.target.value })} /></label>
          <label>Setup &amp; loading %<input type="number" inputMode="decimal" min="0" value={settings.setupLoadPct} onChange={(event) => setSettings({ ...settings, setupLoadPct: event.target.value })} /></label>
        </div>
        <div className="note">Machine cutting time is <b>machine-on only</b> — it excludes loading tubes, size changes, programming and QC. <b>{Number(settings.setupLoadPct) || 0}%</b> is added on top, so {Number(settings.setupLoadPct) === 50 ? '10 sec/pc of cutting bills as 15 sec' : `10 sec/pc of cutting bills as ${(10 * (1 + (Number(settings.setupLoadPct) || 0) / 100)).toFixed(1)} sec`}. Set 0 to bill raw cutting time. A cut ₹/pc you type yourself is never uplifted.</div>
      </section>

      <section className="quote-section">
        <h2>Add parts</h2>
        {!!workspace.products.length && (
          <div className="product-chips">
            {workspace.products.filter((item) => item.active !== false).slice(0, 12).map((product) => (
              <button type="button" key={product.id} onClick={() => addParts([product])}>{product.name}</button>
            ))}
          </div>
        )}
        {!!programChoices.length && (
          <details className="quote-programs">
            <summary>
              <span>Choose exact cutting program</span>
              <b>{programChoices.length}</b>
            </summary>
            <input className="search" value={programSearch} onChange={(event) => setProgramSearch(event.target.value)}
              placeholder="Search program, product, or tube size" />
            <div className="quote-program-grid">
              {visiblePrograms.map((choice) => (
                <button type="button" key={choice.key} onClick={() => selectProgram(choice)}
                  className={draft.matchSizeKey === `Exact program · ${choice.fileName}` ? 'on' : ''}>
                  {choice.image
                    ? <img src={choice.image} alt={choice.imageKind === 'product' ? choice.name : `${choice.fileName} cutting drawing`}
                      className={choice.imageKind === 'geometry' ? 'machinepreview' : ''} />
                    : <span className="quote-program-placeholder">CUT</span>}
                  <span>
                    <strong>{choice.name}</strong>
                    {choice.name !== choice.fileName && <small>{choice.fileName}</small>}
                    <small>{choice.section || 'Unlabelled'}{choice.thickness ? ` · t${choice.thickness}` : ''} · {choice.secPerPiece.toFixed(1)} sec/pc</small>
                    <small>{choice.pieces.toLocaleString('en-IN')} pcs · {choice.runs.toLocaleString('en-IN')} runs</small>
                  </span>
                </button>
              ))}
            </div>
            {programSearch && !visiblePrograms.length && <div className="note">No exact cutting program matches.</div>}
          </details>
        )}
        {draft.matchSizeKey.startsWith('Exact program') && (
          <div className="quote-selected-program">
            <span>{draft.matchSizeKey.replace('Exact program · ', '')}</span>
            <strong>{Number(draft.secPerPiece).toFixed(2)} sec/pc</strong>
          </div>
        )}
        <div className="quote-fields part-entry">
          <label>Part name<input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="e.g. side rail" /></label>
          <label>Tube section
            <input list="quote-sizes" value={draft.section} onChange={(event) => updateDraft('section', event.target.value)} placeholder="40x20 or R50" />
            <datalist id="quote-sizes">{knownSizes.map((size) => <option key={size.sizeKey} value={size.sizeKey.replace(/\s+t.*$/i, '')} />)}</datalist>
          </label>
          <label>Thickness mm<input type="number" inputMode="decimal" min="0" value={draft.thickness} onChange={(event) => updateDraft('thickness', event.target.value)} /></label>
          <label>Length mm<input type="number" inputMode="numeric" min="0" value={draft.length} onChange={(event) => updateDraft('length', event.target.value)} /></label>
          <label>Quantity<input type="number" inputMode="numeric" min="0" value={draft.qty} onChange={(event) => updateDraft('qty', event.target.value)} /></label>
          <button type="button" className="btn compact" onClick={addDraft}>Add part</button>
        </div>

        <div className="quote-import">
          <label className="filebtn">
            {busy === 'import' ? 'Importing…' : 'Upload Excel / CSV'}
            <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" disabled={busy === 'import'} onChange={importFile} />
          </label>
          <textarea value={paste} onChange={(event) => setPaste(event.target.value)} placeholder="Paste rows from Excel" rows="3" />
          <button type="button" className="btn secondary compact" disabled={!paste.trim()} onClick={() => importResult(parseDelimited(paste))}>Add pasted rows</button>
        </div>
      </section>

      <section className="quote-section">
        <h2>Parts ({lines.length})</h2>
        {!lines.length && <div className="quote-empty">Add a part, choose a saved product, or import a parts list.</div>}
        <div className="quote-lines">
          {totals.lines.map((line, index) => (
            <article className={`quote-line${line.valid ? '' : ' invalid'}`} key={lines[index].id}>
              <div className="quote-line-head">
                <input aria-label={`Part ${index + 1} name`} value={lines[index].name} onChange={(event) => updateLine(lines[index].id, 'name', event.target.value)} />
                <button type="button" className="iconbtn danger" title="Remove part" aria-label={`Remove ${line.name || `part ${index + 1}`}`} onClick={() => setLines((current) => current.filter((item) => item.id !== lines[index].id))}>×</button>
              </div>
              <div className="quote-fields line-fields">
                <label>Section<input value={lines[index].section} onChange={(event) => updateLine(lines[index].id, 'section', event.target.value)} onBlur={() => matchLine(lines[index].id)} /></label>
                <label>Thickness<input type="number" inputMode="decimal" value={lines[index].thickness} onChange={(event) => updateLine(lines[index].id, 'thickness', event.target.value)} onBlur={() => matchLine(lines[index].id)} /></label>
                <label>Length mm<input type="number" inputMode="numeric" value={lines[index].length} onChange={(event) => updateLine(lines[index].id, 'length', event.target.value)} /></label>
                <label>Qty<input type="number" inputMode="numeric" value={lines[index].qty} onChange={(event) => updateLine(lines[index].id, 'qty', event.target.value)} /></label>
                <label>Cut sec/pc<input type="number" inputMode="decimal" value={lines[index].secPerPiece} onChange={(event) => updateLine(lines[index].id, 'secPerPiece', event.target.value)} /></label>
                <label>Or cut ₹/pc<input type="number" inputMode="decimal" value={lines[index].cutPricePerPiece ?? ''} onChange={(event) => updateLine(lines[index].id, 'cutPricePerPiece', event.target.value)} /></label>
                <label>Material
                  <select value={lines[index].materialBy || ''} onChange={(event) => updateLine(lines[index].id, 'materialBy', event.target.value)}>
                    <option value="">Same as quote ({materialByCustomer ? 'customer' : 'UNICO'})</option>
                    <option value="unico">UNICO supplies</option>
                    <option value="customer">Customer supplies</option>
                  </select>
                </label>
              </div>
              <div className="quote-line-summary">
                <span>{line.billedWeightKg.toFixed(3)} kg/pc</span>
                <span>{line.materialByCustomer ? 'Material by customer' : `Material ${money(line.materialPerPc)}`}</span>
                <span>Cut {money(line.cuttingPerPc)}{line.setupLoadPct > 0 && line.cutPricePerPiece == null && line.secPerPiece > 0
                  ? ` (${line.secPerPiece}s + ${line.setupLoadPct}% = ${line.billedSecPerPiece.toFixed(1)}s)` : ''}</span>
                <strong>{money(line.pricePerPc)}/pc · {money(line.amount)}</strong>
              </div>
              {lines[index].matchSizeKey && <div className="quote-match">Cut time from {lines[index].matchSizeKey}</div>}
              {!line.valid && <div className="quote-issues">Required: {line.issues.join(', ')}</div>}
              <button type="button" className="textbtn" onClick={() => saveProduct(lines[index])}>Save as reusable product</button>
            </article>
          ))}
        </div>
      </section>

      <section className="quote-section totals-band">
        <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
        <div><span>GST ({totals.gstPct}%)</span><strong>{money(totals.gst)}</strong></div>
        <div className="grand-total"><span>Grand total</span><strong>{money(totals.total)}</strong></div>
        <div className="owner-margin">
          <span>Internal estimated margin</span>
          <strong>{totals.costKnown ? money(totals.estimatedMargin) : 'Needs cutting time'}</strong>
        </div>
      </section>

      <section className="quote-section">
        <label className="notes-label">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" /></label>
        <div className="quote-actions">
          <button type="button" className="btn secondary" disabled={!!busy} onClick={saveQuote}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={makePdf}>{busy === 'pdf' ? 'Making PDF…' : 'PDF'}</button>
          <button type="button" className="btn wa" disabled={!!busy} onClick={shareWhatsApp}>WhatsApp</button>
        </div>
        {status && <div className="note quote-status">{status}</div>}
      </section>

      {!!workspace.quotes.length && (
        <section className="quote-section">
          <h2>Recent quotes</h2>
          <div className="recent-quotes">
            {workspace.quotes.slice(0, 10).map((quote) => (
              <button type="button" key={quote.id} onClick={() => reopen(quote)}>
                <span><strong>{quote.customerName}</strong><small>{quote.date} · {(quote.lines || []).length} parts</small></span>
                <b>{money(quote.total)}</b>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
