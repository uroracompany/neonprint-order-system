import { useState, useEffect, useCallback, useMemo } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, BarChart, Bar } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays } from '../../utils/kpiHelpers'
import { adminApiFetch } from '../../utils/adminApi'
import DesignerActivityTimeline from './DesignerActivityTimeline'

const DESIGN_COLORS = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#EDE9FE', '#7C3AED', '#6D28D9', '#5B21B6', '#4C1D95', '#2E1065']
const LINE_COLORS = ['#8B5CF6', '#06B6D4', '#10B981', '#F43F5E', '#F59E0B', '#F97316', '#EC4899', '#14B8A6', '#6366F1', '#84CC16']

const GLOBAL_METRICS = [
  { key: 'orders', label: 'Órdenes Totales' },
  { key: 'completed', label: 'Completadas' },
  { key: 'in_design', label: 'En Diseño' },
  { key: 'returned', label: 'Devueltas' },
  { key: 'files', label: 'Archivos Subidos' },
  { key: 'avg_time', label: 'Tiempo Prom. (días)' },
]

const LEADER_CARDS_CONFIG = [
  { key: 'completed', category: 'Más Completadas', icon: Icons.CheckCircle, color: '#10B981', source: 'metrics', metric: 'completed', worst: false },
  { key: 'best_rate', category: 'Mejor % Completado', icon: Icons.TrendUp, color: '#8B5CF6', source: 'overview', field: 'completion_rate', worst: false },
  { key: 'lowest_return', category: 'Menor Devolución', icon: Icons.Refresh, color: '#06B6D4', source: 'metrics', metric: 'returned', worst: true },
  { key: 'files', category: 'Más Archivos', icon: Icons.Package, color: '#F59E0B', source: 'metrics', metric: 'files', worst: false },
  { key: 'fastest', category: 'Más Rápido', icon: Icons.Clock, color: '#10B981', source: 'metrics', metric: 'avg_time', worst: true },
  { key: 'orders', category: 'Más Órdenes', icon: Icons.Orders, color: '#F43F5E', source: 'metrics', metric: 'orders', worst: false },
  { key: 'in_design', category: 'Mayor Carga', icon: Icons.Edit, color: '#F59E0B', source: 'metrics', metric: 'in_design', worst: false },
  { key: 'active', category: 'Más Activo', icon: Icons.Users, color: '#8B5CF6', source: 'overview', field: 'active_designers', worst: false },
]

const LEADER_METRIC_KEYS = ['completed', 'returned', 'files', 'avg_time', 'orders', 'in_design']

const DESIGNER_DETAIL_METRICS = [
  { key: 'orders', label: 'Órdenes' },
  { key: 'completed', label: 'Completadas' },
  { key: 'files', label: 'Archivos' },
]

function ChangeBadge({ value, inverse = false }) {
  if (value === undefined || value === null) return null
  const num = Number(value)
  const isPositive = inverse ? num < 0 : num > 0
  const isNegative = inverse ? num > 0 : num < 0
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: isPositive ? '#10B981' : isNegative ? '#EF4444' : '#94A3B8' }}>
      {isPositive ? '+' : ''}{num.toFixed(1)}%
    </span>
  )
}

function MiniStat({ label, value, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '12px 8px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-sub)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function PieTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const pct = total > 0 ? ((payload[0].value / total) * 100).toFixed(1) : 0
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 600, color: d?.fill || '#333' }}>{payload[0].name}</div>
      <div style={{ color: '#64748b', marginTop: 2 }}>{formatNumber(payload[0].value)} ({pct}%)</div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="kpi-card" style={{ padding: 40, textAlign: 'center' }}>
      <div className="kpi-spinner" />
      <div style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Cargando datos de diseño...</div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="kpi-card" style={{ padding: 40, textAlign: 'center' }}>
      <Icons.AlertCircle size={32} color="#EF4444" />
      <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: '#EF4444' }}>{message}</div>
      {onRetry && <button className="kpi-btn primary" style={{ marginTop: 16 }} onClick={onRetry}>Reintentar</button>}
    </div>
  )
}

