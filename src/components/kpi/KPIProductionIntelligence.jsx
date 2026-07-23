import { useState, useEffect, useCallback, useMemo } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, AreaChart, Area } from 'recharts'
import OrderDetailModal from '../orders/OrderDetailModal'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays } from '../../utils/kpiHelpers'
import { adminApiFetch } from '../../utils/adminApi'

const AREA_COLORS = { digital: '#06B6D4', dtf: '#F43F5E', ploteo: '#F59E0B' }
const AREA_ICONS = { digital: Icons.Image, dtf: Icons.Package, ploteo: Icons.Clipboard }
const AREA_FULL_LABELS = { digital: 'Producción Digital', dtf: 'Producción DTF', ploteo: 'Producción Ploteo' }
const LINE_COLORS = ['#06B6D4', '#F43F5E', '#F59E0B', '#10B981', '#8B5CF6', '#F97316']
const STATUS_COLORS = { pending: '#F59E0B', in_production: '#F97316', in_termination: '#0EA5E9', completed: '#10B981' }
const STATUS_LABELS = { pending: 'Pendiente', in_production: 'En Produccion', in_termination: 'En Terminacion', completed: 'Completado' }
const COLORS = { area: '#091127', positive: '#10B981', warning: '#F59E0B', negative: '#EF4444', muted: '#64748b', accent: '#8B5CF6', info: '#0EA5E9' }
const CHART_PERIODS = [
  { key: '7d', label: '7d' },
  { key: '1m', label: '1m' },
  { key: '3m', label: '3m' },
  { key: '6m', label: '6m' },
]

function getAreaDisplayName(areaCode, fallback) {
  return AREA_FULL_LABELS[areaCode] || fallback || areaCode || 'Area de Produccion'
}

function getShortOrderId(orderId) {
  if (!orderId) return 'SIN-ID'
  return String(orderId).slice(0, 8).toUpperCase()
}

function getStageLabel(status) {
  return STATUS_LABELS[status] || status || 'Sin estado'
}

function getDateBoundsForPeriod(period, customDateFrom, customDateTo) {
  if (period === 'custom' && customDateFrom && customDateTo) {
    return { date_from: customDateFrom, date_to: customDateTo }
  }
  const now = new Date()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const from = new Date(to)
  if (period === 'today') from.setHours(0, 0, 0, 0)
  else if (period === 'week') from.setDate(from.getDate() - from.getDay())
  else if (period === 'year') { from.setMonth(0, 1); from.setDate(1) }
  else from.setDate(1)
  return { date_from: from.toISOString(), date_to: to.toISOString() }
}

function getCompareBounds(bounds) {
  if (!bounds?.date_from || !bounds?.date_to) return {}
  const from = new Date(bounds.date_from)
  const to = new Date(bounds.date_to)
  const duration = to.getTime() - from.getTime()
  return { compare_from: new Date(from.getTime() - duration).toISOString(), compare_to: bounds.date_from }
}

function getChartBounds(chartPeriod, chartCustom, chartDateFrom, chartDateTo) {
  if (chartCustom && chartDateFrom && chartDateTo) {
    return { date_from: `${chartDateFrom}T00:00:00`, date_to: `${chartDateTo}T23:59:59` }
  }
  const now = new Date()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const from = new Date(to)
  if (chartPeriod === '7d') from.setDate(from.getDate() - 7)
  else if (chartPeriod === '3m') from.setMonth(from.getMonth() - 3)
  else if (chartPeriod === '6m') from.setMonth(from.getMonth() - 6)
  else from.setMonth(from.getMonth() - 1)
  return { date_from: from.toISOString(), date_to: to.toISOString() }
}

function getPeriodLabel(period, customDateFrom, customDateTo) {
  if (period === 'today') return 'Hoy'
  if (period === 'week') return 'Esta semana'
  if (period === 'year') return `${new Date().getFullYear()}`
  if (period === 'custom' && customDateFrom && customDateTo) {
    return `${new Date(customDateFrom).toLocaleDateString('es-DO')} - ${new Date(customDateTo).toLocaleDateString('es-DO')}`
  }
  return new Date().toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })
}

function H({ children, color = '#091127' }) {
  return <strong style={{ color, fontWeight: 700 }}>{children}</strong>
}

function StatusDot({ color }) {
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, verticalAlign: 'middle', marginRight: 5 }} />
}

function generateSummary({ area, total_files, total_orders, completed, completion_rate, avg_time_days, users, bottlenecks, periodLabel }) {
  const areaName = area || 'Esta area'
  const s = total_files !== 1 ? 's' : ''
  const so = total_orders !== 1 ? 'es' : ''

  if (total_files === 0) {
    return (
      <span>
        <H color="#64748b">{areaName}</H> no registró actividad durante <H>{periodLabel}</H>. No hay archivos ni órdenes procesadas en este período.
      </span>
    )
  }

  if (completed === 0) {
    return (
      <span>
        <H color="#64748b">{areaName}</H> recibió <H color={COLORS.area}>{formatNumber(total_files)} archivo{s}</H> durante <H>{periodLabel}</H>, distribuidos en <H color="#0EA5E9">{formatNumber(total_orders)} orden{so}</H> activa{total_orders !== 1 ? 's' : ''}. <StatusDot color="#F59E0B" /><H color="#D97706">Actualmente no existen archivos completados</H>, lo que indica que todo el flujo se encuentra en proceso.
      </span>
    )
  }

  if (completion_rate >= 70) {
    return (
      <span>
        <H color="#64748b">{areaName}</H> mantiene un <StatusDot color="#10B981" /><H color="#059669">alto nivel de productividad</H> con <H color="#10B981">{completion_rate}%</H> de finalización, <H color="#8B5CF6">{formatDays(avg_time_days)}</H> de tiempo promedio y <H color={COLORS.area}>{formatNumber(completed)}</H> archivos completados de <H>{formatNumber(total_files)}</H> procesados.
      </span>
    )
  }

  if (completion_rate >= 30) {
    return (
      <span>
        <H color="#64748b">{areaName}</H> procesó <H color={COLORS.area}>{formatNumber(total_files)} archivo{s}</H> con <H color="#F59E0B">{completion_rate}%</H> de finalización. <H color="#10B981">{formatNumber(completed)}</H> de <H>{formatNumber(total_files)}</H> completados, con <H color="#8B5CF6">{formatDays(avg_time_days)}</H> de tiempo promedio y <H color="#0EA5E9">{users.length}</H> empleado{users.length !== 1 ? 's' : ''} activo{users.length !== 1 ? 's' : ''}.
      </span>
    )
  }

  return (
    <span>
      <H color="#64748b">{areaName}</H> procesó <H color={COLORS.area}>{formatNumber(total_files)} archivo{s}</H> durante <H>{periodLabel}</H> con <H color="#EF4444">{completion_rate}%</H> de finalización. <StatusDot color="#EF4444" /><H color="#DC2626">El rendimiento es bajo y requiere atención.</H> {bottlenecks.length > 0 ? <><H color="#D97706">Existen {bottlenecks.length} alerta{bottlenecks.length !== 1 ? 's' : ''}</H> operativa{bottlenecks.length !== 1 ? 's' : ''} que requieren seguimiento.</> : 'No hay alertas activas.'}
    </span>
  )
}

function LoadingState() {
  return (
    <div className="kpi-seller-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="kpi-spinner" />
          <p style={{ color: '#4A5E80', fontSize: 14, fontWeight: 500, marginTop: 12 }}>Cargando datos de producción...</p>
        </div>
      </div>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="kpi-seller-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div className="kpi-card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 16px', borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icons.AlertCircle style={{ color: '#EF4444' }} />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#991B1B', marginBottom: 8 }}>Error al cargar datos</h3>
          <p style={{ fontSize: 13, color: '#8899B5', marginBottom: 20 }}>{message}</p>
        </div>
      </div>
    </div>
  )
}

