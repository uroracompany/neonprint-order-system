import { useState } from 'react'
import { Icons } from '../../utils/icons'
import { formatNumber } from '../../utils/kpiHelpers'

const METRIC_GROUPS = [
  {
    label: 'Totales generales',
    options: [
      { value: 'totals.all', label: 'Todas las órdenes' },
      { value: 'totals.internal', label: 'Órdenes internas' },
      { value: 'totals.external', label: 'Órdenes externas' },
      { value: 'totals.normal', label: 'Órdenes normales' },
      { value: 'totals.urgent_911', label: 'Órdenes 911' },
    ],
  },
  {
    label: 'Combinaciones de tipo',
    options: [
      { value: 'combinations.internal_normal', label: 'Internas normales' },
      { value: 'combinations.internal_911', label: 'Internas 911' },
      { value: 'combinations.external_normal', label: 'Externas normales' },
      { value: 'combinations.external_911', label: 'Externas 911' },
    ],
  },
  {
    label: 'Estado del pago',
    options: [
      { value: 'payment.pending', label: 'Pago pendiente' },
      { value: 'payment.partial', label: 'Pago parcial' },
      { value: 'payment.paid', label: 'Pagadas' },
      { value: 'payment.credit', label: 'A crédito' },
    ],
  },
  {
    label: 'Estado del flujo',
    options: [
      { value: 'workflow.pending', label: 'Pendientes' },
      { value: 'workflow.design', label: 'En diseño' },
      { value: 'workflow.quote', label: 'En cotización' },
      { value: 'workflow.production', label: 'En producción' },
      { value: 'workflow.termination', label: 'En terminación' },
      { value: 'workflow.completed', label: 'Completadas' },
      { value: 'workflow.delivered', label: 'Entregadas' },
    ],
  },
  {
    label: 'Operacional',
    options: [
      { value: 'operational.active', label: 'Activas' },
      { value: 'operational.blocked', label: 'Bloqueadas' },
    ],
  },
]

const DATE_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: '3m', label: 'Últimos 3 meses' },
  { value: '6m', label: 'Últimos 6 meses' },
  { value: '1y', label: 'Último año' },
  { value: '3y', label: 'Últimos 3 años' },
  { value: '5y', label: 'Últimos 5 años' },
  { value: 'all', label: 'Todo' },
]

function getCountByPath(counts, path) {
  if (!counts) return 0
  const [group, key] = path.split('.')
  return counts[group]?.[key] ?? 0
}

function getMetricLabel(path) {
  for (const group of METRIC_GROUPS) {
    const opt = group.options.find(o => o.value === path)
    if (opt) return opt.label
  }
  return ''
}

function getDateLabel(value) {
  return DATE_OPTIONS.find(o => o.value === value)?.label || ''
}

export default function KPIOrderCountCard({ data }) {
  const [metric, setMetric] = useState('totals.all')
  const [dateFilter, setDateFilter] = useState('all')

  if (!data) return null

  const allCounts = data.order_counts_by_date || {}
  const counts = allCounts[dateFilter] || {}
  const value = getCountByPath(counts, metric)
  const metricLabel = getMetricLabel(metric)
  const dateLabel = getDateLabel(dateFilter)

  return (
    <div className="kpi-order-count-card">
      <div className="kpi-order-count-top">
        <div className="kpi-order-count-icon">
          <Icons.Orders size={20} />
        </div>
        <div className="kpi-order-count-header">
          <span className="kpi-order-count-title">Total de Órdenes</span>
          <div className="kpi-order-count-filters">
            <select
              className="kpi-order-count-select"
              value={metric}
              onChange={e => setMetric(e.target.value)}
            >
              {METRIC_GROUPS.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              className="kpi-order-count-select"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
            >
              {DATE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="kpi-order-count-value">{formatNumber(value)}</div>
      <div className="kpi-order-count-subtitle">{metricLabel} · {dateLabel}</div>
    </div>
  )
}