function LeaderCardsSection({ overviewData, getDateBounds, onDesignerClick }) {
  const [metricsResults, setMetricsResults] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchAll() {
      setLoading(true)
      const bounds = getDateBounds()
      const results = {}
      await Promise.all(LEADER_METRIC_KEYS.map(async (metric) => {
        try {
          const res = await adminApiFetch('/api/kpi-data', { action: 'designer_metrics', metric, ...bounds })
          if (res.response.ok) results[metric] = res.result
        } catch { /* ignore */ }
      }))
      if (!cancelled) { setMetricsResults(results); setLoading(false) }
    }
    fetchAll()
    return () => { cancelled = true }
  }, [getDateBounds])

  const overview = overviewData?.summary
  const leaders = useMemo(() => {
    return LEADER_CARDS_CONFIG.map(card => {
      let bestDesigner = null
      let bestValue = null
      let deltaVsAvg = null

      if (card.source === 'metrics' && metricsResults[card.metric]) {
        const designers = metricsResults[card.metric].designers || []
        if (designers.length > 0) {
          if (card.worst) {
            const withValue = designers.filter(d => d.value > 0)
            if (withValue.length > 0) {
              bestDesigner = withValue[withValue.length - 1]
              bestValue = bestDesigner.value
              const avg = designers.reduce((s, d) => s + d.value, 0) / designers.length
              deltaVsAvg = avg > 0 ? ((bestValue - avg) / avg) * 100 : 0
            }
          } else {
            bestDesigner = designers[0]
            bestValue = bestDesigner?.value
            if (bestDesigner && designers.length > 1) {
              const avg = designers.reduce((s, d) => s + d.value, 0) / designers.length
              deltaVsAvg = avg > 0 ? ((bestValue - avg) / avg) * 100 : 0
            }
          }
        }
      } else if (card.source === 'overview' && overview) {
        if (card.field === 'completion_rate') {
          bestValue = overview.completion_rate
          bestDesigner = { name: 'Departamento', id: null }
        } else if (card.field === 'active_designers') {
          bestValue = overview.active_designers
          bestDesigner = { name: 'Activos', id: null }
        }
      }

      return { ...card, designer: bestDesigner, value: bestValue, deltaVsAvg }
    })
  }, [metricsResults, overview])

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div key={i} className="kpi-leader-card" style={{ opacity: 0.4 }}><div className="kpi-spinner-sm" /></div>
      ))}
    </div>
  )

  return (
    <div className="kpi-leader-grid" style={{ marginBottom: 24 }}>
      {leaders.map((leader) => (
        <div
          key={leader.key}
          className="kpi-leader-card"
          onClick={() => leader.designer?.id && onDesignerClick(leader.designer.id)}
          style={{ cursor: leader.designer?.id ? 'pointer' : 'default' }}
        >
          <div className="kpi-leader-header">
            <div className="kpi-leader-icon" style={{ background: `${leader.color}15`, color: leader.color }}>
              <leader.icon size={16} />
            </div>
            <div className="kpi-leader-category">{leader.category}</div>
          </div>
          {leader.designer ? (
            <>
              <div className="kpi-leader-name">{leader.designer.name}</div>
              <div className="kpi-leader-value" style={{ color: leader.color }}>{formatNumber(leader.value)}</div>
              {leader.deltaVsAvg !== null && (
                <div className={`kpi-leader-delta ${leader.deltaVsAvg >= 0 ? 'positive' : 'negative'}`}>
                  {leader.deltaVsAvg >= 0 ? '+' : ''}{leader.deltaVsAvg.toFixed(0)}% vs promedio
                </div>
              )}
            </>
          ) : (
            <div className="kpi-leader-empty">Sin datos</div>
          )}
        </div>
      ))}
    </div>
  )
}

