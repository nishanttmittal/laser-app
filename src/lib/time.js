export const BUSINESS_TIME_ZONE = 'Asia/Kolkata'
export const MACHINE_TIME_ZONE = 'Asia/Shanghai'

const MACHINE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const dateFormatters = new Map()
const dateTimeFormatters = new Map()

function dateFormatter(timeZone) {
  if (!dateFormatters.has(timeZone)) {
    dateFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }))
  }
  return dateFormatters.get(timeZone)
}

function dateTimeFormatter(timeZone) {
  if (!dateTimeFormatters.has(timeZone)) {
    dateTimeFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }))
  }
  return dateTimeFormatters.get(timeZone)
}

function partsObject(formatter, date) {
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
}

export function dateKeyInTimeZone(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const p = partsObject(dateFormatter(timeZone), date)
  return `${p.year}-${p.month}-${p.day}`
}

export const businessDateKey = (date = new Date()) =>
  dateKeyInTimeZone(date, BUSINESS_TIME_ZONE)

export const businessYmd = (date = new Date()) =>
  Number(businessDateKey(date).replace(/-/g, ''))

export const machineYmd = (date = new Date()) =>
  Number(dateKeyInTimeZone(date, MACHINE_TIME_ZONE).replace(/-/g, ''))

function formatInstant(date, timeZone = BUSINESS_TIME_ZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const p = partsObject(dateTimeFormatter(timeZone), date)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

// BOCHU/TubePro timestamps have no offset but come from the China-side machine clock.
export function machineDateTimeToBusiness(value) {
  if (!value) return value || ''
  const text = String(value).trim()
  const explicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)

  if (explicitOffset) {
    const instant = new Date(text.replace(' ', 'T'))
    return formatInstant(instant, BUSINESS_TIME_ZONE) || text
  }

  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return text
  const utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - MACHINE_UTC_OFFSET_MS
  return formatInstant(new Date(utcMs), BUSINESS_TIME_ZONE) || text
}

// TubeST package SaveTime values carry a trailing Z even though they contain the machine's
// Asia/Shanghai wall clock rather than a UTC instant. Preserve the source value elsewhere and
// remove only that misleading marker before applying the established China-to-IST conversion.
export function machinePackageDateTimeToBusiness(value) {
  if (!value) return value || ''
  return machineDateTimeToBusiness(String(value).trim().replace(/Z$/i, ''))
}

// Add display/business fields only. Source fields stay unchanged so existing BOCHU-day
// grouping and daily rollups continue to reconcile without a production-data migration.
export function normalizeJobTime(job) {
  if (!job) return job
  const sourceStartTime = job.sourceStartTime || job.startTime || ''
  const sourceEndTime = job.sourceEndTime || job.endTime || ''
  const startTimeIst = machineDateTimeToBusiness(sourceStartTime)
  const endTimeIst = machineDateTimeToBusiness(sourceEndTime)
  const sourceDay = String(job.sourceDay || job.day || '')
  const businessDay = startTimeIst
    ? startTimeIst.slice(0, 10).replace(/-/g, '')
    : String(job.businessDay || sourceDay)

  return {
    ...job,
    sourceStartTime,
    sourceEndTime,
    sourceDay,
    sourceTimeZone: MACHINE_TIME_ZONE,
    businessTimeZone: BUSINESS_TIME_ZONE,
    startTimeIst,
    endTimeIst,
    businessDay,
  }
}

export const displayStartTime = (job) =>
  (job && (job.startTimeIst || job.startTime)) || ''

export function calendarDayDiff(fromYmd, toYmd) {
  const parse = (value) => {
    const s = String(value).replace(/\D/g, '')
    if (s.length !== 8) return NaN
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))
  }
  const from = parse(fromYmd)
  const to = parse(toYmd)
  return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / 86400000) : NaN
}
