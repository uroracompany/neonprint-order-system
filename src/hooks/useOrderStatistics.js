import { useMemo } from 'react'
import { useKPISingle, getKpiBounds } from './useKPI'

const EMPTY_STATS = Object.freeze({
  total_orders: 0,
  active_orders: 0,
  cancelled_orders: 0,
  completed_orders: 0,
  delivered_orders: 0,
  active_credit_orders: 0,
  normal_orders: 0,
  urgent_911_orders: 0,
  internal_design_orders: 0,
  external_design_orders: 0,
  daily_trend: [],
  top_client: { client_name: 'Sin datos', order_count: 0 },
  top_material: { material_name: 'Sin datos', reference_count: 0 },
  top_seller_completed: { seller_name: 'Sin datos', completed_count: 0 },
  top_designer_completed: { designer_name: 'Sin datos', completed_count: 0 },
  pipeline: [],
  comparison: [],
})

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatPeriodLabel(period) {
  const labels = {
    today: 'Hoy',
    week: 'Últimos 7 días',
    month: 'Mes actual',
    '2months': 'Últimos 2 meses',
    '3months': 'Últimos 3 meses',
    year: 'Año actual',
    general: 'Historial completo',
    custom: 'Personalizado'
  }
  return labels[period] || period
}

export function useOrderStatistics({ period = 'month', customDateFrom = '', customDateTo = '', userId, enabled = true }) {
  const bounds = useMemo(
    () => getKpiBounds(period, customDateFrom, customDateTo),
    [period, customDateFrom, customDateTo]
  )

  const query = useKPISingle('admin_orders_statistics', bounds, userId, Boolean(enabled && bounds && userId))

  const stats = useMemo(() => {
    if (!query.data) return EMPTY_STATS
    return query.data
  }, [query.data])

  const donuts = useMemo(() => {
    const completed = number(stats.completed_orders) + number(stats.delivered_orders)
    const cancelled = number(stats.cancelled_orders)
    const normal = number(stats.normal_orders)
    const urgent = number(stats.urgent_911_orders)
    const internal = number(stats.internal_design_orders)
    const external = number(stats.external_design_orders)

    return {
      status: [
        { name: 'Completadas / Entregadas', value: completed, color: '#10B981' },
        { name: 'Canceladas', value: cancelled, color: '#EF4444' },
      ].filter(d => d.value > 0),
      priority: [
        { name: 'Normales', value: normal, color: '#06B6D4' },
        { name: '911 (Urgentes)', value: urgent, color: '#F43F5E' },
      ].filter(d => d.value > 0),
      design: [
        { name: 'Diseño Interno', value: internal, color: '#8B5CF6' },
        { name: 'Diseño Externo', value: external, color: '#F97316' },
      ].filter(d => d.value > 0),
    }
  }, [stats])

  const trendData = useMemo(() => {
    if (!stats.daily_trend || !Array.isArray(stats.daily_trend)) return []
    return stats.daily_trend.map(d => ({
      date: d.date,
      displayDate: new Date(d.date).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }),
      ordenes: number(d.orders),
    }))
  }, [stats.daily_trend])

  const topIndicators = useMemo(() => ({
    topClient: stats.top_client || { client_name: 'Sin datos', order_count: 0 },
    topMaterial: stats.top_material || { material_name: 'Sin datos', reference_count: 0 },
    topSeller: stats.top_seller_completed || { seller_name: 'Sin datos', completed_count: 0 },
    topDesigner: stats.top_designer_completed || { designer_name: 'Sin datos', completed_count: 0 },
  }), [stats])

  const pipeline = useMemo(() => {
    if (!stats.pipeline || !Array.isArray(stats.pipeline)) return []
    return stats.pipeline.map(p => ({
      status: p.status,
      label: p.label,
      count: number(p.count),
      pct: number(p.pct),
      color: p.color,
    })).filter(p => p.count > 0)
  }, [stats.pipeline])

  const comparison = useMemo(() => {
    if (!stats.comparison || !Array.isArray(stats.comparison)) return []
    return stats.comparison.map(c => ({
      status: c.status,
      label: c.label,
      total: number(c.total),
      normal: number(c.normal),
      urgent_911: number(c.urgent_911),
      pct_urgent: number(c.pct_urgent),
      completed: number(c.completed),
      cancelled: number(c.cancelled),
      pct_completion: number(c.pct_completion),
    }))
  }, [stats.comparison])

  const cards = useMemo(() => ({
    total: number(stats.total_orders),
    active: number(stats.active_orders),
    cancelled: number(stats.cancelled_orders),
    activeCredit: number(stats.active_credit_orders),
  }), [stats])

  const periodLabel = useMemo(() => formatPeriodLabel(period), [period])

  return {
    // Raw stats
    stats,
    // Processed data
    cards,
    donuts,
    trend: trendData,
    topIndicators,
    pipeline,
    comparison,
    periodLabel,
    // Query state
    loading: query.loading,
    fetching: query.fetching,
    error: query.error,
    isPlaceholderData: query.isPlaceholderData,
    refresh: query.refresh,
  }
}