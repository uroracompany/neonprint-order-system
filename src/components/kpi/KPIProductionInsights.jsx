import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts'
import { Pagination } from '../ui/Pagination'
import OrderDetailModal from '../orders/OrderDetailModal'
import { Icons } from '../../utils/icons'
import { formatDays, formatNumber } from '../../utils/kpiHelpers'

const AREA_LABELS = {
  digital: 'Digital',
  dtf: 'DTF',
  ploteo: 'Ploteo',
}

const AREA_FULL_LABELS = {
  digital: 'Producción Digital',
  dtf: 'Producción DTF',
  ploteo: 'Producción Ploteo',
}

const AREA_COLORS = {
  digital: '#06B6D4',
  dtf: '#F43F5E',
  ploteo: '#F59E0B',
}

const AREA_ICONS = {
  digital: Icons.Image,
  dtf: Icons.Package,
  ploteo: Icons.Clipboard,
}

const STATUS_META = {
  pending: { label: 'Pendientes', centerLabel: 'Pendiente', color: '#F59E0B' },
  in_production: { label: 'En Produccion', centerLabel: 'En Produccion', color: '#F97316' },
  in_termination: { label: 'En Terminacion', centerLabel: 'En Terminacion', color: '#0EA5E9' },
  completed: { label: 'Completados', centerLabel: 'Completado', color: '#10B981' },
}

const STAGE_LABELS = {
  pending: 'Pendiente',
  in_production: 'Produccion',
  in_termination: 'Terminacion',
  completed: 'Completado',
}

const PERIOD_OPTIONS = [
  { value: 'current', label: 'Actual' },
  { value: 'month-01', label: 'Enero' },
  { value: 'month-02', label: 'Febrero' },
  { value: 'month-03', label: 'Marzo' },
  { value: 'month-04', label: 'Abril' },
  { value: 'month-05', label: 'Mayo' },
  { value: 'month-06', label: 'Junio' },
  { value: 'month-07', label: 'Julio' },
  { value: 'month-08', label: 'Agosto' },
  { value: 'month-09', label: 'Septiembre' },
  { value: 'month-10', label: 'Octubre' },
  { value: 'month-11', label: 'Noviembre' },
  { value: 'month-12', label: 'Diciembre' },
  { value: 'rolling-3', label: 'Ultimos 3 meses' },
  { value: 'rolling-6', label: 'Ultimos 6 meses' },
  { value: 'rolling-12', label: 'Ultimo ano' },
]

const BOTTLENECK_PAGE_SIZE = 7
const COMPARISON_PAGE_SIZE = 7

function getAreaLabel(code, fallback) {
  return AREA_FULL_LABELS[code] || fallback || AREA_LABELS[code] || code || 'Sin area'
}

function getCompactAreaLabel(code, fallback) {
  return fallback || AREA_LABELS[code] || code || 'Sin area'
}

function getAreaIcon(code) {
  return AREA_ICONS[code] || Icons.Package
}

function getProductionStatusLabel(order) {
  const status = order?.production_file_status || order?.status
  return STAGE_LABELS[status] || status || 'Sin estado'
}

function getProductionStatusColor(order) {
  return STATUS_META[order?.production_file_status]?.color || '#64748B'
}

function getShortOrderId(orderId) {
  if (!orderId) return 'SIN-ID'
  return String(orderId).slice(0, 8).toUpperCase()
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="kpi-chart-tooltip">
      <p className="kpi-chart-tooltip-title">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} className="kpi-chart-tooltip-row" style={{ color: entry.color || entry.fill || entry.stroke }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  )
}