function GlobalView({ overviewData, loadingOverview, getDateBounds, onDesignerClick }) {
  const [selectedMetric, setSelectedMetric] = useState('orders')
  const [trendData, setTrendData] = useState(null)
  const [metricsData, setMetricsData] = useState(null)
  const [loadingTrend, setLoadingTrend] = useState(false)
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')

  const currentMetricLabel = useMemo(() => GLOBAL_METRICS.find(m => m.key === selectedMetric)?.label || 'Órdenes', [selectedMetric])

  const CHART_PERIODS = [
    { key: '7d', label: '7d' },
    { key: '1m', label: '1m' },
    { key: '3m', label: '3m' },
    { key: '6m', label: '6m' },
  ]

  const getChartBounds = useCallback(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      return { date_from: `${chartDateFrom}T00:00:00`, date_to: `${chartDateTo}T23:59:59` }
    }
    const now = new Date()
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const from = new Date(to)
    if (chartPeriod === '7d') from.setDate(from.getDate() - 7)
    else if (chartPeriod === '1m') from.setMonth(from.getMonth() - 1)
    else if (chartPeriod === '3m') from.setMonth(from.getMonth() - 3)
    else if (chartPeriod === '6m') from.setMonth(from.getMonth() - 6)
    return { date_from: from.toISOString(), date_to: to.toISOString() }
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const chartGranularity = useMemo(() => {
    const bounds = getChartBounds()
    const diff = (new Date(bounds.date_to) - new Date(bounds.date_from)) / 86400000
    if (diff <= 31) return 'daily'
    if (diff <= 120) return 'weekly'
    return 'monthly'
  }, [getChartBounds])

  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      const from = new Date(chartDateFrom).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
      const to = new Date(chartDateTo).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
      return `${from} – ${to}`
    }
    const labels = { '7d': 'Últimos 7 días', '1m': 'Último mes', '3m': 'Últimos 3 meses', '6m': 'Últimos 6 meses' }
    return labels[chartPeriod] || ''
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  useEffect(() => {
    let cancelled = false
    async function fetchTrend() {
      setLoadingTrend(true)
      const bounds = getChartBounds()
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'designer_daily_trend', metric: selectedMetric, ...bounds })
        if (res.response.ok && !cancelled) setTrendData(res.result)
      } catch { /* ignore */ } finally { if (!cancelled) setLoadingTrend(false) }
    }
    fetchTrend()
    return () => { cancelled = true }
  }, [selectedMetric, getChartBounds])

  useEffect(() => {
    let cancelled = false
    async function fetchMetrics() {
      setLoadingMetrics(true)
      const bounds = getDateBounds()
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'designer_metrics', metric: selectedMetric, ...bounds })
        if (res.response.ok && !cancelled) setMetricsData(res.result)
      } catch { /* ignore */ } finally { if (!cancelled) setLoadingMetrics(false) }
    }
    fetchMetrics()
    return () => { cancelled = true }
  }, [selectedMetric, getDateBounds])

  const summary = overviewData?.summary
  const alerts = overviewData?.alerts || []
  const trend = trendData?.trend || []
  const designerNames = [...new Set(trend.map(t => t.designer_name))]
  const dates = [...new Set(trend.map(t => t.date))].sort()

  const formatXAxis = (date) => {
    const d = new Date(date + 'T12:00:00')
    if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
    if (chartGranularity === 'weekly') {
      const day = d.getDate()
      const month = d.toLocaleDateString('es-DO', { month: 'short' })
      return `${day} ${month}`
    }
    return d.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' })
  }

  if (loadingOverview) return <LoadingState />

  return (
    <>
      <div className="kpi-filter-row" style={{ marginBottom: 16 }}>
        <label style={{ flex: '1 1 280px', minWidth: 200 }}>
          <select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
            {GLOBAL_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
      </div>

      <LeaderCardsSection overviewData={overviewData} getDateBounds={getDateBounds} onDesignerClick={onDesignerClick} />

      <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Evolución del Equipo</h3>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{chartPeriodLabel}</div>
          </div>
          <div className="kpi-pipeline-view-toggle">
            {CHART_PERIODS.map(p => (
              <button key={p.key} className={`kpi-pipeline-view-btn ${chartPeriod === p.key && !chartCustom ? 'active' : ''}`}
                onClick={() => { setChartPeriod(p.key); setChartCustom(false) }}>{p.label}</button>
            ))}
            <button className={`kpi-pipeline-view-btn ${chartCustom ? 'active' : ''}`}
              onClick={() => setChartCustom(!chartCustom)}>Personalizar</button>
          </div>
        </div>
        {chartCustom && (
          <div className="kpi-filter-row" style={{ marginBottom: 16 }}>
            <input type="date" className="kpi-filter-date" value={chartDateFrom} onChange={e => setChartDateFrom(e.target.value)} />
            <span style={{ color: '#94A3B8', fontSize: 12 }}>a</span>
            <input type="date" className="kpi-filter-date" value={chartDateTo} onChange={e => setChartDateTo(e.target.value)} />
          </div>
        )}
        {loadingTrend ? (
          <div style={{ height: 300, display: 'grid', placeItems: 'center' }}><div className="kpi-spinner-sm" /></div>
        ) : trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={dates.map(date => {
              const row = { date }
              trend.filter(t => t.date === date).forEach(t => { row[t.designer_name] = t.value })
              return row
            })}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <Tooltip />
              {designerNames.slice(0, 6).map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="kpi-empty-state" style={{ height: 300 }}>
            <div className="kpi-empty-title">Sin datos de tendencia</div>
            <div className="kpi-empty-message">No hay datos disponibles para este período.</div>
          </div>
        )}
        {designerNames.length > 6 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, justifyContent: 'center' }}>
            {designerNames.slice(0, 6).map((name, i) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
                <div style={{ width: 10, height: 3, borderRadius: 2, background: LINE_COLORS[i % LINE_COLORS.length] }} />
                {name}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="kpi-grid-2col">
        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle" style={{ marginBottom: 0 }}>Ranking — {currentMetricLabel}</h3>
          {loadingMetrics ? (
            <div style={{ display: 'grid', placeItems: 'center', height: 200 }}><div className="kpi-spinner-sm" /></div>
          ) : metricsData?.designers?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {metricsData.designers.slice(0, 8).map((d, i) => (
                <div key={d.id} onClick={() => onDesignerClick(d.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: i === 0 ? '#F5F3FF' : '#f8fafc',
                  border: i === 0 ? '1px solid #DDD6FE' : '1px solid #e8edf8',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#8B5CF6'; e.currentTarget.style.background = '#F5F3FF' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = i === 0 ? '#DDD6FE' : '#e8edf8'; e.currentTarget.style.background = i === 0 ? '#F5F3FF' : '#f8fafc' }}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: 7,
                    background: '#8B5CF6',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                  }}>{d.rank}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{d.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#8B5CF6' }}>{d.pct}%</span>
                    </div>
                    <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(d.pct || 0, 100)}%`, height: '100%', background: '#8B5CF6', borderRadius: 3, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{formatNumber(d.value)} órdenes</div>
                  </div>
                  <Icons.ArrowRight size={13} style={{ color: '#94A3B8', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="kpi-empty-state"><div className="kpi-empty-title">Sin datos</div></div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {alerts.length > 0 && (
            <div className="kpi-card" style={{ padding: 20 }}>
              <h3 className="kpi-card-subtitle" style={{ marginBottom: 12 }}>Alertas</h3>
              {alerts.map((a, i) => (
                <div key={i} className="kpi-design-alert-item" style={{ marginBottom: 8, background: a.severity === 'critical' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${a.severity === 'critical' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)'}` }}>
                  <Icons.AlertCircle size={14} color={a.severity === 'critical' ? '#EF4444' : '#F59E0B'} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: a.severity === 'critical' ? '#DC2626' : '#D97706' }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{a.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="kpi-card" style={{ padding: 20 }}>
            <h3 className="kpi-card-subtitle" style={{ marginBottom: 12 }}>Estado del Equipo</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>Diseñadores activos</span>
                <span style={{ fontWeight: 700, color: '#8B5CF6' }}>{summary?.active_designers || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>Total diseñadores</span>
                <span style={{ fontWeight: 700 }}>{summary?.total_designers || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>En proceso de diseño</span>
                <span style={{ fontWeight: 700, color: '#F59E0B' }}>{summary?.in_design || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>Pendientes de asignar</span>
                <span style={{ fontWeight: 700, color: '#F43F5E' }}>{summary?.pending_orders || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>Tasa de devolución</span>
                <span style={{ fontWeight: 700, color: summary?.return_rate > 15 ? '#EF4444' : '#10B981' }}>{summary?.return_rate || 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export function DesignerDetailView({ designerId, onBack, period, customDateFrom, customDateTo }) {
  const [detail, setDetail] = useState(null)
  const [profile, setProfile] = useState(null)
  const [trendData, setTrendData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')
  const [selectedMetric, setSelectedMetric] = useState('orders')

  const CHART_PERIODS = [
    { key: '7d', label: '7d' },
    { key: '1m', label: '1m' },
    { key: '3m', label: '3m' },
    { key: '6m', label: '6m' },
  ]

  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

  const getChartBounds = useCallback(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      return { date_from: `${chartDateFrom}T00:00:00`, date_to: `${chartDateTo}T23:59:59` }
    }
    const now = new Date()
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const from = new Date(to)
    if (chartPeriod === '7d') from.setDate(from.getDate() - 7)
    else if (chartPeriod === '1m') from.setMonth(from.getMonth() - 1)
    else if (chartPeriod === '3m') from.setMonth(from.getMonth() - 3)
    else if (chartPeriod === '6m') from.setMonth(from.getMonth() - 6)
    return { date_from: from.toISOString(), date_to: to.toISOString() }
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const chartGranularity = useMemo(() => {
    const bounds = getChartBounds()
    const diff = (new Date(bounds.date_to) - new Date(bounds.date_from)) / 86400000
    if (diff <= 31) return 'daily'
    if (diff <= 120) return 'weekly'
    return 'monthly'
  }, [getChartBounds])

  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      const from = new Date(chartDateFrom).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
      const to = new Date(chartDateTo).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
      return `${from} – ${to}`
    }
    const labels = { '7d': 'Últimos 7 días', '1m': 'Último mes', '3m': 'Últimos 3 meses', '6m': 'Últimos 6 meses' }
    return labels[chartPeriod] || ''
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const getPeriodBounds = useCallback(() => {
    if (period === 'custom' && customDateFrom && customDateTo) {
      return { date_from: customDateFrom, date_to: customDateTo }
    }
    const now = new Date()
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const from = new Date(to)
    if (period === 'today') { from.setHours(0, 0, 0, 0) }
    else if (period === 'week') { from.setDate(from.getDate() - from.getDay()) }
    else if (period === 'year') { from.setMonth(0, 1); from.setDate(1) }
    else { from.setDate(1) }
    return { date_from: from.toISOString(), date_to: to.toISOString() }
  }, [period, customDateFrom, customDateTo])

  useEffect(() => {
    let cancelled = false
    async function fetchDesignerData() {
      setLoading(true); setError(null)
      try {
        const bounds = getPeriodBounds()
        const compare = {}
        if (bounds.date_from && bounds.date_to) {
          const from = new Date(bounds.date_from)
          const to = new Date(bounds.date_to)
          const duration = to.getTime() - from.getTime()
          compare.compare_from = new Date(from.getTime() - duration).toISOString()
          compare.compare_to = bounds.date_from
        }
        const [detailRes, profileRes] = await Promise.all([
          adminApiFetch('/api/kpi-data', { action: 'designer_detail', designer_id: designerId, ...bounds, ...compare }),
          adminApiFetch('/api/kpi-data', { action: 'designer_profile', designer_id: designerId, ...bounds }),
        ])
        if (!cancelled) {
          if (detailRes.response.ok) setDetail(detailRes.result)
          if (profileRes.response.ok) setProfile(profileRes.result)
        }
      } catch (err) { if (!cancelled) setError(err.message) } finally { if (!cancelled) setLoading(false) }
    }
    fetchDesignerData()
    return () => { cancelled = true }
  }, [designerId, getPeriodBounds])

  useEffect(() => {
    let cancelled = false
    async function fetchChart() {
      const bounds = getChartBounds()
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'designer_daily_trend', metric: selectedMetric, ...bounds })
        if (res.response.ok && !cancelled) setTrendData(res.result)
      } catch { /* ignore */ }
    }
    fetchChart()
    return () => { cancelled = true }
  }, [designerId, getChartBounds, selectedMetric])

  const formatXAxis = (date) => {
    const d = new Date(date)
    if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
    if (chartGranularity === 'weekly') {
      return `${d.getDate()} ${MONTHS[d.getMonth()]}`
    }
    return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
  }

  const participation = useMemo(() => {
    if (!detail?.vs_department) return 0
    return Math.round((detail.vs_department.orders_vs_avg || 0) * 10) / 10
  }, [detail])

  const designerMetricLabel = useMemo(() => DESIGNER_DETAIL_METRICS.find(m => m.key === selectedMetric)?.label || 'Órdenes', [selectedMetric])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!detail) return <ErrorState message="No hay datos para este diseñador." />

  const { designer, orders: ord, rates, comparison: cmp } = detail
  const initials = (designer?.name || 'D').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const trend = trendData?.trend || []
  const designerTrend = trend.filter(t => t.designer_id === designerId)
  const designerDates = [...new Set(designerTrend.map(t => t.date))].sort()
  const avgByDate = designerDates.map(date => {
    const dayValues = trend.filter(t => t.date === date).map(t => t.value)
    return dayValues.reduce((s, v) => s + v, 0) / dayValues.length
  })
  const departmentAvg = avgByDate.length > 0 ? avgByDate.reduce((s, v) => s + v, 0) / avgByDate.length : 0

  const alerts = []
  if (rates.return_rate > 15) alerts.push({ color: '#EF4444', message: `Tasa de devolución alta: ${rates.return_rate}%` })
  if (ord?.in_design > 5) alerts.push({ color: '#F59E0B', message: `${ord.in_design} órdenes en proceso de diseño` })
  if (profile?.days_since_last_order !== null && profile?.days_since_last_order > 7) alerts.push({ color: '#EF4444', message: `Sin actividad de diseño hace ${profile.days_since_last_order} días` })

  const filesByArea = profile?.files_by_area || {}
  const filesAreaData = Object.entries(filesByArea).map(([name, value]) => ({ name: name === 'digital' ? 'Digital' : name === 'dtf' ? 'DTF' : name === 'ploteo' ? 'Ploteo' : name, value }))
  const AREA_COLORS = ['#8B5CF6', '#06B6D4', '#10B981']

  const materials = profile?.materials || []

  const statusBreakdown = [
    { name: 'Completadas', value: ord?.completed || 0, color: '#10B981' },
    { name: 'Entregadas', value: ord?.delivered || 0, color: '#22C55E' },
    { name: 'En Diseño', value: ord?.in_design || 0, color: '#8B5CF6' },
    { name: 'En Producción', value: ord?.in_production || 0, color: '#F59E0B' },
    { name: 'Pendientes', value: (ord?.pending || 0) + (ord?.in_quote || 0), color: '#06B6D4' },
    { name: 'Canceladas', value: ord?.cancelled || 0, color: '#EF4444' },
  ].filter(s => s.value > 0)

  const topClients = profile?.top_clients || []
  const totalClientOrders = topClients.reduce((s, c) => s + (c.total_orders || 0), 0)

  const periodLabel = (() => {
    if (period === 'today') return 'Hoy'
    if (period === 'week') return 'Esta semana'
    if (period === 'year') return new Date().getFullYear()
    if (period === 'custom' && customDateFrom && customDateTo) {
      const f = new Date(customDateFrom)
      const t = new Date(customDateTo)
      return `${f.getDate()} ${MONTHS[f.getMonth()]} – ${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`
    }
    const now = new Date()
    return `${MONTHS[now.getMonth()]} ${now.getFullYear()}`
  })()

  return (
    <div className="kpi-seller-page">
      <div className="kpi-seller-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kpi-seller-avatar" style={{ background: '#8B5CF6' }}>{initials}</div>
          <div>
            <h2>{designer?.name || 'Diseñador'}</h2>
            <div className="kpi-seller-header-meta">
              <span className="kpi-seller-period-badge">Período: {periodLabel}</span>
              {participation !== 0 && (
                <span className="kpi-seller-participation-badge">
                  {participation > 0 ? '+' : ''}{participation}% vs promedio
                </span>
              )}
            </div>
          </div>
        </div>
        <button className="kpi-seller-back-btn" onClick={onBack}><Icons.ChevronLeft size={15} /> Volver al panel</button>
      </div>

      <div className="kpi-seller-page-body">
        {alerts.length > 0 && (
          <div className="kpi-seller-alerts">
            {alerts.map((a, i) => (
              <div key={i} className="kpi-seller-alert-item" style={{ borderColor: a.color }}>
                <Icons.AlertCircle size={14} style={{ color: a.color }} />
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className="kpi-seller-hero-grid">
          {[
            { label: 'Órdenes Totales', value: formatNumber(ord?.total || 0), icon: Icons.Orders, color: '#8B5CF6', sub: `${ord?.normal || 0} normales · ${ord?.urgent || 0} urgentes`, change: cmp?.total?.change_pct },
            { label: 'Tasa de Completado', value: `${rates.completion_rate}%`, icon: Icons.CheckCircle, color: '#10B981', sub: `${ord?.completed || 0} de ${ord?.total || 0} órdenes`, change: cmp?.completed?.change_pct },
            { label: 'Carga Actual', value: (ord?.in_design || 0) + (ord?.in_production || 0), icon: Icons.Clipboard, color: ((ord?.in_design || 0) + (ord?.in_production || 0)) > 10 ? '#EF4444' : ((ord?.in_design || 0) + (ord?.in_production || 0)) > 5 ? '#F59E0B' : '#10B981', sub: `${ord?.in_design || 0} en diseño · ${ord?.in_production || 0} en producción` },
            { label: 'Archivos Entregados', value: formatNumber(profile?.total_files || 0), icon: Icons.Package, color: '#F59E0B', sub: `${profile?.avg_files_per_order || 0} archivos/orden` },
          ].map((card, i) => {
            const Icon = card.icon
            const changeVal = card.change
            const isPositive = card.inverse ? changeVal < 0 : changeVal > 0
            const isNegative = card.inverse ? changeVal > 0 : changeVal < 0
            return (
              <div key={i} className="kpi-seller-hero-card">
                <div className="kpi-seller-hero-header">
                  <div className="kpi-seller-hero-label">{card.label}</div>
                  <div className="kpi-seller-hero-icon" style={{ background: `${card.color}15`, color: card.color }}><Icon size={16} /></div>
                </div>
                <div className="kpi-seller-hero-value">{card.value}</div>
                <div className="kpi-seller-hero-footer">
                  <div className="kpi-seller-hero-subtitle">{card.sub}</div>
                  {changeVal !== undefined && changeVal !== null && (
                    <span className="kpi-seller-hero-trend" style={{ background: isPositive ? '#DCFCE7' : isNegative ? '#FEE2E2' : '#F1F5F9', color: isPositive ? '#16A34A' : isNegative ? '#DC2626' : '#64748b' }}>
                      {isPositive ? '↑' : isNegative ? '↓' : ''} {Math.abs(changeVal).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Distribución de Órdenes — Normal vs Urgente */}
        {(ord?.normal > 0 || ord?.urgent > 0) && (
          <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
            <h3 className="kpi-card-subtitle">Distribución de Órdenes</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 16 }}>
              <div style={{ flex: '0 0 130px', height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[
                      { name: 'Normales', value: ord?.normal || 0, fill: '#8B5CF6' },
                      { name: 'Urgentes (911)', value: ord?.urgent || 0, fill: '#F43F5E' },
                    ].filter(d => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3}>
                    </Pie>
                    <Tooltip content={(props) => <PieTooltip {...props} total={ord?.total || 0} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { name: 'Normales', value: ord?.normal || 0, color: '#8B5CF6' },
                  { name: 'Urgentes (911)', value: ord?.urgent || 0, color: '#F43F5E' },
                ].filter(d => d.value > 0).map((item, i) => {
                  const pct = (ord?.total || 0) > 0 ? Math.round((item.value / ord.total) * 1000) / 10 : 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e8edf8' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#091127', flex: 1 }}>{item.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{formatNumber(item.value)}</span>
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Evolución de Productividad</h3>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{chartPeriodLabel}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #e8edf8', background: '#fff', color: '#64748b', cursor: 'pointer' }}>
                {DESIGNER_DETAIL_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
                {CHART_PERIODS.map(p => (
                  <button key={p.key} className={`kpi-pipeline-view-btn ${chartPeriod === p.key && !chartCustom ? 'active' : ''}`}
                    onClick={() => { setChartPeriod(p.key); setChartCustom(false) }}>{p.label}</button>
                ))}
                <button className={`kpi-pipeline-view-btn ${chartCustom ? 'active' : ''}`}
                  onClick={() => setChartCustom(!chartCustom)}>Personalizar</button>
              </div>
            </div>
          </div>
          {chartCustom && (
            <div className="kpi-filter-row" style={{ marginTop: 8, marginBottom: 8 }}>
              <label><span>Desde</span><input type="date" value={chartDateFrom} onChange={e => setChartDateFrom(e.target.value)} /></label>
              <label><span>Hasta</span><input type="date" value={chartDateTo} onChange={e => setChartDateTo(e.target.value)} /></label>
            </div>
          )}
          <div style={{ position: 'relative' }}>
            {designerTrend.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={designerDates.map((date, i) => ({ date, value: designerTrend.find(t => t.date === date)?.value || 0, avg: avgByDate[i] }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8edf8" />
                    <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                    <Tooltip wrapperStyle={{ zIndex: 9999 }} labelFormatter={(v) => { const d = new Date(v); return d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) }} formatter={(v) => [`${v} ${designerMetricLabel.toLowerCase()}`, designer?.name]} />
                    <ReferenceLine y={departmentAvg} stroke="#94A3B8" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `Prom. depto: ${departmentAvg.toFixed(1)}`, position: 'insideTopRight', fontSize: 11, fill: '#94A3B8' }} />
                    <Line type="monotone" dataKey="value" stroke="#8B5CF6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name={designer?.name} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="kpi-empty-state" style={{ height: 220 }}>
                <div className="kpi-empty-title">Sin datos de productividad para este período</div>
                <div className="kpi-empty-message">{chartPeriodLabel}</div>
              </div>
            )}
          </div>
        </div>

        <div className="kpi-seller-section-title">Análisis de Diseño</div>
        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          <h3 className="kpi-card-subtitle">Archivos por Área</h3>
          {filesAreaData.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 16 }}>
              <div style={{ flex: '0 0 130px', height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={filesAreaData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3}>
                      {filesAreaData.map((_, i) => <Cell key={i} fill={AREA_COLORS[i % AREA_COLORS.length]} stroke="#fff" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip content={(props) => <PieTooltip {...props} total={ord?.total || 0} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filesAreaData.map((area, i) => (
                  <div key={area.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e8edf8' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: AREA_COLORS[i], flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#091127', flex: 1 }}>{area.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: AREA_COLORS[i] }}>{area.value}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{profile?.total_files || 0} archivos totales</div>
              </div>
            </div>
          ) : (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin archivos</div></div>
          )}
        </div>

        {/* Desglose por Estado — full width */}
        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          <h3 className="kpi-card-subtitle">Desglose por Estado</h3>
          {statusBreakdown.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {statusBreakdown.map((s, i) => {
                const pct = (ord?.total || 0) > 0 ? Math.round((s.value / ord.total) * 1000) / 10 : 0
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 120, fontSize: 13, fontWeight: 500, color: '#091127', flexShrink: 0 }}>{s.name}</div>
                    <div style={{ flex: 1, height: 8, background: '#e8edf8', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: s.color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ width: 50, fontSize: 13, fontWeight: 700, color: s.color, textAlign: 'right' }}>{formatNumber(s.value)}</div>
                    <div style={{ width: 45, fontSize: 11, color: '#94A3B8', textAlign: 'right' }}>{pct}%</div>
                  </div>
                )
              })}
            </div>
          ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos</div></div>}
        </div>

        <div className="kpi-seller-section-grid">
          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Frecuencia de Órdenes</h3>
            <div className="kpi-seller-freq-grid" style={{ marginTop: 16 }}>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#8B5CF6' }}>{profile?.order_frequency?.per_day || 0}</div>
                <div className="kpi-seller-freq-label">Por día</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#10B981' }}>{profile?.order_frequency?.per_week || 0}</div>
                <div className="kpi-seller-freq-label">Por semana</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#F59E0B' }}>{profile?.order_frequency?.per_month || 0}</div>
                <div className="kpi-seller-freq-label">Por mes</div>
              </div>
            </div>
          </div>

          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Carga de Trabajo</h3>
            <div className="kpi-seller-freq-grid" style={{ marginTop: 16 }}>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#8B5CF6' }}>{ord?.in_design || 0}</div>
                <div className="kpi-seller-freq-label">En Diseño</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#F59E0B' }}>{ord?.in_production || 0}</div>
                <div className="kpi-seller-freq-label">En Producción</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#06B6D4' }}>{(ord?.pending || 0) + (ord?.in_quote || 0)}</div>
                <div className="kpi-seller-freq-label">Pendientes</div>
              </div>
            </div>
          </div>
        </div>

        {topClients.length > 0 && (
          <>
            <div className="kpi-seller-section-title" style={{ marginTop: 8 }}>Relación con Clientes</div>
            <p className="kpi-seller-section-subtitle">Análisis de la relación del diseñador con sus clientes asignados y materiales predominantes.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <span className="kpi-seller-stat-pill"><Icons.Users size={14} /> {topClients.length} clientes</span>
              <span className="kpi-seller-stat-pill"><Icons.Orders size={14} /> {ord?.total || 0} órdenes</span>
            </div>
            <div className="kpi-seller-section-grid" style={{ marginBottom: 24 }}>
              <div className="kpi-card" style={{ padding: 24 }}>
                <h3 className="kpi-card-subtitle">Clientes Más Frecuentes</h3>
                {topClients.length > 0 ? (
                <div className="kpi-seller-list" style={{ marginTop: 16 }}>
                  {topClients.slice(0, 6).map((client, i) => {
                    const clientPct = totalClientOrders > 0 ? Math.round(client.total_orders / totalClientOrders * 1000) / 10 : 0
                    return (
                      <div key={i} className="kpi-seller-list-item">
                        <div className="kpi-seller-list-rank" style={{
                          background: '#8B5CF6',
                          color: '#fff',
                        }}>{i + 1}</div>
                        <div className="kpi-seller-list-info">
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span className="kpi-seller-list-name">{client.client_name}</span>
                            <span className="kpi-seller-list-value" style={{ color: '#8B5CF6' }}>{clientPct}%</span>
                          </div>
                          <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(clientPct, 100)}%`, height: '100%', background: '#8B5CF6', borderRadius: 3, transition: 'width 0.6s ease' }} />
                          </div>
                          <div className="kpi-seller-list-sub" style={{ marginTop: 4 }}>
                            {client.total_orders} órdenes · {client.completed_orders} completadas · cancelación{' '}
                            <span style={{ color: client.cancel_rate > 15 ? '#EF4444' : '#10B981', fontWeight: 600 }}>{client.cancel_rate}%</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin clientes con órdenes en este periodo</div></div>}
              </div>

              <div className="kpi-card" style={{ padding: 24 }}>
                <h3 className="kpi-card-subtitle">Materiales Más Presentes en sus Órdenes</h3>
                {materials.length > 0 ? (
                  <div className="kpi-seller-list" style={{ marginTop: 16 }}>
                    {materials.slice(0, 6).map((mat, i) => (
                      <div key={i} className="kpi-seller-list-item">
                        <div className="kpi-seller-list-rank" style={{
                          background: '#8B5CF6',
                          color: '#fff',
                        }}>{i + 1}</div>
                        <div className="kpi-seller-list-info">
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span className="kpi-seller-list-name">{mat.name}</span>
                            <span className="kpi-seller-list-value" style={{ color: '#8B5CF6' }}>{mat.pct}%</span>
                          </div>
                          <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(mat.pct || 0, 100)}%`, height: '100%', background: '#8B5CF6', borderRadius: 3, transition: 'width 0.6s ease' }} />
                          </div>
                          <div className="kpi-seller-list-sub" style={{ marginTop: 4 }}>{mat.count} órdenes</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin materiales registrados</div></div>}
              </div>
            </div>
          </>
        )}

        {cmp && (() => {
          const cmpReturnRateCurr = cmp.total.curr > 0 ? +((cmp.returned.curr / cmp.total.curr) * 100).toFixed(1) : 0
          const cmpReturnRatePrev = cmp.total.prev > 0 ? +((cmp.returned.prev / cmp.total.prev) * 100).toFixed(1) : 0
          const cmpCompletionRateCurr = cmp.completed.curr
          const cmpCompletionRatePrev = cmp.completed.prev
          const comparisonItems = [
            { label: 'Órdenes', curr: cmp.total.curr, prev: cmp.total.prev, change: cmp.total.change_pct },
            { label: 'Completado', curr: `${cmpCompletionRateCurr}%`, prev: `${cmpCompletionRatePrev}%`, change: cmp.completed.change_pct },
            { label: 'Devolución', curr: `${cmpReturnRateCurr}%`, prev: `${cmpReturnRatePrev}%`, change: cmpReturnRatePrev === 0 ? (cmpReturnRateCurr > 0 ? 100 : 0) : ((cmpReturnRateCurr - cmpReturnRatePrev) / cmpReturnRatePrev) * 100, inverse: true },
            { label: 'Tiempo Prom.', curr: formatDays(cmp.avg_days.curr), prev: formatDays(cmp.avg_days.prev), change: cmp.avg_days.change_pct, inverse: true },
          ]
          const improved = comparisonItems.filter(item => {
            const positive = item.inverse ? item.change < 0 : item.change > 0
            return positive && item.change !== 0
          }).length
          const worsened = comparisonItems.filter(item => {
            const negative = item.inverse ? item.change > 0 : item.change < 0
            return negative && item.change !== 0
          }).length
          const noData = cmp.total.prev === 0 && cmp.total.curr === 0
          const summaryText = noData
            ? 'Sin datos suficientes para comparar períodos.'
            : improved === comparisonItems.length
            ? 'Mejoró en todas las métricas respecto al período anterior.'
            : worsened === comparisonItems.length
            ? 'Empeoró en todas las métricas respecto al período anterior.'
            : improved > worsened
            ? `Mejoró en ${improved} de ${comparisonItems.length} métricas respecto al período anterior.`
            : improved < worsened
            ? `Empeoró en ${worsened} de ${comparisonItems.length} métricas respecto al período anterior.`
            : improved === 0 && worsened === 0
            ? 'Mantiene un rendimiento estable respecto al período anterior.'
            : `Sin cambios significativos respecto al período anterior.`
          const summaryIcon = noData ? '#94A3B8' : improved > worsened ? '#10B981' : improved < worsened ? '#EF4444' : '#94A3B8'

          return (
            <>
              <div className="kpi-seller-section-title">Comparación con Período Anterior</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                {noData ? (
                  <Icons.AlertCircle size={14} style={{ color: summaryIcon }} />
                ) : improved > worsened ? (
                  <Icons.TrendUp size={14} style={{ color: summaryIcon }} />
                ) : improved < worsened ? (
                  <Icons.Refresh size={14} style={{ color: summaryIcon }} />
                ) : (
                  <Icons.Clock size={14} style={{ color: summaryIcon }} />
                )}
                {summaryText}
              </div>
              <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
                {comparisonItems.map((item, i) => {
                  const isPositive = item.inverse ? item.change < 0 : item.change > 0
                  const isNegative = item.inverse ? item.change > 0 : item.change < 0
                  const borderColor = isPositive ? '#10B981' : isNegative ? '#EF4444' : '#94A3B8'
                  const arrow = item.change > 0 ? '↑' : item.change < 0 ? '↓' : '→'
                  return (
                    <div key={i} className="kpi-seller-comparison-card" style={{ borderLeft: `3px solid ${borderColor}`, textAlign: 'left' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span className="kpi-seller-comparison-label" style={{ margin: 0 }}>{item.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: borderColor, display: 'flex', alignItems: 'center', gap: 3 }}>
                          {arrow} {isPositive ? '+' : ''}{item.change.toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span className="kpi-seller-comparison-value">{item.curr}</span>
                        <span style={{ fontSize: 13, color: '#94A3B8' }}>→</span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: '#94A3B8' }}>{item.prev}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )
        })()}

        <DesignerActivityTimeline designerId={designerId} getDateBounds={getChartBounds} />
      </div>
    </div>
  )
}

export default function KPIDesignIntelligence({ period, customDateFrom, customDateTo, onDesignerClick }) {
  const [overviewData, setOverviewData] = useState(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [error, setError] = useState(null)

  const getDateBounds = useCallback(() => {
    if (period === 'custom' && customDateFrom && customDateTo) {
      return { date_from: customDateFrom, date_to: customDateTo }
    }
    const now = new Date()
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const from = new Date(to)
    if (period === 'today') { from.setHours(0, 0, 0, 0) }
    else if (period === 'week') { from.setDate(from.getDate() - from.getDay()) }
    else if (period === 'year') { from.setMonth(0, 1); from.setDate(1) }
    else { from.setDate(1) }
    return { date_from: from.toISOString(), date_to: to.toISOString() }
  }, [period, customDateFrom, customDateTo])

  const getCompareBounds = useCallback(() => {
    const bounds = getDateBounds()
    const from = new Date(bounds.date_from)
    const to = new Date(bounds.date_to)
    const diff = to - from
    return { compare_from: new Date(from - diff).toISOString(), compare_to: from.toISOString() }
  }, [getDateBounds])

  const fetchOverview = useCallback(async () => {
    setLoadingOverview(true); setError(null)
    try {
      const bounds = getDateBounds()
      const compare = getCompareBounds()
      const res = await adminApiFetch('/api/kpi-data', { action: 'design_overview', ...bounds, ...compare })
      if (res.response.ok) setOverviewData(res.result)
      else setError(res.result?.error || 'Error al cargar datos de diseño')
    } catch (err) { setError(err.message) } finally { setLoadingOverview(false) }
  }, [getDateBounds, getCompareBounds])

  useEffect(() => { fetchOverview() }, [fetchOverview])

  if (error && !overviewData) return <ErrorState message={error} onRetry={fetchOverview} />

  return (
    <div>
      <GlobalView overviewData={overviewData} loadingOverview={loadingOverview} getDateBounds={getDateBounds} onDesignerClick={onDesignerClick} />
    </div>
  )
}