function ChartControls({ chartPeriod, chartCustom, chartDateFrom, chartDateTo, setChartPeriod, setChartCustom, setChartDateFrom, setChartDateTo }) {
  return (
    <>
      <div className="kpi-pipeline-view-toggle">
        {CHART_PERIODS.map(p => (
          <button key={p.key} className={`kpi-pipeline-view-btn ${chartPeriod === p.key && !chartCustom ? 'active' : ''}`} onClick={() => { setChartPeriod(p.key); setChartCustom(false) }}>{p.label}</button>
        ))}
        <button className={`kpi-pipeline-view-btn ${chartCustom ? 'active' : ''}`} onClick={() => setChartCustom(!chartCustom)}>Personalizar</button>
      </div>
      {chartCustom && (
        <div className="kpi-filter-row" style={{ marginTop: 8, marginBottom: 8 }}>
          <label><span>Desde</span><input type="date" value={chartDateFrom} onChange={e => setChartDateFrom(e.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={chartDateTo} onChange={e => setChartDateTo(e.target.value)} /></label>
        </div>
      )}
    </>
  )
}

function GlobalView({ getDateBounds, onAreaClick }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      setError(null)
      const bounds = getDateBounds()
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'production_overview', ...bounds, ...getCompareBounds(bounds) })
        if (cancelled) return
        if (res.response.ok) setData(res.result)
        else {
          setData(null)
          setError(res.result?.error || 'Error al cargar datos de produccion.')
        }
      } catch (err) {
        if (!cancelled) {
          setData(null)
          setError(err?.message || 'Error de conexion al cargar produccion.')
        }
      }
      if (!cancelled) setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [getDateBounds])

  const chartBounds = useMemo(() => getChartBounds(chartPeriod, chartCustom, chartDateFrom, chartDateTo), [chartPeriod, chartCustom, chartDateFrom, chartDateTo])
  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) return `${new Date(chartDateFrom).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })} - ${new Date(chartDateTo).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })}`
    return { '7d': 'Ultimos 7 dias', '1m': 'Ultimo mes', '3m': 'Ultimos 3 meses', '6m': 'Ultimos 6 meses' }[chartPeriod] || ''
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])
  const chartGranularity = useMemo(() => {
    const diff = (new Date(chartBounds.date_to) - new Date(chartBounds.date_from)) / 86400000
    if (diff <= 31) return 'daily'
    if (diff <= 120) return 'weekly'
    return 'monthly'
  }, [chartBounds])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return <ErrorState message="No hay datos de produccion disponibles." />

  const { areas = [], trend = [], total_files = 0, total_completed = 0, comparison } = data
  const trendDates = [...new Set(trend.map(t => t.date))].sort()
  const formatXAxis = (date) => {
    const d = new Date(date + 'T12:00:00')
    if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
    if (chartGranularity === 'weekly') return `${d.getDate()} ${d.toLocaleDateString('es-DO', { month: 'short' })}`
    return d.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' })
  }

  return (
    <>
      <div className="kpi-leader-grid" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[
          { label: 'Archivos Totales', value: formatNumber(total_files), color: '#0EA5E9', icon: Icons.Package, subtitle: 'Entradas a produccion' },
          { label: 'En Produccion', value: formatNumber(areas.reduce((s, a) => s + (a.in_production || 0), 0)), color: '#F97316', icon: Icons.Clipboard, subtitle: 'Carga operativa' },
          { label: 'Completados', value: formatNumber(total_completed), color: '#10B981', icon: Icons.CheckCircle, subtitle: 'Archivos finalizados' },
          { label: 'Tasa Promedio', value: `${areas.length > 0 ? (areas.reduce((s, a) => s + (a.completion_rate || 0), 0) / areas.length).toFixed(1) : 0}%`, color: '#8B5CF6', icon: Icons.TrendUp, subtitle: 'Promedio por area' },
        ].map((card, i) => {
          const Icon = card.icon
          return (
            <div key={i} className="kpi-leader-card">
              <div className="kpi-leader-header">
                <div className="kpi-leader-icon" style={{ background: `${card.color}15`, color: card.color }}><Icon size={16} /></div>
                <div className="kpi-leader-category">{card.label}</div>
              </div>
              <div className="kpi-leader-value" style={{ color: card.color }}>{card.value}</div>
              <div className="kpi-seller-list-sub" style={{ marginTop: 8 }}>{card.subtitle}</div>
            </div>
          )
        })}
      </div>

      <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Evolucion de Produccion</h3>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{chartPeriodLabel}</div>
          </div>
          <ChartControls chartPeriod={chartPeriod} chartCustom={chartCustom} chartDateFrom={chartDateFrom} chartDateTo={chartDateTo} setChartPeriod={setChartPeriod} setChartCustom={setChartCustom} setChartDateFrom={setChartDateFrom} setChartDateTo={setChartDateTo} />
        </div>
        {trendDates.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendDates.map(date => {
              const row = { date }
              const dayData = trend.find(t => t.date === date) || {}
              areas.forEach(a => { row[a.label] = dayData[a.code] || 0 })
              return row
            })}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <Tooltip />
              {areas.map((area, i) => (
                <Line key={area.code} type="monotone" dataKey={area.label} stroke={AREA_COLORS[area.code] || LINE_COLORS[i]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="kpi-empty-state" style={{ height: 260 }}><div className="kpi-empty-title">Sin datos de tendencia</div></div>
        )}
      </div>

      <div className="kpi-seller-section-title">Análisis por Áreas</div>
      <div style={{ display: 'grid', gridTemplateColumns: areas.length > 0 && areas.length <= 3 ? `repeat(${areas.length}, minmax(0, 1fr))` : 'repeat(3, minmax(0, 1fr))', gap: 16, marginBottom: 24 }}>
        {areas.map(area => {
          const AreaIcon = AREA_ICONS[area.code] || Icons.Package
          const color = AREA_COLORS[area.code] || '#64748b'
          return (
            <button key={area.code} className="kpi-leader-card" onClick={() => onAreaClick(area.code)} style={{ textAlign: 'left', borderColor: `${color}30`, '--leader-color': color }}>
              <div className="kpi-leader-header">
                <div className="kpi-leader-icon" style={{ background: `${color}18`, color }}><AreaIcon size={16} /></div>
                <div className="kpi-leader-category">{area.active_employees} empleado{area.active_employees !== 1 ? 's' : ''}</div>
              </div>
              <div className="kpi-leader-name">{area.label}</div>
              <div className="kpi-leader-value" style={{ color }}>{formatNumber(area.total_files)}</div>
              <div className="kpi-leader-delta positive">{area.completion_rate}% completado</div>
              <div className="kpi-seller-list-sub" style={{ marginTop: 10 }}>
                {area.in_production || 0} produccion - {area.in_termination || 0} terminacion - {area.reversions || 0} reversiones
              </div>
            </button>
          )
        })}
      </div>

      {comparison && (() => {
        const items = [
          { label: 'Archivos', change: comparison.total_files?.change_pct, inverse: false },
          { label: 'Completados', change: comparison.completed?.change_pct, inverse: false },
        ]
        const improved = items.filter(i => { const n = Number(i.change) || 0; return i.inverse ? n < 0 : n > 0 }).length
        const worsened = items.filter(i => { const n = Number(i.change) || 0; return i.inverse ? n > 0 : n < 0 }).length
        const summaryIcon = improved > worsened ? '#10B981' : improved < worsened ? '#EF4444' : '#94A3B8'
        const summaryText = improved === items.length ? 'Mejoró en todas las métricas.' : worsened === items.length ? 'Empeoró en todas las métricas.' : improved > worsened ? `Mejoró en ${improved} de ${items.length} métricas.` : improved < worsened ? `Empeoró en ${worsened} de ${items.length} métricas.` : 'Sin cambios significativos.'
        return (
          <>
            <div className="kpi-seller-section-title">Comparación con Período Anterior</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              {improved > worsened ? <Icons.TrendUp size={14} style={{ color: summaryIcon }} /> : improved < worsened ? <Icons.Refresh size={14} style={{ color: summaryIcon }} /> : <Icons.Clock size={14} style={{ color: summaryIcon }} />}
              {summaryText}
            </div>
            <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
              {comparison.total_files && <ComparisonCard label="Archivos" value={comparison.total_files.curr} prev={comparison.total_files.prev} change={comparison.total_files.change_pct} />}
              {comparison.completed && <ComparisonCard label="Completados" value={comparison.completed.curr} prev={comparison.completed.prev} change={comparison.completed.change_pct} />}
            </div>
          </>
        )
      })()}
    </>
  )
}

