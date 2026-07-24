const HEADER_ALIASES = {
  name: ['partname', 'part', 'itemname', 'item', 'description', 'product', 'name'],
  section: ['section', 'profile', 'tubesize', 'size', 'od', 'outerdiameter', 'diameter'],
  width: ['width', 'sidea', 'a'],
  height: ['height', 'sideb', 'b'],
  thickness: ['thickness', 'wallthickness', 'wall', 'gauge', 't'],
  length: ['cutlength', 'partlength', 'length', 'len'],
  qty: ['totalquantity', 'quantity', 'qty', 'pieces', 'pcs'],
}

const normalizeHeader = (value) =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const numberFrom = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return cleaned ? Number(cleaned[0]) : 0
}

function headerField(value) {
  const normalized = normalizeHeader(value)
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field
  }
  return null
}

function csvMatrix(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  const delimiter = String(text).includes('\t') ? '\t' : ','

  for (let i = 0; i < String(text).length; i++) {
    const ch = String(text)[i]
    if (ch === '"') {
      if (quoted && String(text)[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && ch === delimiter) {
      row.push(cell); cell = ''
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && String(text)[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((value) => String(value).trim())) rows.push(row)
      row = []
    } else {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((value) => String(value).trim())) rows.push(row)
  return rows
}

export function parseMatrix(matrix) {
  const rows = (matrix || []).map((row) => Array.from(row || []))
  let headerIndex = -1
  let mapping = {}

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const candidate = {}
    rows[i].forEach((cell, index) => {
      const field = headerField(cell)
      if (field && candidate[field] == null) candidate[field] = index
    })
    if (Object.keys(candidate).length >= 3 && candidate.qty != null) {
      headerIndex = i
      mapping = candidate
      break
    }
  }

  if (headerIndex < 0) {
    return { rows: [], errors: ['Could not find a header row with part, size, length and quantity columns.'] }
  }

  const parsed = []
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const source = rows[i]
    if (!source.some((value) => String(value ?? '').trim())) continue

    let section = String(source[mapping.section] ?? '').trim()
    const sourceHeader = normalizeHeader(rows[headerIndex][mapping.section])
    if (section && ['od', 'outerdiameter', 'diameter'].includes(sourceHeader) && !/^[rodø]/i.test(section)) {
      section = `R${numberFrom(section)}`
    }
    if (!section && mapping.width != null && mapping.height != null) {
      const width = numberFrom(source[mapping.width])
      const height = numberFrom(source[mapping.height])
      if (width > 0 && height > 0) section = `${width}x${height}`
    }

    const row = {
      sourceRow: i + 1,
      name: String(source[mapping.name] ?? '').trim(),
      section,
      thickness: numberFrom(source[mapping.thickness]),
      length: numberFrom(source[mapping.length]),
      qty: numberFrom(source[mapping.qty]),
    }
    const issues = []
    if (!row.name) issues.push('part name')
    if (!row.section) issues.push('section/OD')
    if (!(row.thickness > 0)) issues.push('thickness')
    if (!(row.length > 0)) issues.push('length')
    if (!(row.qty > 0)) issues.push('quantity')
    parsed.push({ ...row, issues })
  }

  return {
    rows: parsed,
    errors: parsed.length ? [] : ['No part rows were found below the header.'],
    mapping,
  }
}

export const parseDelimited = (text) => parseMatrix(csvMatrix(text))

export async function parseSpreadsheetFile(file) {
  const name = String(file?.name || '').toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    return parseDelimited(await file.text())
  }

  const { read, utils } = await import('xlsx')
  const workbook = read(await file.arrayBuffer(), { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const matrix = utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: '' })
  return parseMatrix(matrix)
}
