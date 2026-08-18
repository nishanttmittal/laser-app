import { materialBasisNote } from './quoteMath.js'

const A4 = { w: 595, h: 842 }
const M = 38
const INK = [20, 27, 39]
const MUTED = [100, 111, 126]
const CYAN = [13, 110, 130]
const LINE = [218, 224, 230]

const money = (value) =>
  `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const safeText = (value) => String(value ?? '').replace(/[^\x20-\x7E]/g, ' ')

export function quoteFilename(quote = {}) {
  const customer = safeText(quote.customerName || 'Customer')
    .trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'Customer'
  const date = String(quote.date || '').replace(/\D/g, '').slice(0, 8) || 'Quote'
  return `UNICO-Quote-${customer}-${date}.pdf`
}

async function imageData(url) {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function buildQuotePDF(quote, { logoUrl = null } = {}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const logo = await imageData(logoUrl)
  let y = M

  const color = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2])
  const pageHeader = () => {
    doc.setFillColor(9, 13, 20)
    doc.rect(0, 0, A4.w, 76, 'F')
    if (logo) {
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(M, 19, 88, 38, 4, 4, 'F')
      doc.addImage(logo, 'PNG', M + 7, 24, 74, 28, undefined, 'FAST')
    } else {
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.text('UNICO', M, 44)
    }
    doc.setTextColor(45, 212, 238)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('LASER CUTTING QUOTATION', A4.w - M, 35, { align: 'right' })
    doc.setTextColor(200, 208, 218)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Quote ${safeText(quote.id || '').slice(-12) || 'Draft'}`, A4.w - M, 50, { align: 'right' })
    y = 100
  }
  const ensure = (height) => {
    if (y + height <= A4.h - 48) return
    doc.addPage()
    pageHeader()
  }

  pageHeader()
  color(INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('QUOTED TO', M, y)
  doc.setFontSize(16)
  doc.text(safeText(quote.customerName || 'Customer'), M, y + 22)
  color(MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  if (quote.customerPhone) doc.text(safeText(quote.customerPhone), M, y + 38)
  doc.text(`Date: ${safeText(quote.date || '')}`, A4.w - M, y + 22, { align: 'right' })
  if (quote.company?.gstin) doc.text(`GSTIN: ${safeText(quote.company.gstin)}`, A4.w - M, y + 38, { align: 'right' })
  y += 62

  // Exact printable width (519 pt): keep the final Amount column inside the A4 right margin.
  const widths = [105, 75, 32, 44, 53, 53, 67, 90]
  const headings = ['Part', 'Tube / length', 'Qty', 'Wt kg', 'Mat/pc', 'Cut/pc', 'Price/pc', 'Amount']
  const x = []
  widths.reduce((cursor, width) => { x.push(cursor); return cursor + width }, M)

  const tableHeader = () => {
    doc.setFillColor(239, 244, 247)
    doc.rect(M, y, A4.w - M * 2, 24, 'F')
    color(MUTED)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    headings.forEach((heading, index) => {
      const right = index >= 2
      doc.text(heading, right ? x[index] + widths[index] - 4 : x[index] + 4, y + 15, { align: right ? 'right' : 'left' })
    })
    y += 24
  }
  tableHeader()

  for (const line of quote.lines || []) {
    const nameLines = doc.splitTextToSize(safeText(line.name), widths[0] - 8).slice(0, 2)
    const rowHeight = Math.max(27, nameLines.length * 10 + 10)
    ensure(rowHeight + 26)
    if (y === 100) tableHeader()
    color(INK)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(nameLines, x[0] + 4, y + 11)
    const cells = [
      `${safeText(line.section)} / ${Number(line.length || 0).toLocaleString('en-IN')} mm`,
      Number(line.qty || 0).toLocaleString('en-IN'),
      Number(line.billedWeightKg || 0).toFixed(3),
      line.materialByCustomer ? 'by customer' : money(line.materialPerPc),
      money(line.cuttingPerPc),
      money(line.pricePerPc),
      money(line.amount),
    ]
    cells.forEach((cell, offset) => {
      const index = offset + 1
      doc.text(cell, x[index] + widths[index] - 4, y + 13, { align: 'right' })
    })
    y += rowHeight
    doc.setDrawColor(LINE[0], LINE[1], LINE[2])
    doc.line(M, y, A4.w - M, y)
  }

  ensure(116)
  y += 18
  const totalsX = A4.w - M - 190
  const totalRow = (label, value, strong = false) => {
    color(strong ? CYAN : MUTED)
    doc.setFont('helvetica', strong ? 'bold' : 'normal')
    doc.setFontSize(strong ? 12 : 9)
    doc.text(label, totalsX, y)
    color(INK)
    doc.text(money(value), A4.w - M, y, { align: 'right' })
    y += strong ? 24 : 18
  }
  totalRow('Subtotal', quote.subtotal)
  totalRow(`GST (${Number(quote.gstPct || 0)}%)`, quote.gst)
  doc.setDrawColor(CYAN[0], CYAN[1], CYAN[2])
  doc.line(totalsX, y - 10, A4.w - M, y - 10)
  totalRow('Grand total', quote.total, true)

  // Job-work disclosure. Printed under the total, in ink not grey, because a customer
  // reading a cutting-only price as all-in is the expensive way for this to go wrong.
  const basisNote = materialBasisNote(quote.materialBasis)
  if (basisNote) {
    ensure(46)
    y += 6
    color(INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(doc.splitTextToSize(safeText(basisNote), A4.w - M * 2), M, y)
    y += 22
  }

  if (quote.notes) {
    ensure(64)
    color(MUTED)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('NOTES', M, y)
    doc.setFont('helvetica', 'normal')
    doc.text(doc.splitTextToSize(safeText(quote.notes), A4.w - M * 2), M, y + 14)
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    color(MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('UNICO Metal Products Pvt. Ltd. | Prices subject to steel-rate revision.', M, A4.h - 22)
    doc.text(`Page ${page} / ${pages}`, A4.w - M, A4.h - 22, { align: 'right' })
  }

  return { blob: doc.output('blob'), filename: quoteFilename(quote) }
}