function ComparisonCard({ label, value, prev, change, inverse = false }) {
  const num = Number(change) || 0
  const isPositive = inverse ? num < 0 : num > 0
  const isNegative = inverse ? num > 0 : num < 0
  const borderColor = isPositive ? '#10B981' : isNegative ? '#EF4444' : '#94A3B8'
  const arrow = num > 0 ? '↑' : num < 0 ? '↓' : '→'
  return (
    <div className="kpi-seller-comparison-card" style={{ borderLeft: `3px solid ${borderColor}`, textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="kpi-seller-comparison-label" style={{ margin: 0 }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: borderColor, display: 'flex', alignItems: 'center', gap: 3 }}>
          {arrow} {isPositive ? '+' : ''}{num.toFixed(1)}%
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="kpi-seller-comparison-value">{value}</span>
        <span style={{ fontSize: 13, color: '#94A3B8' }}>→</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#94A3B8' }}>{prev}</span>
      </div>
    </div>
  )
}

function AreaDetailHeader({ areaName, periodLabel, AreaIcon, onBack }) {
  const scrollToSection = (event, targetId) => {
    event.preventDefault()
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <header className="kpi-area-premium-header">
      <div className="kpi-area-premium-topbar">
        <div className="kpi-area-premium-breadcrumb">
          <span>KPI</span>
          <Icons.ChevronRight size={13} />
          <span>Produccion</span>
          <Icons.ChevronRight size={13} />
          <strong>{areaName}</strong>
        </div>

        <div className="kpi-area-premium-actions">
          <button type="button" className="kpi-area-premium-back" onClick={onBack}>
            <Icons.ChevronLeft size={15} />
            Volver al panel
          </button>
          <span className="kpi-area-premium-period">
            <Icons.Calendar size={14} />
            {periodLabel}
          </span>
          <button type="button" className="kpi-area-premium-primary" onClick={() => document.getElementById('area-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <Icons.Orders size={14} />
            Ver ordenes
          </button>
        </div>
      </div>

      <div className="kpi-area-premium-title-row">
        <div className="kpi-area-premium-title">
          <div className="kpi-area-premium-icon"><AreaIcon size={24} /></div>
          <div>
            <h2>{areaName}</h2>
            <p>Centro de inteligencia del area</p>
          </div>
        </div>
      </div>

      <nav className="kpi-area-premium-nav" aria-label="Navegacion de inteligencia del area">
        <a href="#area-summary" onClick={(event) => scrollToSection(event, 'area-summary')}>Resumen</a>
        <a href="#area-flow" onClick={(event) => scrollToSection(event, 'area-flow')}>Flujo</a>
        <a href="#area-orders" onClick={(event) => scrollToSection(event, 'area-orders')}>Ordenes</a>
        <a href="#area-alerts" onClick={(event) => scrollToSection(event, 'area-alerts')}>Alertas</a>
      </nav>
    </header>
  )
}

function AreaExecutivePanel({ areaName, total_files, total_orders, completed, completion_rate, avg_time_days, users, bottlenecks, periodLabel, activeLoad, slaCompliance }) {
  const summary = generateSummary({ area: areaName, total_files, total_orders, completed, completion_rate, avg_time_days, users, bottlenecks, periodLabel })
  const pressureTone = bottlenecks.length > 0 ? 'warning' : activeLoad > 0 ? 'stable' : 'neutral'
  const slaTone = slaCompliance >= 80 ? 'stable' : slaCompliance > 0 ? 'warning' : 'neutral'

  return (
    <section id="area-summary" className="kpi-area-executive-card">
      <div className="kpi-area-executive-main">
        <div className="kpi-area-executive-mark">
          <Icons.TrendUp size={18} strokeWidth={2.5} />
        </div>
        <div>
          <span className="kpi-area-eyebrow">Diagnostico ejecutivo</span>
          <h3>{bottlenecks.length > 0 ? 'Atencion operativa requerida.' : 'Operacion bajo control.'}</h3>
          <p>{summary}</p>
        </div>
      </div>
      <div className="kpi-area-health-grid">
        <AreaHealthChip label="Carga" value={`${formatNumber(activeLoad)} activas`} tone={pressureTone} icon={Icons.Package} />
        <AreaHealthChip label="SLA" value={`${slaCompliance || 0}% cumplimiento`} tone={slaTone} icon={Icons.Clock} />
        <AreaHealthChip label="Alertas" value={`${formatNumber(bottlenecks.length)} cuellos`} tone={bottlenecks.length > 0 ? 'warning' : 'stable'} icon={bottlenecks.length > 0 ? Icons.AlertCircle : Icons.CheckCircle} />
      </div>
    </section>
  )
}

function AreaHealthChip({ label, value, tone, icon: Icon }) {
  return (
    <div className={`kpi-area-health-chip ${tone}`}>
      <div className="kpi-area-health-icon"><Icon size={16} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function AreaKpiRail({ metrics }) {
  return (
    <div className="kpi-area-kpi-rail">
      {metrics.map(item => {
        const Icon = item.icon
        return (
          <article key={item.label} className="kpi-area-kpi-card" style={{ '--metric-color': item.color }}>
            <div className="kpi-area-kpi-top">
              <span>{item.label}</span>
              <Icon size={15} />
            </div>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        )
      })}
    </div>
  )
}

function AreaFlowCard({ chartDates, areaTrend, formatXAxis, chartControls }) {
  return (
    <section id="area-flow" className="kpi-area-surface kpi-area-flow-card">
      <AreaSectionHeader title="Flujo del area" subtitle="Completados, en proceso y terminacion" />
      <div className="kpi-area-chart-toolbar">
        <ChartControls {...chartControls} />
      </div>
      {chartDates.length > 0 ? (
        <div className="kpi-area-chart-frame">
          <ResponsiveContainer width="100%" height={294}>
            <AreaChart data={chartDates.map(date => {
              const item = areaTrend.find(t => t.date === date) || {}
              return { date, Completados: item.completed || 0, Produccion: item.in_production || 0, Terminacion: item.in_termination || 0 }
            })}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
              <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip />
              <Area type="monotone" dataKey="Completados" stroke="#10B981" fill="#10B981" fillOpacity={0.15} strokeWidth={2} />
              <Area type="monotone" dataKey="Produccion" stroke="#F97316" fill="#F97316" fillOpacity={0.12} strokeWidth={2} />
              <Area type="monotone" dataKey="Terminacion" stroke="#0EA5E9" fill="#0EA5E9" fillOpacity={0.12} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <AreaEmptyState title="Sin tendencia para este periodo" />
      )}
    </section>
  )
}

function AreaPipelineCard({ pieData, total_orders }) {
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0)
  const dominant = pieData.length > 0 ? pieData.reduce((max, item) => item.value > max.value ? item : max, pieData[0]) : null
  const dominantPct = dominant && pieTotal > 0 ? ((dominant.value / pieTotal) * 100).toFixed(0) : 0

  return (
    <section className="kpi-area-surface kpi-area-pipeline-card">
      <AreaSectionHeader title="Pipeline del area" subtitle={`${formatNumber(total_orders)} ordenes en el periodo`} />
      <div className="kpi-area-pipeline-layout">
        <div className="kpi-area-donut-frame">
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} stroke="#fff" strokeWidth={2} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="kpi-area-donut-center">
                <strong>{dominantPct}%</strong>
                <span>{dominant?.name}</span>
              </div>
            </>
          ) : (
            <AreaEmptyState title="Sin estados registrados" />
          )}
        </div>
        <div className="kpi-area-pipeline-list">
          {pieData.map(item => {
            const pct = pieTotal > 0 ? ((item.value / pieTotal) * 100).toFixed(0) : 0
            return (
              <div key={item.name} className="kpi-area-pipeline-row">
                <i style={{ background: item.color }} />
                <span>{item.name}</span>
                <strong>{formatNumber(item.value)}</strong>
                <em style={{ color: item.color }}>{pct}%</em>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function AreaAnalysisCards({ priorityBreakdown, agingBuckets, operationalInsights, maxAging }) {
  const priorityTotal = priorityBreakdown.total || (priorityBreakdown.normal || 0) + (priorityBreakdown.urgent_911 || 0)
  const priorityRows = [
    { label: 'Normal', value: priorityBreakdown.normal || 0, color: '#06B6D4' },
    { label: '911', value: priorityBreakdown.urgent_911 || 0, color: '#EF4444' },
  ]

  return (
    <section id="area-alerts" className="kpi-area-analysis-grid">
      <article className="kpi-area-surface kpi-area-mini-card">
        <AreaSectionHeader title="Prioridad" subtitle="Carga normal vs urgente" />
        <div className="kpi-area-bar-list">
          {priorityRows.map(row => {
            const pct = priorityTotal > 0 ? (row.value / priorityTotal) * 100 : 0
            return <AreaMetricBar key={row.label} label={row.label} value={row.value} pct={pct} color={row.color} />
          })}
        </div>
      </article>

      <article className="kpi-area-surface kpi-area-mini-card">
        <AreaSectionHeader title="Antiguedad" subtitle="Ordenes activas por edad" />
        <div className="kpi-area-bar-list">
          {agingBuckets.length > 0 ? agingBuckets.map(bucket => (
            <AreaMetricBar key={bucket.key} label={bucket.label} value={bucket.count || 0} pct={((bucket.count || 0) / maxAging) * 100} color="#091127" />
          )) : <AreaEmptyState title="Sin carga activa" compact />}
        </div>
      </article>

      <article className="kpi-area-surface kpi-area-mini-card">
        <AreaSectionHeader title="Insights operativos" subtitle="Senales accionables del periodo" />
        <div className="kpi-area-insight-list premium">
          {operationalInsights.length > 0 ? operationalInsights.map((insight, idx) => (
            <div key={`${insight.title}-${idx}`} className={`kpi-area-insight-item premium ${insight.tone || 'stable'}`}>
              <Icons.AlertCircle size={14} />
              <div>
                <strong>{insight.title}</strong>
                <span>{insight.detail}</span>
              </div>
              <Icons.ChevronRight size={13} />
            </div>
          )) : (
            <div className="kpi-area-insight-item premium stable">
              <Icons.CheckCircle size={14} />
              <div>
                <strong>Operacion estable</strong>
                <span>No hay senales criticas para esta area en el periodo.</span>
              </div>
            </div>
          )}
        </div>
      </article>
    </section>
  )
}

function AreaMetricBar({ label, value, pct, color }) {
  return (
    <div className="kpi-area-metric-bar">
      <span>{label}</span>
      <div><i style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color }} /></div>
      <strong>{formatNumber(value)}</strong>
      <em style={{ color }}>{Math.round(pct)}%</em>
    </div>
  )
}

function AreaOrdersCard({ orderRows, onSelectOrder }) {
  return (
    <section id="area-orders" className="kpi-area-surface kpi-area-orders-card premium">
      <AreaSectionHeader title="Ordenes activas" subtitle="Inspeccion rapida sin salir del KPI" aside={formatNumber(orderRows.length)} />
      {orderRows.length > 0 ? (
        <div className="kpi-area-orders-table" role="table" aria-label="Ordenes activas del area">
          <div className="kpi-area-orders-head" role="row">
            <span>Orden</span>
            <span>Cliente</span>
            <span>Prioridad</span>
            <span>Etapa</span>
            <span>Dias</span>
          </div>
          {orderRows.slice(0, 10).map(order => (
            <button key={`${order.production_file_id || order.id}`} type="button" className="kpi-area-order-row premium" onClick={() => onSelectOrder(order)}>
              <span className="kpi-production-order-code">#{getShortOrderId(order.id)}</span>
              <span className="kpi-area-order-client">{order.client_name || 'Sin cliente'}</span>
              <span className={order.order_type === 'orden 911' ? 'kpi-production-risk-pill danger' : 'kpi-production-risk-pill'}>
                {order.order_type === 'orden 911' ? '911' : 'Normal'}
              </span>
              <span className="kpi-production-stage-pill">{getStageLabel(order.production_file_status)}</span>
              <span className="kpi-production-days-pill">{formatDays(order.production_stage_days || 0)}</span>
            </button>
          ))}
        </div>
      ) : (
        <AreaEmptyState title="Sin ordenes para inspeccionar" />
      )}
    </section>
  )
}

function AreaCapacityCard({ loadDistribution, total_files, totalEmployees }) {
  return (
    <section className="kpi-area-surface kpi-area-capacity-card premium">
      <AreaSectionHeader title="Capacidad asignada" subtitle="Carga operativa, no ranking de desempeno" aside={formatNumber(totalEmployees)} />
      {loadDistribution.length > 0 ? (
        <div className="kpi-area-capacity-list premium">
          {loadDistribution.slice(0, 8).map(user => {
            const assigned = user.assigned_count || user.current_load || 0
            const pct = total_files > 0 ? (assigned / total_files) * 100 : 0
            return (
              <div key={user.id || user.name} className="kpi-area-capacity-row premium">
                <div>
                  <strong>{user.name || 'Sin asignar'}</strong>
                  <span>{formatNumber(user.current_load || 0)} activos / {formatNumber(assigned)} asignados</span>
                </div>
                <div className="kpi-area-capacity-track"><i style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                <span>{formatNumber(pct, { decimals: 1 })}%</span>
              </div>
            )
          })}
        </div>
      ) : (
        <AreaEmptyState title="Sin capacidad asignada" />
      )}
    </section>
  )
}

function AreaAlertsPanel({ bottlenecks }) {
  if (bottlenecks.length === 0) return null
  return (
    <section className="kpi-area-surface kpi-area-alert-panel">
      <AreaSectionHeader title="Alertas operativas" subtitle="Ordenes con mas de 3 dias sin avanzar" />
      <div className="kpi-area-alert-list">
        {bottlenecks.slice(0, 6).map(item => (
          <div key={item.file_id} className={item.days_in_stage > 7 ? 'danger' : 'warning'}>
            <Icons.AlertCircle size={14} />
            <span>Orden #{getShortOrderId(item.order_id)} detenida por {item.days_in_stage} dias</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function AreaStatusTimingCard({ statusTimeBreakdown }) {
  if (statusTimeBreakdown.length === 0) return null
  return (
    <section className="kpi-area-surface kpi-area-timing-card">
      <AreaSectionHeader title="Tiempo promedio por estado" subtitle="Duracion media en cada fase del proceso" />
      <div className="kpi-area-timing-grid">
        {statusTimeBreakdown.map((item, idx) => (
          <div key={idx} className="kpi-area-timing-item" style={{ '--metric-color': item.color }}>
            <strong>{item.avg_days}d</strong>
            <span>{item.name}</span>
            <small>{formatNumber(item.count)} archivos</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function AreaComparisonSection({ comparison }) {
  if (!comparison) return null
  const items = [
    { label: 'Archivos', change: comparison.total_files?.change_pct },
    { label: 'Completados', change: comparison.completed?.change_pct },
    { label: 'Tiempo Prom.', change: comparison.avg_time_days?.change_pct, inverse: true },
    { label: 'Reversiones', change: comparison.reversions?.change_pct, inverse: true },
  ]
  const improved = items.filter(i => { const n = Number(i.change) || 0; return i.inverse ? n < 0 : n > 0 }).length
  const worsened = items.filter(i => { const n = Number(i.change) || 0; return i.inverse ? n > 0 : n < 0 }).length
  const summaryText = improved === items.length ? 'Mejoro en todas las metricas.' : worsened === items.length ? 'Empeoro en todas las metricas.' : improved > worsened ? `Mejoro en ${improved} de ${items.length} metricas.` : improved < worsened ? `Empeoro en ${worsened} de ${items.length} metricas.` : 'Sin cambios significativos.'

  return (
    <section className="kpi-area-comparison-section">
      <AreaSectionHeader title="Comparacion con periodo anterior" subtitle={summaryText} />
      <div className="kpi-seller-comparison-grid">
        {comparison.total_files && <ComparisonCard label="Archivos" value={comparison.total_files.curr} prev={comparison.total_files.prev} change={comparison.total_files.change_pct} />}
        {comparison.completed && <ComparisonCard label="Completados" value={comparison.completed.curr} prev={comparison.completed.prev} change={comparison.completed.change_pct} />}
        {comparison.avg_time_days && <ComparisonCard label="Tiempo Prom." value={formatDays(comparison.avg_time_days.curr)} prev={formatDays(comparison.avg_time_days.prev)} change={comparison.avg_time_days.change_pct} inverse />}
        {comparison.reversions && <ComparisonCard label="Reversiones" value={comparison.reversions.curr} prev={comparison.reversions.prev} change={comparison.reversions.change_pct} inverse />}
      </div>
    </section>
  )
}

function AreaSectionHeader({ title, subtitle, aside }) {
  return (
    <div className="kpi-area-section-head">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {aside !== undefined && <strong>{aside}</strong>}
    </div>
  )
}

function AreaEmptyState({ title, compact = false }) {
  return (
    <div className={`kpi-area-empty ${compact ? 'compact' : ''}`}>
      <Icons.CheckCircle size={18} />
      <span>{title}</span>
    </div>
  )
}

export function ProductionAreaDetailView({ areaCode, onBack, period, customDateFrom, customDateTo }) {
  const [data, setData] = useState(null)
  const [trendData, setTrendData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')

  const periodBounds = useMemo(() => getDateBoundsForPeriod(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'production_area_detail', area_code: areaCode, ...periodBounds, ...getCompareBounds(periodBounds) })
        if (res.response.ok && !cancelled) setData(res.result)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [areaCode, periodBounds])

  const chartBounds = useMemo(() => getChartBounds(chartPeriod, chartCustom, chartDateFrom, chartDateTo), [chartPeriod, chartCustom, chartDateFrom, chartDateTo])
  const chartGranularity = useMemo(() => {
    const diff = (new Date(chartBounds.date_to) - new Date(chartBounds.date_from)) / 86400000
    if (diff <= 31) return 'daily'
    if (diff <= 120) return 'weekly'
    return 'monthly'
  }, [chartBounds])

  useEffect(() => {
    let cancelled = false
    async function fetchTrend() {
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'production_daily_trend', area_code: areaCode, ...chartBounds })
        if (res.response.ok && !cancelled) setTrendData(res.result)
      } catch { /* ignore */ }
    }
    fetchTrend()
    return () => { cancelled = true }
  }, [areaCode, chartBounds])

  if (loading) return <LoadingState />
  if (!data) return <ErrorState message="No hay datos para esta area." />

  const {
    area,
    total_files = 0,
    total_orders = 0,
    completed = 0,
    pending = 0,
    in_production = 0,
    in_termination = 0,
    completion_rate = 0,
    avg_time_days = 0,
    users = [],
    bottlenecks = [],
    comparison,
    trend = [],
    status_breakdown: statusBreakdown,
    status_time_breakdown: statusTimeBreakdown = [],
    efficiency_metrics: efficiencyMetrics = {},
    load_distribution: loadDistribution = [],
    orders = [],
    priority_breakdown: priorityBreakdown = { normal: 0, urgent_911: 0, total: 0, urgent_pct: 0 },
    aging_buckets: agingBuckets = [],
    sla_metrics: slaMetrics = {},
    operational_insights: operationalInsights = [],
    total_employees: totalEmployees = 0,
  } = data
  const color = AREA_COLORS[areaCode] || '#0EA5E9'
  const AreaIcon = AREA_ICONS[areaCode] || Icons.Package
  const areaName = getAreaDisplayName(areaCode, area?.label)
  const periodLabel = getPeriodLabel(period, customDateFrom, customDateTo)
  const areaTrend = trendData?.trend || trend
  const chartDates = [...new Set(areaTrend.map(t => t.date))].sort()
  const formatXAxis = (date) => {
    const d = new Date(date + 'T12:00:00')
    if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
    if (chartGranularity === 'weekly') return `${d.getDate()} ${d.toLocaleDateString('es-DO', { month: 'short' })}`
    return d.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' })
  }
  const pieData = (statusBreakdown || [
    { key: 'pending', value: pending },
    { key: 'in_production', value: in_production },
    { key: 'in_termination', value: in_termination },
    { key: 'completed', value: completed },
  ]).map(item => ({
    name: item.name || STATUS_LABELS[item.key] || item.key,
    value: item.value || 0,
    color: item.color || STATUS_COLORS[item.key] || '#64748b',
  })).filter(item => item.value > 0)
  const activeLoad = pending + in_production + in_termination
  const orderRows = Array.isArray(orders) ? orders : []
  const maxAging = Math.max(...agingBuckets.map(bucket => bucket.count || 0), 1)
  const slaCompliance = efficiencyMetrics.sla_compliance || 0
  const kpiMetrics = [
    { label: 'Carga activa', value: formatNumber(activeLoad), detail: 'Pendiente, produccion y terminacion', color: '#0EA5E9', icon: Icons.Package },
    { label: 'Completadas', value: formatNumber(completed), detail: 'Salida efectiva del area', color: '#10B981', icon: Icons.CheckCircle },
    { label: 'Retrasadas', value: formatNumber(slaMetrics.delayed_count ?? bottlenecks.length), detail: 'Mas de 3 dias sin avanzar', color: '#EF4444', icon: Icons.AlertCircle },
    { label: 'SLA', value: `${slaCompliance}%`, detail: 'Cumplimiento operativo', color: slaCompliance >= 80 ? '#10B981' : '#F59E0B', icon: Icons.Clock },
    { label: '911', value: `${priorityBreakdown.urgent_pct || 0}%`, detail: `${formatNumber(priorityBreakdown.urgent_911 || 0)} urgentes`, color: '#EF4444', icon: Icons.Bell },
  ]
  const chartControls = { chartPeriod, chartCustom, chartDateFrom, chartDateTo, setChartPeriod, setChartCustom, setChartDateFrom, setChartDateTo }

  return (
    <div className="kpi-seller-page kpi-production-area-detail premium" style={{ '--area-color': color }}>
      <AreaDetailHeader areaName={areaName} periodLabel={periodLabel} AreaIcon={AreaIcon} onBack={onBack} />

      <main className="kpi-area-premium-body">
        <div className="kpi-area-top-grid">
          <AreaExecutivePanel
            areaName={areaName}
            total_files={total_files}
            total_orders={total_orders}
            completed={completed}
            completion_rate={completion_rate}
            avg_time_days={avg_time_days}
            users={users}
            bottlenecks={bottlenecks}
            periodLabel={periodLabel}
            activeLoad={activeLoad}
            slaCompliance={slaCompliance}
          />
          <AreaKpiRail metrics={kpiMetrics} />
        </div>

        <div className="kpi-area-flow-grid">
          <AreaFlowCard chartDates={chartDates} areaTrend={areaTrend} formatXAxis={formatXAxis} chartControls={chartControls} />
          <AreaPipelineCard pieData={pieData} total_orders={total_orders} />
        </div>

        <AreaAnalysisCards priorityBreakdown={priorityBreakdown} agingBuckets={agingBuckets} operationalInsights={operationalInsights} maxAging={maxAging} />
        <AreaAlertsPanel bottlenecks={bottlenecks} />

        <div className="kpi-area-data-grid">
          <AreaOrdersCard orderRows={orderRows} onSelectOrder={setSelectedOrder} />
          <AreaCapacityCard loadDistribution={loadDistribution} total_files={total_files} totalEmployees={totalEmployees} />

          {false && (
            <>
          <div className="kpi-card kpi-area-legacy-hidden" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div className="kpi-seller-section-title" style={{ marginBottom: 0 }}>Estado Operativo</div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '4px 10px', borderRadius: 6 }}>{formatNumber(total_orders)} órdenes</span>
            </div>
            <div style={{ height: 230, position: 'relative', marginBottom: 20 }}>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} stroke="#fff" strokeWidth={2} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="kpi-empty-state"><div className="kpi-empty-title">Sin datos</div></div>}
              {pieData.length > 0 && (() => {
                const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0)
                const dominant = pieData.reduce((max, item) => item.value > max.value ? item : max, pieData[0])
                const dominantPct = pieTotal > 0 ? ((dominant.value / pieTotal) * 100).toFixed(0) : 0
                return (
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 32, fontWeight: 800, color: '#091127', lineHeight: 1 }}>{dominantPct}%</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: dominant.color, marginTop: 4, letterSpacing: '0.02em' }}>{dominant.name}</div>
                  </div>
                )
              })()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pieData.map((item, idx) => {
                const pieTotal = pieData.reduce((sum, s) => sum + s.value, 0)
                const pct = pieTotal > 0 ? ((item.value / pieTotal) * 100).toFixed(0) : 0
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e8edf8' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#334155', flex: 1 }}>{item.name}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#091127', minWidth: 20, textAlign: 'right' }}>{formatNumber(item.value)}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: item.color, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div id="area-orders-legacy" className="kpi-card kpi-area-orders-card kpi-area-legacy-hidden">
            <div className="kpi-area-card-head">
              <div>
                <div className="kpi-seller-section-title" style={{ marginBottom: 4 }}>Ordenes activas del area</div>
                <span>Inspeccion rapida sin salir del KPI</span>
              </div>
              <strong>{formatNumber(orderRows.length)}</strong>
            </div>
            {orderRows.length > 0 ? (
              <div className="kpi-area-order-list">
                {orderRows.slice(0, 10).map(order => (
                  <button key={`${order.production_file_id || order.id}`} type="button" className="kpi-area-order-row" onClick={() => setSelectedOrder(order)}>
                    <span className="kpi-production-order-code">#{getShortOrderId(order.id)}</span>
                    <span className="kpi-area-order-client">{order.client_name || 'Sin cliente'}</span>
                    <span className={order.order_type === 'orden 911' ? 'kpi-production-risk-pill danger' : 'kpi-production-risk-pill'}>
                      {order.order_type === 'orden 911' ? '911' : 'Normal'}
                    </span>
                    <span className="kpi-production-stage-pill">{getStageLabel(order.production_file_status)}</span>
                    <span className="kpi-production-days-pill">{formatDays(order.production_stage_days || 0)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="kpi-empty-state"><div className="kpi-empty-title">Sin ordenes para inspeccionar</div></div>
            )}
          </div>

          <div className="kpi-card kpi-area-capacity-card kpi-area-legacy-hidden">
            <div className="kpi-area-card-head">
              <div>
                <div className="kpi-seller-section-title" style={{ marginBottom: 4 }}>Capacidad asignada</div>
                <span>Carga operativa por productor, no ranking de desempeno</span>
              </div>
              <strong>{formatNumber(totalEmployees)}</strong>
            </div>
            {loadDistribution.length > 0 ? (
              <div className="kpi-area-capacity-list">
                {loadDistribution.slice(0, 8).map(user => {
                  const pct = total_files > 0 ? ((user.assigned_count || user.current_load || 0) / total_files) * 100 : 0
                  return (
                    <div key={user.id || user.name} className="kpi-area-capacity-row">
                      <div>
                        <strong>{user.name || 'Sin asignar'}</strong>
                        <span>{formatNumber(user.current_load || 0)} activos / {formatNumber(user.assigned_count || 0)} asignados</span>
                      </div>
                      <div className="kpi-area-capacity-track"><i style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      <span>{formatNumber(pct, { decimals: 1 })}%</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="kpi-empty-state"><div className="kpi-empty-title">Sin capacidad asignada</div></div>
            )}
          </div>
            </>
          )}
        </div>

        {false && loadDistribution.length > 0 && (() => {
          const totalCompleted = loadDistribution.reduce((s, u) => s + (u.completed || 0), 0)
          const totalLoad = loadDistribution.reduce((s, u) => s + (u.current_load || 0), 0)
          const avgEfficiency = loadDistribution.length > 0 ? Math.round(loadDistribution.reduce((s, u) => s + (u.efficiency_score || 0), 0) / loadDistribution.length) : 0
          const maxCompleted = Math.max(...loadDistribution.map(u => u.completed || 0), 1)
          const maxLoad = Math.max(...loadDistribution.map(u => u.current_load || 0), 1)

          return (
            <div className="kpi-load-distribution-card">
              <div className="kpi-load-distribution-header">
                <span className="kpi-section-kicker" style={{ color: '#ffffff' }}>Panel de Carga</span>
                <h3 className="kpi-section-title">Distribucion de Carga por Empleado</h3>
                <p className="kpi-section-subtitle">Completados, carga actual y eficiencia por empleado</p>
              </div>

              <div className="kpi-load-distribution-legend">
                <div className="kpi-load-distribution-legend-item">
                  <span className="kpi-load-distribution-legend-dot" style={{ background: '#10B981' }} />
                  <span>Completados</span>
                </div>
                <div className="kpi-load-distribution-legend-item">
                  <span className="kpi-load-distribution-legend-dot" style={{ background: '#F97316' }} />
                  <span>Carga Actual</span>
                </div>
                <div className="kpi-load-distribution-legend-item">
                  <span className="kpi-load-distribution-legend-dot" style={{ background: '#8B5CF6' }} />
                  <span>Eficiencia (pts)</span>
                </div>
              </div>

              <div className="kpi-load-distribution-list">
                {loadDistribution.slice(0, 10).map((user, idx) => {
                  const completedWidth = maxCompleted > 0 ? (user.completed / maxCompleted) * 100 : 0
                  const loadWidth = maxLoad > 0 ? (user.current_load / maxLoad) * 100 : 0
                  const effColor = (user.efficiency_score || 0) >= 70 ? '#10B981' : (user.efficiency_score || 0) >= 40 ? '#F59E0B' : '#EF4444'

                  return (
                    <div key={user.id || idx} className="kpi-load-distribution-row">
                      <div className="kpi-load-distribution-row-left">
                        <span className="kpi-load-distribution-dot" style={{ background: effColor }} />
                        <span className="kpi-load-distribution-name">{user.name}</span>
                      </div>

                      <div className="kpi-load-distribution-row-center">
                        <div className="kpi-load-distribution-bars">
                          <div className="kpi-load-distribution-bar-row">
                            <span className="kpi-load-distribution-bar-label">Completados</span>
                            <div className="kpi-load-distribution-bar-bg">
                              <div
                                className="kpi-load-distribution-bar-fill"
                                style={{
                                  width: `${Math.max(completedWidth, user.completed > 0 ? 8 : 0)}%`,
                                  background: '#10B981',
                                }}
                              />
                            </div>
                          </div>
                          <div className="kpi-load-distribution-bar-row">
                            <span className="kpi-load-distribution-bar-label">Carga</span>
                            <div className="kpi-load-distribution-bar-bg">
                              <div
                                className="kpi-load-distribution-bar-fill"
                                style={{
                                  width: `${Math.max(loadWidth, user.current_load > 0 ? 8 : 0)}%`,
                                  background: '#F97316',
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="kpi-load-distribution-row-right">
                        <span className="kpi-load-distribution-count" style={{ color: '#10B981' }}>{user.completed || 0}</span>
                        <span className="kpi-load-distribution-separator">/</span>
                        <span className="kpi-load-distribution-count" style={{ color: '#F97316', fontSize: 14 }}>{user.current_load || 0}</span>
                        <span className="kpi-load-distribution-eff" style={{ background: `${effColor}18`, color: effColor }}>{user.efficiency_score || 0} pts</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="kpi-load-distribution-summary">
                <div className="kpi-load-distribution-summary-item">
                  <span className="kpi-load-distribution-summary-dot" style={{ background: '#10B981' }} />
                  <span>Completados: <strong>{totalCompleted}</strong></span>
                </div>
                <div className="kpi-load-distribution-summary-item">
                  <span className="kpi-load-distribution-summary-dot" style={{ background: '#F97316' }} />
                  <span>Carga Total: <strong>{totalLoad}</strong></span>
                </div>
                <div className="kpi-load-distribution-summary-item">
                  <span className="kpi-load-distribution-summary-dot" style={{ background: '#8B5CF6' }} />
                  <span>Eficiencia Promedio: <strong>{avgEfficiency} pts</strong></span>
                </div>
              </div>
            </div>
          )
        })()}

        <AreaStatusTimingCard statusTimeBreakdown={statusTimeBreakdown} />

        {false && statusTimeBreakdown.length > 0 && (
          <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
            <div className="kpi-seller-section-title" style={{ marginBottom: 4 }}>Tiempo Promedio por Estado</div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 16 }}>Dias promedio en cada fase del proceso</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(statusTimeBreakdown.length, 3)}, 1fr)`, gap: 16 }}>
              {statusTimeBreakdown.map((item, idx) => (
                <div key={idx} style={{ padding: '16px 18px', borderRadius: 12, background: `${item.color}08`, border: `1px solid ${item.color}25`, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#091127', lineHeight: 1 }}>{item.avg_days}d</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: item.color, marginTop: 6 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{formatNumber(item.count)} archivos</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <AreaComparisonSection comparison={comparison} />

        {false && comparison && (() => {
          const items = [
            { label: 'Archivos', change: comparison.total_files?.change_pct },
            { label: 'Completados', change: comparison.completed?.change_pct },
            { label: 'Tiempo Prom.', change: comparison.avg_time_days?.change_pct, inverse: true },
            { label: 'Reversiones', change: comparison.reversions?.change_pct, inverse: true },
          ]
          const improved = items.filter(i => { const n = Number(i.change) || 0; return i.inverse ? n < 0 : n > 0 }).length
          const worsened = items.filter(i => { const n = Number(i.change) || 0; return i.inverse ? n > 0 : n < 0 }).length
          const summaryIcon = improved > worsened ? '#10B981' : improved < worsened ? '#EF4444' : '#94A3B8'
          const summaryText = improved === items.length ? 'Mejoró en todas las métricas.' : worsened === items.length ? 'Empeoró en todas las métricas.' : improved > worsened ? `Mejoró en ${improved} de ${items.length} métricas.` : improved < worsened ? `Empeoró en ${worsened} de ${items.length} métricas.` : 'Sin cambios significativos.'
          return (
            <>
              <div className="kpi-seller-section-title">Comparación con Período Anterior</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                {improved > worsened ? <Icons.TrendUp size={14} style={{ color: summaryIcon }} /> : improved < worsened ? <Icons.Refresh size={14} style={{ color: summaryIcon }} /> : <Icons.Clock size={14} style={{ color: summaryIcon }} />}
                {summaryText}
              </div>
              <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
                {comparison.total_files && <ComparisonCard label="Archivos" value={comparison.total_files.curr} prev={comparison.total_files.prev} change={comparison.total_files.change_pct} />}
                {comparison.completed && <ComparisonCard label="Completados" value={comparison.completed.curr} prev={comparison.completed.prev} change={comparison.completed.change_pct} />}
                {comparison.avg_time_days && <ComparisonCard label="Tiempo Prom." value={formatDays(comparison.avg_time_days.curr)} prev={formatDays(comparison.avg_time_days.prev)} change={comparison.avg_time_days.change_pct} inverse />}
                {comparison.reversions && <ComparisonCard label="Reversiones" value={comparison.reversions.curr} prev={comparison.reversions.prev} change={comparison.reversions.change_pct} inverse />}
              </div>
            </>
          )
        })()}
        <OrderDetailModal
          open={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          order={selectedOrder}
          showPrimaryAction={false}
        />
      </main>
    </div>
  )
}

const PROFILE_ROLE_LABELS = { digital_producer: 'Producción Digital', dtf_producer: 'Producción DTF', ploteo_producer: 'Producción Ploteo' }

function formatEventDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function GaugeChart({ value, size = 120, label }) {
  const pct = Math.min(Math.max(value, -100), 100)
  const angle = (pct / 100) * 90
  const r = size / 2 - 10
  const cx = size / 2
  const cy = size / 2 + 5
  const color = pct >= 20 ? '#10B981' : pct >= 0 ? '#F59E0B' : '#EF4444'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#E8EDF8" strokeWidth={8} strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(-angle * Math.PI / 180)} ${cy - r * Math.sin(-angle * Math.PI / 180)}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="#091127" fontSize={18} fontWeight={800}>{pct >= 0 ? '+' : ''}{pct}%</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#64748b" fontSize={9} fontWeight={500}>{label}</text>
      </svg>
    </div>
  )
}

function RecommendationCard({ rec }) {
  const config = {
    attention: { bg: '#FFFBEB', border: '#FDE68A', icon: Icons.AlertCircle, color: '#F59E0B' },
    training: { bg: '#EFF6FF', border: '#BFDBFE', icon: Icons.Clipboard, color: '#3B82F6' },
    quality: { bg: '#FEF2F2', border: '#FECACA', icon: Icons.AlertCircle, color: '#EF4444' },
    availability: { bg: '#F5F3FF', border: '#DDD6FE', icon: Icons.Clock, color: '#8B5CF6' },
    recognition: { bg: '#ECFDF5', border: '#A7F3D0', icon: Icons.CheckCircle, color: '#10B981' },
    balance: { bg: '#FFF7ED', border: '#FED7AA', icon: Icons.Package, color: '#F97316' },
  }
  const c = config[rec.type] || config.attention
  const Icon = c.icon
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 8, background: c.bg, border: `1px solid ${c.border}` }}>
      <Icon size={14} style={{ color: c.color, flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{rec.text}</span>
    </div>
  )
}

export function ProductionEmployeeDetailView({ employeeId, areaCode, onBack, period, customDateFrom, customDateTo }) {
  const [data, setData] = useState(null)
  const [activity, setActivity] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activityFilter, setActivityFilter] = useState('all')
  const [activityLimit, setActivityLimit] = useState(10)
  const [trendPeriod, setTrendPeriod] = useState(period || '1m')
  const [trendCustom, setTrendCustom] = useState(false)
  const [trendDateFrom, setTrendDateFrom] = useState('')
  const [trendDateTo, setTrendDateTo] = useState('')
  const [trendData, setTrendData] = useState(null)

  const periodBounds = useMemo(() => getDateBoundsForPeriod(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo])

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [detailRes, activityRes] = await Promise.all([
          adminApiFetch('/api/kpi-data', { action: 'production_employee_detail', employee_id: employeeId, area_code: areaCode, ...periodBounds }),
          adminApiFetch('/api/kpi-data', { action: 'production_employee_activity', employee_id: employeeId, ...periodBounds }),
        ])
        if (detailRes.response.ok && !cancelled) setData(detailRes.result)
        else if (!cancelled) setError('Error al cargar datos del empleado.')
        if (activityRes.response.ok && !cancelled) setActivity(activityRes.result)
      } catch { if (!cancelled) setError('Error de conexion.') }
      if (!cancelled) setLoading(false)
    }
    fetchData()
    return () => { cancelled = true }
  }, [employeeId, areaCode, periodBounds])

  useEffect(() => {
    if (!trendPeriod && !trendCustom) return
    let cancelled = false
    async function fetchTrend() {
      const bounds = trendCustom
        ? { date_from: trendDateFrom || periodBounds?.date_from, date_to: trendDateTo || periodBounds?.date_to }
        : getDateBoundsForPeriod(trendPeriod, customDateFrom, customDateTo)
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'production_employee_detail', employee_id: employeeId, area_code: areaCode, ...bounds })
        if (res.response.ok && !cancelled) setTrendData(res.result?.trend || [])
      } catch { /* ignore */ }
    }
    fetchTrend()
    return () => { cancelled = true }
  }, [trendPeriod, trendCustom, trendDateFrom, trendDateTo, employeeId, areaCode, periodBounds, customDateFrom, customDateTo])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return <ErrorState message="No hay datos para este empleado." />

  const { profile, total_files = 0, completed = 0, in_production = 0, in_termination = 0, pending = 0, avg_time_days = 0, reversion_rate = 0, trend = [], activity_days = 0, period_days = 1, consistency = 0, efficiency_vs_area, days_since_last_activity, comparison, vs_department, alerts = [], insights = [], recommendations = [] } = data
  const initials = (profile?.name || 'E').split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase()
  const completionRate = total_files > 0 ? +((completed / total_files) * 100).toFixed(0) : 0
  const displayTrend = trendData || trend
  const pieTotalVal = pending + in_production + in_termination + completed
  const filteredEvents = activity?.events?.filter(e => activityFilter === 'all' || e.source === activityFilter) || []
  const showEvents = filteredEvents.slice(0, activityLimit)

  return (
    <div className="kpi-seller-page">
      <div className="kpi-seller-page-header" style={{ marginTop: 8, flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="kpi-seller-avatar" style={{ background: '#F97316' }}>{initials}</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0 }}>{profile?.name || 'Empleado'}</h2>
                {profile?.role && <span style={{ background: '#091127', color: '#fff', padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{PROFILE_ROLE_LABELS[profile.role] || profile.role.replace(/_/g, ' ')}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>{formatNumber(total_files)} archivos</span>
                <span style={{ fontSize: 12, color: '#F97316', fontWeight: 600 }}>{formatNumber(completed)} completados ({completionRate}%)</span>
                {vs_department && <span style={{ fontSize: 12, color: vs_department.total_files >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>vs area: {vs_department.total_files >= 0 ? '+' : ''}{vs_department.total_files}%</span>}
                <span style={{ fontSize: 11, color: '#94A3B8' }}>{days_since_last_activity !== null ? (days_since_last_activity === 0 ? 'Activo hoy' : days_since_last_activity === 1 ? 'Activo ayer' : `Ultima actividad: hace ${days_since_last_activity}d`) : 'Sin actividad'}</span>
              </div>
            </div>
          </div>
          <button className="kpi-seller-back-btn" onClick={onBack}><Icons.ChevronLeft size={15} /> Volver</button>
        </div>
      </div>

      <div className="kpi-seller-page-body">
        {alerts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {alerts.map((alert, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: alert.severity === 'critical' ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${alert.severity === 'critical' ? '#FECACA' : '#FDE68A'}` }}>
                <Icons.AlertCircle size={14} style={{ color: alert.severity === 'critical' ? '#EF4444' : '#F59E0B', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{alert.title}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>— {alert.message}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div className="kpi-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>Eficiencia vs Area</div>
            <GaugeChart value={efficiency_vs_area || 0} label={efficiency_vs_area !== null ? 'vs promedio' : 'Sin datos'} />
          </div>
          <div className="kpi-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, fontWeight: 600 }}>Metricas Clave</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Tiempo prom.', value: formatDays(avg_time_days), color: '#0EA5E9' },
                { label: 'Ritmo', value: `${(total_files / Math.max(period_days, 1)).toFixed(1)}/dia`, color: '#8B5CF6' },
                { label: 'Reversiones', value: `${reversion_rate}%`, color: reversion_rate > 15 ? '#EF4444' : '#94A3B8' },
                { label: 'Consistencia', value: `${consistency}%`, color: consistency >= 80 ? '#10B981' : consistency >= 50 ? '#F59E0B' : '#EF4444' },
                { label: 'Dias activos', value: `${activity_days}/${period_days}`, color: '#64748b' },
              ].map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{m.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>
          {comparison && (
            <div className="kpi-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, fontWeight: 600 }}>vs Periodo Anterior</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Completados', curr: comparison.completed.curr, pct: comparison.completed.change_pct, color: '#10B981' },
                  { label: 'Tiempo', curr: formatDays(comparison.avg_time_days.curr), pct: comparison.avg_time_days.change_pct, color: '#8B5CF6', invert: true },
                  { label: 'Reversiones', curr: comparison.reversions.curr, pct: comparison.reversions.change_pct, color: '#EF4444', invert: true },
                ].map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{m.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#091127' }}>{m.curr}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: m.pct >= 0 ? (m.invert ? '#EF4444' : '#10B981') : (m.invert ? '#10B981' : '#EF4444') }}>{m.pct >= 0 ? '+' : ''}{m.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {pieTotalVal > 0 && (
          <div className="kpi-card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>Distribucion de Trabajo</div>
            <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', background: '#E8EDF8' }}>
              {[
                { label: 'Pendiente', value: pending, color: '#F59E0B' },
                { label: 'Produccion', value: in_production, color: '#F97316' },
                { label: 'Terminacion', value: in_termination, color: '#0EA5E9' },
                { label: 'Completado', value: completed, color: '#10B981' },
              ].filter(s => s.value > 0).map((s, i) => (
                <div key={i} style={{ width: `${(s.value / pieTotalVal) * 100}%`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: s.value > 0 ? 20 : 0 }}>
                  {(s.value / pieTotalVal) > 0.1 && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{s.value}</span>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>
              {[
                { label: 'Pendiente', value: pending, color: '#F59E0B' },
                { label: 'Produccion', value: in_production, color: '#F97316' },
                { label: 'Terminacion', value: in_termination, color: '#0EA5E9' },
                { label: 'Completado', value: completed, color: '#10B981' },
              ].filter(s => s.value > 0).map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
                  <span style={{ color: '#64748b' }}>{s.label}</span>
                  <span style={{ fontWeight: 700, color: '#091127' }}>{s.value}</span>
                  <span style={{ color: '#94A3B8' }}>({pieTotalVal > 0 ? ((s.value / pieTotalVal) * 100).toFixed(0) : 0}%)</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {insights.length > 0 && (
          <div className="kpi-card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>Resumen</div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
              {insights.map((text, i) => <span key={i}>{text} </span>)}
            </div>
          </div>
        )}

        {displayTrend.length > 0 && (
          <div className="kpi-card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="kpi-seller-section-title" style={{ marginBottom: 0 }}>Tendencia de Productividad</div>
              <div className="kpi-pipeline-view-toggle">
                {CHART_PERIODS.map(p => (
                  <button key={p.key} className={`kpi-pipeline-view-btn ${trendPeriod === p.key && !trendCustom ? 'active' : ''}`} onClick={() => { setTrendPeriod(p.key); setTrendCustom(false) }}>{p.label}</button>
                ))}
                <button className={`kpi-pipeline-view-btn ${trendCustom ? 'active' : ''}`} onClick={() => setTrendCustom(!trendCustom)}>Custom</button>
              </div>
            </div>
            {trendCustom && (
              <div className="kpi-filter-row" style={{ marginBottom: 12 }}>
                <label><span>Desde</span><input type="date" value={trendDateFrom} onChange={e => setTrendDateFrom(e.target.value)} /></label>
                <label><span>Hasta</span><input type="date" value={trendDateTo} onChange={e => setTrendDateTo(e.target.value)} /></label>
              </div>
            )}
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={displayTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={d => { const [, m, day] = d.split('-'); return `${day}/${m}` }} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 12 }}>
                        <p style={{ margin: 0, fontWeight: 600, color: '#091127', marginBottom: 4 }}>{label}</p>
                        {payload.map((p, i) => (
                          <p key={i} style={{ margin: 0, color: p.color, fontWeight: 500 }}>{p.name}: {p.value}</p>
                        ))}
                      </div>
                    )
                  }} />
                  <Line type="monotone" dataKey="total" stroke="#94A3B8" strokeWidth={2} dot={false} name="Totales" />
                  <Line type="monotone" dataKey="completed" stroke="#10B981" strokeWidth={2} dot={false} name="Completados" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="kpi-card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, fontWeight: 600 }}>Recomendaciones</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recommendations.map((rec, i) => <RecommendationCard key={i} rec={rec} />)}
            </div>
          </div>
        )}

        {activity && (
          <div className="kpi-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div className="kpi-seller-section-title" style={{ marginBottom: 0 }}>Actividad Reciente</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ key: 'all', label: 'Todos' }, { key: 'order', label: 'Ordenes' }, { key: 'file', label: 'Archivos' }].map(f => (
                  <button key={f.key} onClick={() => { setActivityFilter(f.key); setActivityLimit(10) }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E8EDF8', background: activityFilter === f.key ? '#091127' : '#fff', color: activityFilter === f.key ? '#fff' : '#64748b', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease' }}>{f.label}</button>
                ))}
              </div>
            </div>
            {showEvents.length > 0 ? (
              <div className="kpi-seller-timeline">
                {showEvents.map(event => (
                  <div key={`${event.source}-${event.id}`} className="kpi-seller-timeline-item">
                    <span className="kpi-seller-timeline-dot" style={{ background: event.source === 'file' ? '#0EA5E9' : '#8B5CF6' }} />
                    <span className="kpi-seller-timeline-line" />
                    <div className="kpi-seller-timeline-content">
                      <div className="kpi-seller-timeline-desc">
                        <span style={{ fontSize: 10, fontWeight: 600, color: event.source === 'file' ? '#0EA5E9' : '#8B5CF6', textTransform: 'uppercase', marginRight: 6 }}>{event.source === 'file' ? 'Archivo' : 'Orden'}</span>
                        #{event.order_id?.slice(0, 8)} {event.detail}
                      </div>
                      <div className="kpi-seller-timeline-time">{formatEventDate(event.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="kpi-empty-state"><div className="kpi-empty-title">Sin actividad</div></div>
            )}
            {filteredEvents.length > activityLimit && (
              <button onClick={() => setActivityLimit(prev => prev + 10)} style={{ width: '100%', padding: '8px 0', marginTop: 10, borderRadius: 8, border: '1px solid #E8EDF8', background: '#fff', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Ver mas ({filteredEvents.length - activityLimit} restantes)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function KPIProductionIntelligence({ period, customDateFrom, customDateTo, onAreaClick }) {
  const [areaCode, setAreaCode] = useState(null)

  const getDateBounds = useCallback(() => getDateBoundsForPeriod(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo])

  const handleAreaClick = useCallback((nextAreaCode) => {
    if (onAreaClick) onAreaClick(nextAreaCode)
    else setAreaCode(nextAreaCode)
  }, [onAreaClick])

  if (areaCode) {
    return <ProductionAreaDetailView areaCode={areaCode} onBack={() => setAreaCode(null)} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
  }

  return <GlobalView getDateBounds={getDateBounds} onAreaClick={handleAreaClick} />
}
