/**
 * Utilidades para el módulo KPI - Business Intelligence Center
 * Formateo, cálculo y helpers comunes
 */

export const SEVERITY_COLORS = {
  high: { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA', icon: '#EF4444' },
  medium: { bg: '#FFFBEB', color: '#92400E', border: '#FDE68A', icon: '#F59E0B' },
  low: { bg: '#EFF6FF', color: '#1E40AF', border: '#BFDBFE', icon: '#3B82F6' },
}

export const TREND_COLORS = {
  positive: { color: '#10B981', bg: '#ECFDF5', arrow: '↑' },
  negative: { color: '#EF4444', bg: '#FEF2F2', arrow: '↓' },
  neutral: { color: '#6B7280', bg: '#F9FAFB', arrow: '→' },
}

export function formatNumber(value, options = {}) {
  if (value === null || value === undefined || isNaN(value)) return '0'
  return new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: options.decimals ?? 0,
    maximumFractionDigits: options.decimals ?? 0,
  }).format(value)
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) return '0%'
  return `${value.toFixed(decimals)}%`
}

export function getTrendConfig(current, previous) {
  if (!previous || previous === 0) return { ...TREND_COLORS.neutral, change: '0.0' }
  const change = ((current - previous) / previous) * 100
  if (change > 0.5) return { ...TREND_COLORS.positive, change: change.toFixed(1) }
  if (change < -0.5) return { ...TREND_COLORS.negative, change: Math.abs(change).toFixed(1) }
  return { ...TREND_COLORS.neutral, change: '0.0' }
}

export function getPeriodBounds(period, offsetMonths = 0) {
  const now = new Date()
  now.setMonth(now.getMonth() - offsetMonths)

  let start, end
  switch (period) {
    case 'today':
      start = new Date(now.setHours(0, 0, 0, 0))
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
      break
    case 'week':
      start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
      break
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      break
    case '2months':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      break
    case '3months':
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      break
    case 'year':
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear() + 1, 0, 1)
      break
    case 'general': {
      const generalStart = new Date('1970-01-01T00:00:00.000Z')
      start = generalStart
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      break
    }
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  }

  return { dateFrom: start.toISOString(), dateTo: end.toISOString() }
}

export function getComparePeriodBounds(period, current = getPeriodBounds(period)) {
  const duration = new Date(current.dateTo) - new Date(current.dateFrom)
  const compareTo = new Date(current.dateFrom)
  const compareFrom = new Date(compareTo.getTime() - duration)
  return { dateFrom: compareFrom.toISOString(), dateTo: compareTo.toISOString() }
}

export const MATERIAL_GLOBAL_START = '1970-01-01T00:00:00.000Z'
export const MATERIAL_TIMEZONE = 'America/Asuncion'

const MATERIAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: MATERIAL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function zonedParts(date) {
  return Object.fromEntries(
    MATERIAL_DATE_FORMATTER.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  )
}

function zonedMidnightToUtc({ year, month, day }) {
  const expected = Date.UTC(year, month - 1, day)
  let instant = expected

  // La fecha local de Asunción puede tener un desplazamiento distinto al UTC;
  // dos pasadas también cubren una transición de horario de verano.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = zonedParts(new Date(instant))
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    instant -= actualAsUtc - expected
  }

  return new Date(instant)
}

function monthStart(parts, offset = 0) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + offset, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 }
}

function materialBoundsFromMonths(months, now) {
  const parts = zonedParts(now)
  const start = zonedMidnightToUtc(monthStart(parts, -(months - 1)))
  const end = zonedMidnightToUtc(monthStart(parts, 1))
  const compareTo = start
  const compareFrom = zonedMidnightToUtc(monthStart(parts, -((months * 2) - 1)))

  return {
    date_from: start.toISOString(),
    date_to: end.toISOString(),
    compare_from: compareFrom.toISOString(),
    compare_to: compareTo.toISOString(),
  }
}

export function getMaterialPeriodBounds(mode = 'current', now = new Date()) {
  switch (mode) {
    case '2months':
      return materialBoundsFromMonths(2, now)
    case '3months':
      return materialBoundsFromMonths(3, now)
    case 'current':
    default:
      return materialBoundsFromMonths(1, now)
  }
}

export function getMaterialGlobalBounds(now = new Date()) {
  const parts = zonedParts(now)
  const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
  const end = zonedMidnightToUtc({
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(),
  })
  return {
    date_from: MATERIAL_GLOBAL_START,
    date_to: end.toISOString(),
    compare_from: MATERIAL_GLOBAL_START,
    compare_to: MATERIAL_GLOBAL_START,
  }
}

export function getSeverityConfig(severity) {
  return SEVERITY_COLORS[severity] || SEVERITY_COLORS.low
}

export function truncateText(text, maxLength = 30) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

export function formatDays(value) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A'
  if (value < 1) return `${Math.round(value * 24)}h`
  return `${value.toFixed(1)}d`
}

export const KPI_CHART_COLORS = [
  '#06B6D4', // cyan
  '#F43F5E', // pink
  '#F59E0B', // amber
  '#10B981', // green
  '#8B5CF6', // violet
  '#F97316', // orange
  '#EC4899', // pink-500
  '#14B8A6', // teal
  '#6366F1', // indigo
  '#EF4444', // red
]

export function getChartColor(index) {
  return KPI_CHART_COLORS[index % KPI_CHART_COLORS.length]
}

export function formatTooltip(value, type = 'number') {
  switch (type) {
    case 'percent':
      return formatPercent(value)
    case 'days':
      return formatDays(value)
    default:
      return formatNumber(value)
  }
}
