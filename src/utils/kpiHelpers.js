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
    case 'year':
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear() + 1, 0, 1)
      break
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  }

  return { dateFrom: start.toISOString(), dateTo: end.toISOString() }
}

export function getComparePeriodBounds(period) {
  return getPeriodBounds(period, 1)
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
