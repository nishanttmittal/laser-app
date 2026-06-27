// Renders a periodReport() object into a PDF (jsPDF, lazy-loaded). Kept thin — all the
// numbers come pre-computed and tested from reportData.js; this only lays them out.
import { fmt, prettyYmd } from './format.js';

// jsPDF's built-in font can't render the ₹ glyph, so use "Rs " in PDFs (matches the nightly report).
const rupee = (n) => 'Rs ' + Math.round(n || 0).toLocaleString('en-IN');
const money = (n) => (n < 0 ? '-Rs ' : 'Rs ') + Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const A4 = { w: 595, h: 842 };
const M = 40;                 // page margin
const INK = [17, 24, 39];     // near-black
const MUT = [110, 120, 135];  // muted grey
const CYAN = [13, 110, 130];  // fiber-cyan (print-safe darker)
const LINE = [220, 224, 230];

const periodLabel = (r) => r.label || `${prettyYmd(String(r.range.from))} – ${prettyYmd(String(r.range.to))}`;

export async function buildPeriodPDF(report, { detailed = false } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = M;

  const setInk = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const ensure = (need) => { if (y + need > A4.h - M) { doc.addPage(); y = M; } };

  // ---- header band ----
  doc.setFillColor(9, 13, 20); doc.rect(0, 0, A4.w, 70, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('UNICO', M, 34);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(45, 212, 238);
  doc.text('Laser Cutting — Production Report', M + 78, 34);
  doc.setTextColor(200, 208, 218); doc.setFontSize(10);
  doc.text(detailed ? 'Detailed' : 'Summary', A4.w - M, 34, { align: 'right' });
  y = 92;

  setInk(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(periodLabel(report), M, y); y += 8;
  setInk(MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`, M, y + 8);
  y += 26;

  // ---- KPI cards ----
  const t = report.totals, u = report.utilization;
  const kpis = [
    ['Pieces', fmt(t.pieces)],
    ['Cutting hours', `${t.cutH} h`],
    ['Cutting days', String(t.cuttingDays)],
    ['Cutting charge', rupee(t.cuttingCharge)],
    ['Electricity', rupee(t.elecCost)],
    ['Powered-on', u.powerOnPct == null ? '—' : `${u.powerOnPct}%`],
  ];
  const cols = 3, cw = (A4.w - 2 * M - (cols - 1) * 10) / cols, ch = 46;
  kpis.forEach((k, i) => {
    const cx = M + (i % cols) * (cw + 10);
    const cy = y + Math.floor(i / cols) * (ch + 10);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setFillColor(247, 249, 251);
    doc.roundedRect(cx, cy, cw, ch, 5, 5, 'FD');
    setInk(MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(k[0].toUpperCase(), cx + 10, cy + 16);
    setInk(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(String(k[1]), cx + 10, cy + 36);
  });
  y += Math.ceil(kpis.length / cols) * (ch + 10) + 6;

  setInk(MUT); doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`Cutting utilization ${u.workUtilPct == null ? '—' : u.workUtilPct + '% of powered-on time'}`
    + ` · Offline ${u.offlineH} h · Alarms ${u.alarms}`, M, y); y += 18;

  // ---- table helper ----
  const table = (title, head, rows, widths, align = []) => {
    ensure(40);
    setInk(CYAN); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(title, M, y); y += 6;
    const colX = []; let x = M; widths.forEach((w) => { colX.push(x); x += w; });
    const drawRow = (cells, bold, ink) => {
      ensure(18);
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9); setInk(ink || INK);
      cells.forEach((c, i) => {
        const a = align[i] || 'left';
        const tx = a === 'right' ? colX[i] + widths[i] - 4 : colX[i] + 2;
        doc.text(String(c), tx, y + 12, { align: a });
      });
      y += 16;
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.line(M, y, A4.w - M, y);
    };
    y += 6; drawRow(head, true, MUT);
    rows.forEach((r) => drawRow(r));
    y += 12;
  };

  // ---- By-size ----
  if (report.bySize.length) {
    const w = A4.w - 2 * M;
    table('By size — margin per piece',
      ['Item', 'Pieces', 'Rs/pc', 'Margin/pc'],
      report.bySize.map((s) => [s.name ? `${s.sizeKey} · ${s.name}` : s.sizeKey, fmt(s.pieces), money(s.chargePerPc), money(s.marginPerPc)]),
      [w * 0.46, w * 0.18, w * 0.18, w * 0.18],
      ['left', 'right', 'right', 'right']);
  }

  // ---- Detailed extras ----
  if (detailed) {
    if (report.byDay.length) {
      const w = A4.w - 2 * M;
      table('Day by day',
        ['Date', 'Pieces', 'Runs', 'Cut h', 'Charge'],
        report.byDay.map((d) => [prettyYmd(d.date), fmt(d.pieces), fmt(d.runs), d.cutH, rupee(d.cuttingCharge)]),
        [w * 0.28, w * 0.18, w * 0.14, w * 0.14, w * 0.26],
        ['left', 'right', 'right', 'right', 'right']);
    }
    if (report.topParts.length) {
      const w = A4.w - 2 * M;
      table('Top parts cut',
        ['Part', 'Quantity'],
        report.topParts.map((p) => [p.name, fmt(p.qty)]),
        [w * 0.7, w * 0.3], ['left', 'right']);
    }
  }

  // ---- footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); setInk(MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('UNICO Metal Products Pvt. Ltd. — internal production report', M, A4.h - 20);
    doc.text(`Page ${p} / ${pages}`, A4.w - M, A4.h - 20, { align: 'right' });
  }

  const fname = `UNICO-Laser-${String(report.range.from)}-${String(report.range.to)}-${detailed ? 'detailed' : 'summary'}.pdf`;
  return { blob: doc.output('blob'), filename: fname };
}