function MetricCard({ label, value, subtitle, icon: Icon, color, comparison, inverse = false }) {
  const hasComparison = comparison && Number.isFinite(Number(comparison.change_pct))
  const change = hasComparison ? Number(comparison.change_pct) : 0
  const isPositive = inverse ? change < 0 : change > 0
  const isNegative = inverse ? change > 0 : change < 0

  return (
    <div className="kpi-production-metric-card">
      <div className="kpi-production-metric-head">
        <span className="kpi-production-metric-label">{label}</span>
        <span className="kpi-production-metric-icon" style={{ background: `${color}18`, color }}>
          <Icon size={16} />
        </span>
      </div>
      <div className="kpi-production-metric-value">{value}</div>
      <div className="kpi-production-metric-foot">
        <span>{subtitle}</span>
        {hasComparison && (
          <span className={`kpi-production-change ${isPositive ? 'positive' : isNegative ? 'negative' : 'neutral'}`}>
            {change > 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

function InsightTile({ label, value, detail, icon: Icon, tone = 'neutral' }) {
  return (
    <div className={`kpi-production-insight-tile ${tone}`}>
      <span className="kpi-production-insight-icon">
        <Icon size={16} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

function EmptyState({ children = 'No hay datos suficientes para este periodo.' }) {
  return (
    <div className="kpi-production-empty">
      <Icons.AlertCircle size={18} />
      <span>{children}</span>
    </div>
  )
}

function buildAreas(prod) {
  if (Array.isArray(prod.areas) && prod.areas.length > 0) return prod.areas

  return Object.entries(prod.area_load || {}).map(([code, stats]) => ({
    code,
    label: AREA_LABELS[code] || code,
    total_files: stats.total || 0,
    active_files: stats.active || (stats.pending || 0) + (stats.in_production || 0) + (stats.in_termination || 0),
    completed: stats.completed || 0,
    pending: stats.pending || 0,
    in_production: stats.in_production || 0,
    in_termination: stats.in_termination || 0,
    completion_rate: stats.completion_rate || 0,
    avg_time_days: stats.avg_time_days || 0,
    reversions: stats.reversions || 0,
    reversion_rate: stats.reversion_rate || 0,
    normal: stats.normal || 0,
    urgent_911: stats.urgent_911 || 0,
    urgent_pct: stats.urgent_pct || 0,
  }))
}

function getPeriodPayload(history, value, fallbackAreas) {
  if (value === 'current') {
    return history?.current || { key: 'current', label: 'Actual', areas: fallbackAreas, total_files: 0 }
  }

  if (value.startsWith('month-')) {
    return history?.months?.find(period => period.key === value) || { key: value, label: PERIOD_OPTIONS.find(option => option.value === value)?.label || value, areas: [], total_files: 0 }
  }

  return history?.rolling?.find(period => period.key === value) || { key: value, label: PERIOD_OPTIONS.find(option => option.value === value)?.label || value, areas: [], total_files: 0 }
}

function toAreaChartRows(areaRows = []) {
  return areaRows.map(area => ({
    code: area.code,
    name: area.label || AREA_LABELS[area.code] || area.code,
    Pendientes: area.pending || 0,
    Produccion: area.in_production || 0,
    Terminacion: area.in_termination || 0,
    Completados: area.completed || 0,
    Total: area.total_files || 0,
    Normal: area.normal || 0,
    '911': area.urgent_911 || 0,
  }))
}

export default function KPIProductionInsights({ data, onAreaClick }) {
  const [bottleneckPage, setBottleneckPage] = useState(1)
  const [comparisonPage, setComparisonPage] = useState(1)
  const [areaPeriodFilter, setAreaPeriodFilter] = useState('current')
  const [areaChartType, setAreaChartType] = useState('bar')
  const [selectedOrder, setSelectedOrder] = useState(null)

  const prod = data?.production_insights || {}
  const areas = useMemo(() => buildAreas(prod), [prod])
  const stageTiming = prod.stage_timing || {}
  const bottlenecks = Array.isArray(prod.bottlenecks) ? prod.bottlenecks : []
  const fileStatus = prod.file_status || {}
  const trend = Array.isArray(prod.trend) ? prod.trend : []
  const quality = prod.quality || {}
  const comparison = prod.comparison || {}
  const history = prod.history || {}
  const priorityBreakdown = prod.priority_breakdown || { normal: 0, urgent_911: 0, total: 0, urgent_pct: 0 }
  const areaPriorityBreakdown = Array.isArray(prod.area_priority_breakdown) ? prod.area_priority_breakdown : []
  const areaComparison = Array.isArray(prod.area_comparison) && prod.area_comparison.length > 0 ? prod.area_comparison : areas
  const capacityDistribution = Array.isArray(prod.capacity_distribution) ? prod.capacity_distribution : []
  const agingBuckets = Array.isArray(prod.aging_buckets) ? prod.aging_buckets : []
  const operationalInsights = prod.operational_insights || {}
  const totals = prod.totals || {
    total_files: prod.total_files || fileStatus.total || 0,
    active_files: (fileStatus.pending || 0) + (fileStatus.in_production || 0) + (fileStatus.in_termination || 0),
    completed: prod.total_completed || fileStatus.completed || 0,
    completion_rate: fileStatus.total ? ((fileStatus.completed || 0) / fileStatus.total) * 100 : 0,
    bottleneck_count: bottlenecks.length,
    avg_cycle_time_days: stageTiming.total_cycle_time || 0,
  }

  const selectedPeriod = useMemo(
    () => getPeriodPayload(history, areaPeriodFilter, areas),
    [history, areaPeriodFilter, areas]
  )
  const selectedAreaRows = selectedPeriod.areas?.length ? selectedPeriod.areas : (areaPeriodFilter === 'current' ? areas : [])
  const areaBarData = useMemo(() => toAreaChartRows(selectedAreaRows), [selectedAreaRows])
  const hasSelectedAreaData = areaBarData.some(row => row.Total > 0)

  const filePieData = useMemo(() => Object.entries(STATUS_META)
    .map(([key, meta]) => ({ key, name: meta.label, centerLabel: meta.centerLabel, value: fileStatus[key] || 0, color: meta.color }))
    .filter(item => item.value > 0), [fileStatus])

  const dominantStatus = useMemo(() => {
    const statusRows = Object.entries(STATUS_META).map(([key, meta]) => ({
      key,
      label: meta.centerLabel,
      value: fileStatus[key] || 0,
      color: meta.color,
    }))
    const total = statusRows.reduce((sum, item) => sum + item.value, 0)
    if (total <= 0) return null
    const dominant = statusRows.reduce((best, item) => (item.value > best.value ? item : best), statusRows[0])
    return {
      ...dominant,
      pct: roundDisplay((dominant.value / total) * 100),
    }
  }, [fileStatus])

  const statusTotal = Object.keys(STATUS_META).reduce((sum, key) => sum + (Number(fileStatus[key]) || 0), 0)
  const statusRows = useMemo(() => Object.entries(STATUS_META).map(([key, meta]) => {
    const value = Number(fileStatus[key]) || 0
    const pct = statusTotal > 0 ? roundDisplay((value / statusTotal) * 100) : 0
    return { key, ...meta, value, pct }
  }), [fileStatus, statusTotal])

  const timingRows = [
    { label: 'Entrada a inicio', value: stageTiming.quote_to_production, color: '#F59E0B' },
    { label: 'Produccion a terminacion', value: stageTiming.production_to_termination, color: '#F97316' },
    { label: 'Terminacion a cierre', value: stageTiming.termination_to_completion, color: '#0EA5E9' },
    { label: 'Ciclo total', value: stageTiming.total_cycle_time, color: '#10B981' },
  ]

  const operationAlerts = [
    bottlenecks.length > 0 && {
      tone: 'danger',
      title: `${bottlenecks.length} cuello${bottlenecks.length === 1 ? '' : 's'} de botella`,
      detail: 'Archivos con mas de 3 dias detenidos en una etapa.',
    },
    totals.active_files > totals.completed && {
      tone: 'warning',
      title: 'Carga activa mayor a salida',
      detail: `${formatNumber(totals.active_files)} archivos siguen abiertos en el flujo.`,
    },
    priorityBreakdown.urgent_pct > 30 && {
      tone: 'warning',
      title: 'Alta participacion 911',
      detail: `${formatNumber(priorityBreakdown.urgent_pct, { decimals: 1 })}% de la carga productiva es urgente.`,
    },
    quality.reversion_rate > 10 && {
      tone: 'warning',
      title: 'Retrabajo elevado',
      detail: `${quality.reversion_rate}% de reversiones en el periodo.`,
    },
    totals.avg_cycle_time_days > 7 && {
      tone: 'warning',
      title: 'Ciclo productivo lento',
      detail: `Promedio general de ${formatDays(totals.avg_cycle_time_days)}.`,
    },
  ].filter(Boolean)

  const historicalTrend = useMemo(() => {
    const months = Array.isArray(history.months) ? history.months : []
    return months.map(month => {
      const row = { name: month.label?.slice(0, 3) || month.key, Total: month.total_files || 0 }
      ;(month.areas || []).forEach(area => {
        row[area.label || AREA_LABELS[area.code] || area.code] = area.total_files || 0
      })
      return row
    })
  }, [history])
  const hasHistoricalTrend = historicalTrend.some(row => row.Total > 0)

  const areaPriorityData = useMemo(() => {
    const rows = areaPriorityBreakdown.length > 0 ? areaPriorityBreakdown : areaComparison
    return rows.map(area => ({
      name: area.label || AREA_LABELS[area.code] || area.code,
      Normal: area.normal || 0,
      '911': area.urgent_911 || 0,
      Total: area.total || area.total_files || 0,
    }))
  }, [areaPriorityBreakdown, areaComparison])
  const hasPriorityAreaData = areaPriorityData.some(row => row.Total > 0)

  const totalBottleneckPages = Math.max(1, Math.ceil(bottlenecks.length / BOTTLENECK_PAGE_SIZE))
  const safeBottleneckPage = Math.min(bottleneckPage, totalBottleneckPages)
  const paginatedBottlenecks = bottlenecks.slice(
    (safeBottleneckPage - 1) * BOTTLENECK_PAGE_SIZE,
    safeBottleneckPage * BOTTLENECK_PAGE_SIZE
  )
  const totalComparisonPages = Math.max(1, Math.ceil(areaComparison.length / COMPARISON_PAGE_SIZE))
  const safeComparisonPage = Math.min(comparisonPage, totalComparisonPages)
  const paginatedAreaComparison = areaComparison.slice(
    (safeComparisonPage - 1) * COMPARISON_PAGE_SIZE,
    safeComparisonPage * COMPARISON_PAGE_SIZE
  )

  const hasAnyProductionData = (totals.total_files || 0) > 0 || areas.length > 0
  const dominantArea = operationalInsights.dominant_area
  const highest911Area = operationalInsights.highest_911_area
  const fastestArea = operationalInsights.fastest_area
  const pressureArea = operationalInsights.pressure_area

  if (!data) return null

  return (
    <div className="kpi-section kpi-production-dashboard">
      <div className="kpi-production-hero">
        <div>
          <span className="kpi-section-kicker">Panel de Produccion</span>
          <h2 className="kpi-section-title">Estado Operativo de Produccion</h2>
          <p className="kpi-section-subtitle">
            Rendimiento del departamento, flujo de trabajo, cumplimiento y cuellos de botella del proceso productivo.
          </p>
        </div>
        <div className="kpi-production-hero-note">
          <Icons.Brush size={18} />
          <span>Vista departamental, sin evaluacion individual de empleados</span>
        </div>
      </div>

      <div className="kpi-production-metrics-grid">
        <MetricCard
          label="Trabajo activo"
          value={formatNumber(totals.active_files || 0)}
          subtitle="Pendiente, produccion y terminacion"
          icon={Icons.Package}
          color="#F97316"
          comparison={comparison.active_files}
          inverse
        />
        <MetricCard
          label="Completados"
          value={formatNumber(totals.completed || 0)}
          subtitle={`${formatNumber(totals.total_files || 0)} archivos en el periodo`}
          icon={Icons.CheckCircle}
          color="#10B981"
          comparison={comparison.completed}
        />
        <MetricCard
          label="Finalizacion"
          value={`${formatNumber(totals.completion_rate || 0, { decimals: 1 })}%`}
          subtitle="Salida efectiva del flujo"
          icon={Icons.TrendUp}
          color="#06B6D4"
        />
        <MetricCard
          label="Cuellos"
          value={formatNumber(totals.bottleneck_count ?? bottlenecks.length)}
          subtitle="Mas de 3 dias en etapa"
          icon={Icons.AlertCircle}
          color="#EF4444"
        />
        <MetricCard
          label="Ciclo prom."
          value={formatDays(totals.avg_cycle_time_days || 0)}
          subtitle="Creacion a completado"
          icon={Icons.Clock}
          color="#8B5CF6"
          comparison={comparison.avg_cycle_time_days}
          inverse
        />
        <MetricCard
          label="Carga 911"
          value={`${formatNumber(priorityBreakdown.urgent_pct || 0, { decimals: 1 })}%`}
          subtitle={`${formatNumber(priorityBreakdown.urgent_911 || 0)} urgentes de ${formatNumber(priorityBreakdown.total || 0)}`}
          icon={Icons.Bell}
          color="#DC2626"
        />
      </div>

      {!hasAnyProductionData ? (
        <EmptyState>No hay datos de produccion disponibles para el periodo seleccionado.</EmptyState>
      ) : (
        <>
          <div className="kpi-production-area-strip">
            {areas.map(area => {
              const color = AREA_COLORS[area.code] || '#64748B'
              return (
                <div key={area.code} className="kpi-production-area-card" style={{ '--area-color': color }}>
                  <div className="kpi-production-area-top">
                    <span>{area.label || AREA_LABELS[area.code] || area.code}</span>
                    <strong>{formatNumber(area.active_files || 0)}</strong>
                  </div>
                  <div className="kpi-production-area-bar">
                    <span style={{ width: `${Math.min(area.completion_rate || 0, 100)}%` }} />
                  </div>
                  <div className="kpi-production-area-meta">
                    <span>{formatNumber(area.completed || 0)} completados</span>
                    <span>{formatNumber(area.completion_rate || 0, { decimals: 1 })}% cierre</span>
                    <span>{formatNumber(area.urgent_pct || 0, { decimals: 1 })}% 911</span>
                  </div>
                  <button
                    type="button"
                    className="kpi-production-area-detail-btn"
                    onClick={() => onAreaClick?.(area.code)}
                  >
                    <Icons.Eye size={13} />
                    Ver detalles de area
                  </button>
                </div>
              )
            })}
          </div>

          <div className="kpi-production-insights-grid">
            <InsightTile
              label="Area dominante"
              value={dominantArea?.label || 'Sin datos'}
              detail={dominantArea ? `${formatNumber(dominantArea.value)} archivos, ${formatNumber(dominantArea.pct || 0, { decimals: 1 })}% del total` : 'Sin carga registrada'}
              icon={Icons.Package}
              tone="info"
            />
            <InsightTile
              label="Mayor carga 911"
              value={highest911Area?.label || 'Sin datos'}
              detail={highest911Area ? `${formatNumber(highest911Area.value)} urgentes, ${formatNumber(highest911Area.pct || 0, { decimals: 1 })}% del area` : 'Sin urgentes registrados'}
              icon={Icons.Bell}
              tone="danger"
            />
            <InsightTile
              label="Area mas eficiente"
              value={fastestArea?.label || 'Sin datos'}
              detail={fastestArea ? `${formatDays(fastestArea.value)} de ciclo promedio` : 'Aun sin cierres medibles'}
              icon={Icons.TrendUp}
              tone="success"
            />
            <InsightTile
              label="Mayor presion"
              value={pressureArea?.label || 'Sin datos'}
              detail={pressureArea ? `${formatNumber(pressureArea.active_files || 0)} activos, ${formatNumber(pressureArea.bottlenecks || 0)} cuellos` : 'Operacion estable'}
              icon={Icons.AlertCircle}
              tone="warning"
            />
          </div>

          <div className="kpi-production-grid">
            <div className="kpi-card kpi-production-chart-card">
              <div className="kpi-production-card-head">
                <div>
                  <h3 className="kpi-card-subtitle">Carga por area</h3>
                  <span>{selectedPeriod.label || 'Actual'} · {formatNumber(selectedPeriod.total_files || 0)} archivos</span>
                </div>
                <div className="kpi-production-chart-controls">
                  <select
                    className="kpi-production-period-select"
                    value={areaPeriodFilter}
                    onChange={(event) => setAreaPeriodFilter(event.target.value)}
                    aria-label="Periodo de carga por area"
                  >
                    {PERIOD_OPTIONS.map(option => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="kpi-production-segmented" aria-label="Tipo de grafico">
                    <button type="button" className={areaChartType === 'bar' ? 'active' : ''} onClick={() => setAreaChartType('bar')} aria-pressed={areaChartType === 'bar'}>
                      Barras
                    </button>
                    <button type="button" className={areaChartType === 'area' ? 'active' : ''} onClick={() => setAreaChartType('area')} aria-pressed={areaChartType === 'area'}>
                      Area
                    </button>
                  </div>
                </div>
              </div>
              {hasSelectedAreaData ? (
                <div className="kpi-production-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    {areaChartType === 'bar' ? (
                      <BarChart data={areaBarData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Bar dataKey="Pendientes" stackId="a" fill="#F59E0B" />
                        <Bar dataKey="Produccion" stackId="a" fill="#F97316" />
                        <Bar dataKey="Terminacion" stackId="a" fill="#0EA5E9" />
                        <Bar dataKey="Completados" stackId="a" fill="#10B981" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    ) : (
                      <AreaChart data={areaBarData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                        <Area type="monotone" dataKey="Pendientes" stackId="a" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.24} />
                        <Area type="monotone" dataKey="Produccion" stackId="a" stroke="#F97316" fill="#F97316" fillOpacity={0.24} />
                        <Area type="monotone" dataKey="Terminacion" stackId="a" stroke="#0EA5E9" fill="#0EA5E9" fillOpacity={0.24} />
                        <Area type="monotone" dataKey="Completados" stackId="a" stroke="#10B981" fill="#10B981" fillOpacity={0.24} />
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState>No hay carga por area para este periodo.</EmptyState>
              )}
            </div>

            <div className="kpi-card kpi-production-chart-card">
              <h3 className="kpi-card-subtitle">Pipeline por estado</h3>
              {filePieData.length > 0 ? (
                <div className="kpi-production-pipeline-layout">
                  <div className="kpi-production-pie">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={filePieData} cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={3} dataKey="value">
                          {filePieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    {dominantStatus && (
                      <div className="kpi-production-pie-center">
                        <span>{dominantStatus.label}</span>
                        <strong>{formatNumber(dominantStatus.pct, { decimals: dominantStatus.pct % 1 === 0 ? 0 : 1 })}%</strong>
                      </div>
                    )}
                  </div>
                  <div className="kpi-production-status-list">
                    {statusRows.map(row => (
                      <div key={row.key} className="kpi-production-status-row">
                        <span className="kpi-production-status-dot" style={{ background: row.color }} />
                        <span className="kpi-production-status-label">{row.label}</span>
                        <span className="kpi-production-status-values">
                          <strong>{formatNumber(row.value)}</strong>
                          <span className="kpi-production-status-percent" style={{ color: row.color }}>
                            {formatNumber(row.pct, { decimals: row.pct % 1 === 0 ? 0 : 1 })}%
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState />
              )}
            </div>
          </div>

          <div className="kpi-production-grid">
            <div className="kpi-card kpi-production-chart-card">
              <h3 className="kpi-card-subtitle">Prioridad por area</h3>
              {hasPriorityAreaData ? (
                <div className="kpi-production-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={areaPriorityData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                      <Bar dataKey="Normal" stackId="priority" fill="#06B6D4" radius={[0, 0, 6, 6]} />
                      <Bar dataKey="911" stackId="priority" fill="#DC2626" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState>No hay distribucion de prioridad disponible.</EmptyState>
              )}
            </div>

            <div className="kpi-card kpi-production-chart-card">
              <h3 className="kpi-card-subtitle">Evolucion historica de carga</h3>
              {hasHistoricalTrend ? (
                <div className="kpi-production-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historicalTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                      {areas.map((area, index) => {
                        const name = area.label || AREA_LABELS[area.code] || area.code
                        return (
                          <Area
                            key={area.code || name}
                            type="monotone"
                            dataKey={name}
                            stackId="history"
                            stroke={AREA_COLORS[area.code] || ['#06B6D4', '#F43F5E', '#F59E0B'][index % 3]}
                            fill={AREA_COLORS[area.code] || ['#06B6D4', '#F43F5E', '#F59E0B'][index % 3]}
                            fillOpacity={0.24}
                          />
                        )
                      })}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState>No hay historia suficiente para graficar tendencia.</EmptyState>
              )}
            </div>
          </div>

          <div className="kpi-production-grid">
            <div className="kpi-card kpi-production-chart-card">
              <h3 className="kpi-card-subtitle">Evolucion del flujo</h3>
              {trend.length > 0 ? (
                <div className="kpi-production-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                      <Line type="monotone" dataKey="total" name="Ingresados" stroke="#091127" strokeWidth={3} dot={false} />
                      <Line type="monotone" dataKey="completed" name="Completados" stroke="#10B981" strokeWidth={3} dot={false} />
                      <Line type="monotone" dataKey="active" name="Activos" stroke="#F97316" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState />
              )}
            </div>

            <div className="kpi-card kpi-production-chart-card">
              <h3 className="kpi-card-subtitle">Tiempos por etapa</h3>
              <div className="kpi-production-timing-list">
                {timingRows.map(row => (
                  <div key={row.label} className="kpi-production-timing-row">
                    <div>
                      <span>{row.label}</span>
                      <strong>{formatDays(row.value || 0)}</strong>
                    </div>
                    <div className="kpi-production-timing-track">
                      <span style={{ width: `${Math.min(((row.value || 0) / Math.max(totals.avg_cycle_time_days || 1, 1)) * 100, 100)}%`, background: row.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="kpi-production-grid">
            <div className="kpi-card kpi-production-alert-card">
              <h3 className="kpi-card-subtitle">Alertas operativas</h3>
              {operationAlerts.length > 0 ? (
                <div className="kpi-production-alert-list">
                  {operationAlerts.map(alert => (
                    <div key={alert.title} className={`kpi-production-alert ${alert.tone}`}>
                      <Icons.AlertCircle size={16} />
                      <div>
                        <strong>{alert.title}</strong>
                        <span>{alert.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="kpi-production-alert stable">
                  <Icons.CheckCircle size={16} />
                  <div>
                    <strong>Operacion estable</strong>
                    <span>No hay senales criticas para este periodo.</span>
                  </div>
                </div>
              )}
            </div>

            <div className="kpi-card kpi-production-alert-card">
              <h3 className="kpi-card-subtitle">Lectura del departamento</h3>
              <div className="kpi-production-readout">
                <div><strong>{formatNumber(totals.total_files || 0)}</strong><span>archivos gestionados</span></div>
                <div><strong>{formatNumber(totals.active_files || 0)}</strong><span>siguen en flujo</span></div>
                <div><strong>{formatNumber(quality.reversions || 0)}</strong><span>reversiones registradas</span></div>
                <div><strong>{formatNumber(priorityBreakdown.normal || 0)}</strong><span>ordenes normales</span></div>
              </div>
            </div>
          </div>

          <div className="kpi-production-grid">
            <div className="kpi-card kpi-production-alert-card">
              <h3 className="kpi-card-subtitle">Aging de carga activa</h3>
              {agingBuckets.length > 0 ? (
                <div className="kpi-production-aging-list">
                  {agingBuckets.map(bucket => {
                    const pct = totals.active_files > 0 ? (bucket.count / totals.active_files) * 100 : 0
                    return (
                      <div key={bucket.key} className="kpi-production-aging-row">
                        <div>
                          <span>{bucket.label}</span>
                          <strong>{formatNumber(bucket.count)}</strong>
                        </div>
                        <div className="kpi-production-aging-track">
                          <span style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState>No hay carga activa para analizar aging.</EmptyState>
              )}
            </div>

            <div className="kpi-card kpi-production-alert-card">
              <h3 className="kpi-card-subtitle">Carga asignada</h3>
              {capacityDistribution.length > 0 ? (
                <div className="kpi-production-capacity-list">
                  {capacityDistribution.map(item => {
                    const areaColor = AREA_COLORS[item.area_code] || '#64748B'
                    const AreaIcon = getAreaIcon(item.area_code)
                    const orders = Array.isArray(item.orders) ? item.orders : []
                    return (
                      <article
                        key={`${item.user_id || 'unassigned'}-${item.area_code || 'sin-area'}`}
                        className="kpi-production-capacity-row"
                        style={{ '--area-color': areaColor }}
                      >
                        <div className="kpi-production-capacity-card-head">
                          <span className="kpi-production-capacity-avatar">
                            <Icons.Users size={15} />
                          </span>
                          <div className="kpi-production-capacity-person">
                            <strong>{item.name || 'Sin asignar'}</strong>
                            <span className="kpi-production-area-chip">
                              <AreaIcon size={13} />
                              {getAreaLabel(item.area_code, item.area_label)}
                            </span>
                          </div>
                          <div className="kpi-production-capacity-count">
                            <strong>{formatNumber(item.active_count || 0)}</strong>
                            <span>{formatNumber(item.assigned_count || 0)} asignadas</span>
                          </div>
                        </div>

                        <div className="kpi-production-capacity-orders" aria-label="Ordenes asignadas">
                          {orders.length > 0 ? (
                            orders.map(order => (
                              <button
                                type="button"
                                key={`${item.user_id || 'unassigned'}-${item.area_code}-${order.id}`}
                                className="kpi-production-capacity-order"
                                onClick={() => setSelectedOrder(order)}
                              >
                                <span className="kpi-production-capacity-order-icon">
                                  <Icons.Eye size={13} />
                                </span>
                                <span className="kpi-production-capacity-order-meta">
                                  <strong>#{getShortOrderId(order.id)}</strong>
                                  <small>{order.client_name || 'Sin cliente'}</small>
                                </span>
                                <span className="kpi-production-capacity-order-status" style={{ color: getProductionStatusColor(order) }}>
                                  {getProductionStatusLabel(order)}
                                </span>
                              </button>
                            ))
                          ) : (
                            <span className="kpi-production-capacity-no-orders">Sin ordenes inspeccionables</span>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <EmptyState>No hay asignaciones de capacidad para este periodo.</EmptyState>
              )}
            </div>
          </div>

          {areaComparison.length > 0 && (
            <div className="kpi-table-wrapper kpi-production-table-wrapper kpi-production-comparison-wrapper">
              <div className="kpi-production-table-header">
                <h3 className="kpi-card-subtitle">Comparativa de areas</h3>
                <span>Volumen, prioridad, eficiencia y presion operativa</span>
              </div>
              <table className="kpi-table kpi-production-comparison-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Total</th>
                    <th>Activas</th>
                    <th>Cierre</th>
                    <th>Promedio</th>
                    <th>911</th>
                    <th>Participacion</th>
                    <th>Cuellos</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedAreaComparison.map(area => {
                    const areaColor = AREA_COLORS[area.code] || '#64748B'
                    const AreaIcon = getAreaIcon(area.code)
                    const participation = Number(area.pct_of_total) || 0
                    return (
                      <tr key={area.code} style={{ '--area-color': areaColor }}>
                        <td>
                          <span className="kpi-production-area-cell">
                            <span className="kpi-production-area-icon"><AreaIcon size={14} /></span>
                            <span>
                              <strong>{getCompactAreaLabel(area.code, area.label)}</strong>
                              <small>{formatNumber(area.total_files || 0)} archivos gestionados</small>
                            </span>
                          </span>
                        </td>
                        <td><span className="kpi-production-metric-chip">{formatNumber(area.total_files || 0)}</span></td>
                        <td>{formatNumber(area.active_files || 0)}</td>
                        <td>{formatNumber(area.completion_rate || 0, { decimals: 1 })}%</td>
                        <td>{formatDays(area.avg_time_days || 0)}</td>
                        <td>
                          <span className={(area.urgent_911 || 0) > 0 ? 'kpi-production-risk-pill danger' : 'kpi-production-risk-pill'}>
                            {formatNumber(area.urgent_pct || 0, { decimals: 1 })}%
                          </span>
                        </td>
                        <td>
                          <span className="kpi-production-progress-cell">
                            <span>{formatNumber(participation, { decimals: 1 })}%</span>
                            <span className="kpi-production-progress-track"><i style={{ width: `${Math.min(participation, 100)}%` }} /></span>
                          </span>
                        </td>
                        <td>
                          <span className={(area.bottlenecks || 0) > 0 ? 'kpi-production-risk-pill danger' : 'kpi-production-risk-pill'}>
                            {formatNumber(area.bottlenecks || 0)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="acm-pagination-footer">
                <Pagination currentPage={safeComparisonPage} totalPages={totalComparisonPages} onPageChange={setComparisonPage} />
              </div>
            </div>
          )}

          {bottlenecks.length > 0 && (
            <div className="kpi-table-wrapper kpi-production-table-wrapper">
              <div className="kpi-production-table-header">
                <h3 className="kpi-card-subtitle danger">Cuellos de botella</h3>
                <span>Ordenes o archivos con mas de 3 dias sin avanzar</span>
              </div>
              <table className="kpi-table kpi-production-bottleneck-table">
                <thead>
                  <tr><th>Orden</th><th>Cliente</th><th>Area</th><th>Etapa</th><th>Dias</th></tr>
                </thead>
                <tbody>
                  {paginatedBottlenecks.map((item, index) => (
                    <tr key={`${item.file_id || item.order_id}-${index}`} style={{ '--area-color': AREA_COLORS[item.area_code] || '#64748B' }}>
                      <td><span className="kpi-production-order-code">#{getShortOrderId(item.order_id)}</span></td>
                      <td>
                        <span className="kpi-production-client-cell">
                          <Icons.Users size={14} />
                          <strong>{item.client_name || 'Sin nombre'}</strong>
                        </span>
                      </td>
                      <td>
                        <span className="kpi-production-area-pill">
                          {getCompactAreaLabel(item.area_code)}
                        </span>
                      </td>
                      <td>
                        <span className="kpi-production-stage-pill">{STAGE_LABELS[item.stage] || item.stage}</span>
                      </td>
                      <td><span className="kpi-production-days-pill">{formatDays(item.days_in_stage || 0)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="acm-pagination-footer">
                <Pagination currentPage={safeBottleneckPage} totalPages={totalBottleneckPages} onPageChange={setBottleneckPage} />
              </div>
            </div>
          )}
        </>
      )}
      <OrderDetailModal
        open={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        showPrimaryAction={false}
      />
    </div>
  )
}

function roundDisplay(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return +number.toFixed(1)
}
