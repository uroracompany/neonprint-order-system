import { useState, useEffect, useMemo, useCallback } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays } from '../../utils/kpiHelpers'
import { adminApiFetch } from '../../utils/adminApi'

const SELLER_COLORS = ['#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A', '#FEF3C7', '#D97706', '#B45309', '#92400E', '#78350F', '#451A03']
const LINE_COLORS = ['#F59E0B', '#06B6D4', '#10B981', '#F43F5E', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#6366F1', '#84CC16']

const GLOBAL_METRICS = [
  { key: 'orders', label: 'Órdenes Totales' },
  { key: 'urgent', label: 'Órdenes 911' },
  { key: 'normal', label: 'Órdenes Normales' },
  { key: 'cancelled', label: 'Cancelaciones' },
  { key: 'internal', label: 'Órdenes Internas' },
  { key: 'external', label: 'Órdenes Externas' },
  { key: 'completed', label: 'Órdenes Completadas' },
  { key: 'pending', label: 'Órdenes Pendientes' },
  { key: 'delivered', label: 'Órdenes Entregadas' },
]

function ChangeBadge({ value, suffix = '%', inverse = false }) {
  if (value === null || value === undefined) return null
  const num = parseFloat(value)
  if (num === 0) return null
  const isPositive = num > 0
  const good = inverse ? !isPositive : isPositive
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6,
      background: good ? '#DCFCE7' : '#FEE2E2',
      color: good ? '#16A34A' : '#DC2626',
    }}>
      {isPositive ? '↑' : '↓'} {Math.abs(num)}{suffix}
    </span>
  )
}

function MiniStat({ label, value, sub, color }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e8edf8' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || '#091127', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
      <p style={{ margin: 0, fontWeight: 600, color: d.color }}>{d.name}</p>
      <p style={{ margin: '4px 0 0', fontWeight: 500 }}>{formatNumber(d.value)} — {d.pct || d.value}%</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="kpi-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <div className="kpi-spinner" />
      </div>
    </div>
  )
}

function ErrorState({ error }) {
  return (
    <div className="kpi-card" style={{ padding: 24 }}>
      <div className="kpi-empty-state">
        <div className="kpi-empty-icon"><Icons.AlertCircle size={28} /></div>
        <div className="kpi-empty-title">Error al cargar datos</div>
        <div className="kpi-empty-message">{error}</div>
      </div>
    </div>
  )
}

function EmptyState({ message = 'No hay datos disponibles para este periodo.' }) {
  return (
    <div className="kpi-card" style={{ padding: 24 }}>
      <div className="kpi-empty-state">
        <div className="kpi-empty-icon"><Icons.Users size={28} /></div>
        <div className="kpi-empty-title">Sin datos</div>
        <div className="kpi-empty-message">{message}</div>
      </div>
    </div>
  )
}

/* ────────────────── LEADER CARDS ────────────────── */

const LEADER_CARDS_CONFIG = [
  { key: 'total', category: 'Más Órdenes Totales', icon: Icons.Orders, color: '#06B6D4', source: 'overview', field: 'orders_created' },
  { key: 'internal', category: 'Más Internas', icon: Icons.Package, color: '#06B6D4', source: 'metrics' },
  { key: 'external', category: 'Más Externas', icon: Icons.ExternalLink, color: '#94A3B8', source: 'metrics' },
  { key: 'normal', category: 'Más Normales', icon: Icons.FileText, color: '#10B981', source: 'metrics' },
  { key: 'urgent', category: 'Más 911', icon: Icons.Bell, color: '#F43F5E', source: 'metrics' },
  { key: 'cancelled', category: 'Más Cancelaciones', icon: Icons.AlertCircle, color: '#EF4444', source: 'metrics' },
  { key: 'completed', category: 'Más Completadas', icon: Icons.CheckCircle, color: '#10B981', source: 'metrics' },
  { key: 'best_rate', category: 'Mejor % Finalización', icon: Icons.TrendUp, color: '#10B981', source: 'overview', field: 'completed_rate' },
  { key: 'low_cancel', category: 'Menor Cancelación', icon: Icons.Check, color: '#10B981', source: 'overview', field: 'cancelled_orders' },
  { key: 'participation', category: 'Mayor Participación', icon: Icons.Clipboard, color: '#F59E0B', source: 'overview', field: 'pct_of_total' },
]

const LEADER_METRIC_KEYS = ['internal', 'external', 'normal', 'urgent', 'cancelled', 'completed']

function LeaderCardsSection({ overviewData, getDateBounds, onSellerClick }) {
  const [metricsResults, setMetricsResults] = useState({})
  const [loading, setLoading] = useState(true)

  const sellers = useMemo(() => overviewData?.sellers || [], [overviewData])

  useEffect(() => {
    let cancelled = false
    async function fetchAll() {
      setLoading(true)
      const bounds = getDateBounds()
      try {
        const results = await Promise.all(
          LEADER_METRIC_KEYS.map(metric =>
            adminApiFetch('/api/kpi-data', { action: 'seller_metrics', metric, ...bounds })
              .then(res => ({ metric, data: res.response.ok ? res.result : null }))
          )
        )
        if (!cancelled) {
          const map = {}
          results.forEach(r => { if (r.data) map[r.metric] = r.data })
          setMetricsResults(map)
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    }
    fetchAll()
    return () => { cancelled = true }
  }, [getDateBounds])

  const leaders = useMemo(() => {
    const avg = sellers.length > 0 ? Math.round(sellers.reduce((s, v) => s + (v.orders_created || 0), 0) / sellers.length * 10) / 10 : 0

    const getLeader = (arr, field, worst = false) => {
      if (!arr || arr.length === 0) return null
      const sorted = [...arr].sort((a, b) => worst ? (b.value || 0) - (a.value || 0) : (b.value || 0) - (a.value || 0))
      const top = sorted[0]
      if (!top || (top.value || 0) === 0) return null
      const second = sorted[1]
      const deltaVsAvg = avg > 0 ? Math.round((top.value - avg) / avg * 100) : 0
      return { ...top, deltaVsAvg, secondValue: second?.value || 0 }
    }

    const fromOverview = (field, worst = false) => {
      const mapped = sellers.map(s => ({ id: s.id, name: s.name, value: s[field] || 0 }))
      return getLeader(mapped, field, worst)
    }

    const fromMetrics = (metric, worst = false) => {
      const data = metricsResults[metric]
      if (!data?.sellers) return null
      return getLeader(data.sellers, 'value', worst)
    }

    return LEADER_CARDS_CONFIG.map(card => {
      let leader
      if (card.source === 'overview') {
        leader = card.key === 'low_cancel'
          ? fromOverview(card.field, true)
          : fromOverview(card.field)
      } else {
        leader = fromMetrics(card.key, card.key === 'cancelled')
      }
      return { ...card, leader, avg }
    })
  }, [sellers, metricsResults])

  if (loading) {
    return (
      <div className="kpi-leader-grid">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="kpi-leader-card" style={{ minHeight: 140 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div className="kpi-spinner" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (sellers.length === 0) return null

  return (
    <div className="kpi-leader-grid">
      {leaders.map((card) => {
        const Icon = card.icon
        const leader = card.leader
        return (
          <div
            key={card.key}
            className="kpi-leader-card"
            onClick={() => leader && onSellerClick(leader.id)}
            style={{ '--leader-color': card.color }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: card.color, borderRadius: '12px 12px 0 0', opacity: 0.6 }} />
            <div className="kpi-leader-header">
              <div className="kpi-leader-icon" style={{ background: card.color + '18', color: card.color }}>
                <Icon size={16} />
              </div>
              <div className="kpi-leader-category">{card.category}</div>
            </div>
            {leader ? (
              <>
                <div className="kpi-leader-name">{leader.name}</div>
                <div className="kpi-leader-value">
                  {formatNumber(leader.value)}{card.source === 'overview' && card.field === 'completed_rate' ? '%' : ''} {card.source === 'overview' && card.field === 'pct_of_total' ? '%' : ''}
                  {leader.pct !== undefined && <span style={{ color: '#94A3B8', marginLeft: 4 }}>({leader.pct}%)</span>}
                </div>
                {card.key !== 'low_cancel' && leader.deltaVsAvg !== 0 && (
                  <div className={`kpi-leader-delta ${leader.deltaVsAvg > 0 ? 'positive' : 'negative'}`}>
                    {leader.deltaVsAvg > 0 ? '↑' : '↓'} {Math.abs(leader.deltaVsAvg)}% vs promedio
                  </div>
                )}
                {card.key === 'low_cancel' && (
                  <div className="kpi-leader-delta positive">Menos cancelaciones del equipo</div>
                )}
              </>
            ) : (
              <div className="kpi-leader-empty">Sin datos</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ────────────────── GLOBAL VIEW ────────────────── */

function GlobalView({ overviewData, loadingOverview, getDateBounds, onSellerClick }) {
  const [selectedMetric, setSelectedMetric] = useState('orders')
  const [trendData, setTrendData] = useState(null)
  const [metricsData, setMetricsData] = useState(null)
  const [loadingTrend, setLoadingTrend] = useState(false)
  const [loadingMetrics, setLoadingMetrics] = useState(false)

  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')

  const CHART_PERIODS = [
    { key: '7d', label: '7d' },
    { key: '1m', label: '1m' },
    { key: '3m', label: '3m' },
    { key: '6m', label: '6m' },
  ]

  const getChartBounds = useCallback(() => {
    const now = new Date()
    let start, end
    if (chartCustom && chartDateFrom && chartDateTo) {
      return {
        date_from: new Date(chartDateFrom + 'T00:00:00').toISOString(),
        date_to: new Date(chartDateTo + 'T23:59:59').toISOString(),
      }
    }
    switch (chartPeriod) {
      case '7d':
        start = new Date(now)
        start.setDate(now.getDate() - 7)
        break
      case '3m':
        start = new Date(now)
        start.setMonth(now.getMonth() - 3)
        break
      case '6m':
        start = new Date(now)
        start.setMonth(now.getMonth() - 6)
        break
      default:
        start = new Date(now)
        start.setMonth(now.getMonth() - 1)
    }
    end = new Date(now.getTime() + 86400000)
    return { date_from: start.toISOString(), date_to: end.toISOString() }
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const chartGranularity = useMemo(() => {
    const bounds = getChartBounds()
    if (!bounds.date_from || !bounds.date_to) return 'daily'
    const totalDays = Math.round((new Date(bounds.date_to) - new Date(bounds.date_from)) / 86400000)
    if (totalDays <= 31) return 'daily'
    if (totalDays <= 120) return 'weekly'
    return 'monthly'
  }, [getChartBounds])

  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      const f = new Date(chartDateFrom + 'T00:00:00')
      const t = new Date(chartDateTo + 'T00:00:00')
      const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
      return `${f.getDate()} ${MONTHS[f.getMonth()]} – ${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`
    }
    const labels = { '7d': 'Últimos 7 días', '1m': 'Último mes', '3m': 'Últimos 3 meses', '6m': 'Últimos 6 meses' }
    return labels[chartPeriod] || 'Último mes'
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const s = useMemo(() => overviewData?.summary || {}, [overviewData])
  const alerts = useMemo(() => overviewData?.alerts || [], [overviewData])

  const fetchTrend = useCallback(async (metric) => {
    setLoadingTrend(true)
    try {
      const bounds = getChartBounds()
      const result = await adminApiFetch('/api/kpi-data', { action: 'seller_daily_trend', metric, ...bounds })
      if (result.response.ok) setTrendData(result.result)
    } catch { /* ignore */ } finally { setLoadingTrend(false) }
  }, [getChartBounds])

  const fetchMetrics = useCallback(async (metric) => {
    setLoadingMetrics(true)
    try {
      const bounds = getDateBounds()
      const result = await adminApiFetch('/api/kpi-data', { action: 'seller_metrics', metric, ...bounds })
      if (result.response.ok) setMetricsData(result.result)
    } catch { /* ignore */ } finally { setLoadingMetrics(false) }
  }, [getDateBounds])

  useEffect(() => { fetchTrend(selectedMetric) }, [selectedMetric, fetchTrend])
  useEffect(() => { fetchMetrics(selectedMetric) }, [selectedMetric, fetchMetrics])

  const trend = useMemo(() => {
    if (!trendData?.trend) return { chartData: [], sellers: [] }
    const byDate = {}
    const sellerNames = {}
    trendData.trend.forEach(item => {
      if (!byDate[item.date]) byDate[item.date] = { date: item.date }
      byDate[item.date][item.seller_id] = item.value
      sellerNames[item.seller_id] = item.seller_name
    })
    const allDates = Object.keys(byDate).sort()
    const sellerEntries = Object.entries(sellerNames)
      .map(([id, name]) => ({ id, name, total: allDates.reduce((sum, d) => sum + (byDate[d][id] || 0), 0) }))
      .sort((a, b) => b.total - a.total)
    const topSellers = sellerEntries.slice(0, 6)
    const chartData = allDates.map(d => {
      const row = { date: d }
      topSellers.forEach(s => { row[s.id] = byDate[d][s.id] || 0 })
      return row
    })
    return { chartData, sellers: topSellers }
  }, [trendData])

  const topSellers = useMemo(() => metricsData?.sellers?.slice(0, 8) || [], [metricsData])
  const currentMetricLabel = useMemo(() => GLOBAL_METRICS.find(m => m.key === selectedMetric)?.label || 'Órdenes', [selectedMetric])

  if (loadingOverview && !overviewData) return <LoadingState />
  if (!overviewData) return <EmptyState />
  if (overviewData?.error) return <ErrorState error={overviewData.error} />

  return (
    <div>
      <div className="kpi-filter-row" style={{ marginBottom: 20 }}>
        <label style={{ flex: '1 1 280px', minWidth: 200 }}>
          <select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
            {GLOBAL_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
      </div>

      <LeaderCardsSection overviewData={overviewData} getDateBounds={getDateBounds} onSellerClick={onSellerClick} />

      <div className="kpi-card" style={{ padding: 24, marginBottom: 20, position: 'relative' }}>
        {loadingTrend && trend.chartData.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <div className="kpi-spinner" />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Evolución del Equipo — {currentMetricLabel}</h3>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{chartPeriodLabel}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
              {CHART_PERIODS.map(p => (
                <button
                  key={p.key}
                  className={`kpi-pipeline-view-btn ${chartPeriod === p.key && !chartCustom ? 'active' : ''}`}
                  onClick={() => { setChartPeriod(p.key); setChartCustom(false) }}
                >{p.label}</button>
              ))}
            </div>
            <button
              className={`kpi-pipeline-view-btn ${chartCustom ? 'active' : ''}`}
              onClick={() => setChartCustom(!chartCustom)}
              style={{ height: 32, padding: '0 12px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}
            >Personalizar</button>
          </div>
        </div>
        {chartCustom && (
          <div className="kpi-filter-row" style={{ marginTop: 8, marginBottom: 8 }}>
            <label>
              <span>Desde</span>
              <input type="date" value={chartDateFrom} onChange={e => setChartDateFrom(e.target.value)} />
            </label>
            <label>
              <span>Hasta</span>
              <input type="date" value={chartDateTo} onChange={e => setChartDateTo(e.target.value)} />
            </label>
          </div>
        )}
        {trend.chartData.length > 0 ? (
          <div style={{ height: 280, marginTop: chartCustom ? 8 : 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8edf8" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={v => {
                    const d = new Date(v)
                    const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                    if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
                    if (chartGranularity === 'weekly') return `S${Math.ceil(d.getDate() / 7)} ${MONTHS[d.getMonth()]}`
                    return MONTHS[d.getMonth()]
                  }}
                />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip wrapperStyle={{ zIndex: 9999 }} labelFormatter={v => new Date(v).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })} formatter={(value, name) => [formatNumber(value), trend.sellers.find(s => s.id === name)?.name || name]} />
                {trend.sellers.map((seller, i) => (
                  <Line key={seller.id} type="monotone" dataKey={seller.id} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ height: 280, marginTop: chartCustom ? 8 : 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="kpi-empty-state">
              <div className="kpi-empty-title">Sin datos de evolución</div>
              <div className="kpi-empty-message">No hay datos de tendencia para esta métrica en {chartPeriodLabel}.</div>
            </div>
          </div>
        )}
        {trend.sellers.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, justifyContent: 'center' }}>
            {trend.sellers.map((seller, i) => (
              <div key={seller.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                <div style={{ width: 10, height: 3, borderRadius: 2, background: LINE_COLORS[i % LINE_COLORS.length] }} />
                {seller.name}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="kpi-grid-2col">
        <div className="kpi-card" style={{ padding: 24, position: 'relative' }}>
          {loadingMetrics && metricsData && (
            <div style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
              <div className="kpi-spinner" />
            </div>
          )}
          <h3 className="kpi-card-subtitle">Ranking — {currentMetricLabel}</h3>
          {topSellers.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {topSellers.map((seller, i) => (
                <div key={seller.id || i} onClick={() => onSellerClick(seller.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: i === 0 ? '#FFFBEB' : '#f8fafc',
                  border: i === 0 ? '1px solid #FDE68A' : '1px solid #e8edf8',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.background = '#FFFBEB' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = i === 0 ? '#FDE68A' : '#e8edf8'; e.currentTarget.style.background = i === 0 ? '#FFFBEB' : '#f8fafc' }}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: 7,
                    background: i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                  }}>#{seller.rank}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{seller.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8' }}>{seller.pct}%</span>
                    </div>
                    <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(seller.pct || 0, 100)}%`, height: '100%', background: i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8', borderRadius: 3, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{formatNumber(seller.value)} {currentMetricLabel.toLowerCase()}</div>
                  </div>
                  <Icons.ArrowRight size={13} style={{ color: '#94A3B8', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin vendedores activos</div></div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {alerts.length > 0 && (
            <div className="kpi-card" style={{ padding: 20, borderLeft: '3px solid #F59E0B' }}>
              <h3 className="kpi-card-subtitle" style={{ color: '#D97706' }}>Alertas del Departamento</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {alerts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <Icons.AlertCircle size={14} style={{ color: '#D97706', flexShrink: 0 }} />
                    <div style={{ fontSize: 12, color: '#92400E' }}>
                      <strong>{a.seller}</strong>{' — '}
                      {a.type === 'low_completion' ? `Tasa de completado baja (${a.value}%)` : `Tasa de cancelación alta (${a.value}%)`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="kpi-card" style={{ padding: 20 }}>
            <h3 className="kpi-card-subtitle">Estado del Equipo</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {[
                { label: 'Vendedores activos', val: s.active_sellers || 0, color: '#10B981' },
                { label: 'Vendedores inactivos', val: s.inactive_sellers || 0, color: (s.inactive_sellers || 0) > 0 ? '#EF4444' : '#94A3B8' },
                { label: 'Órdenes en producción', val: formatNumber(s.active_production || 0), color: '#06B6D4' },
                { label: 'Órdenes pendientes', val: formatNumber(s.pending_orders || 0), color: '#F59E0B' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < 3 ? '1px solid #f1f5f9' : 'none' }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>{item.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ────────────────── SELLER DETAIL VIEW ────────────────── */

export function SellerDetailView({ sellerId, getDateBounds, onBack, period, customDateFrom, customDateTo }) {
  const [detail, setDetail] = useState(null)
  const [profile, setProfile] = useState(null)
  const [trendData, setTrendData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')

  const getChartBounds = useCallback(() => {
    const now = new Date()
    let start, end

    if (chartCustom && chartDateFrom && chartDateTo) {
      return {
        date_from: new Date(chartDateFrom + 'T00:00:00').toISOString(),
        date_to: new Date(chartDateTo + 'T23:59:59').toISOString(),
      }
    }

    switch (chartPeriod) {
      case '7d':
        start = new Date(now)
        start.setDate(now.getDate() - 7)
        break
      case '3m':
        start = new Date(now)
        start.setMonth(now.getMonth() - 3)
        break
      case '6m':
        start = new Date(now)
        start.setMonth(now.getMonth() - 6)
        break
      default:
        start = new Date(now)
        start.setMonth(now.getMonth() - 1)
    }
    end = new Date(now.getTime() + 86400000)
    return { date_from: start.toISOString(), date_to: end.toISOString() }
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const fetchSellerData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const bounds = getDateBounds()
      const compare = {}
      if (bounds.date_from && bounds.date_to) {
        const from = new Date(bounds.date_from)
        const to = new Date(bounds.date_to)
        const duration = to.getTime() - from.getTime()
        compare.compare_from = new Date(from.getTime() - duration).toISOString()
        compare.compare_to = bounds.date_from
      }
      const [dRes, pRes] = await Promise.all([
        adminApiFetch('/api/kpi-data', { action: 'seller_detail', seller_id: sellerId, ...bounds, ...compare }),
        adminApiFetch('/api/kpi-data', { action: 'seller_profile', seller_id: sellerId, ...bounds }),
      ])
      if (dRes.response.ok) setDetail(dRes.result)
      if (pRes.response.ok) setProfile(pRes.result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [sellerId, getDateBounds])

  useEffect(() => { fetchSellerData() }, [fetchSellerData])

  useEffect(() => {
    const fetchChart = async () => {
      try {
        const bounds = getChartBounds()
        const res = await adminApiFetch('/api/kpi-data', { action: 'seller_daily_trend', metric: 'orders', ...bounds })
        if (res.response.ok) setTrendData(res.result)
      } catch { /* ignore */ }
    }
    fetchChart()
  }, [sellerId, getChartBounds])

  const orders = useMemo(() => detail?.orders || {}, [detail])
  const rates = useMemo(() => detail?.rates || {}, [detail])
  const cmp = detail?.comparison
  const freq = useMemo(() => profile?.order_frequency || {}, [profile])
  const topClients = useMemo(() => profile?.top_clients || [], [profile])
  const materials = useMemo(() => profile?.materials || [], [profile])
  const totalClientOrders = useMemo(() => topClients.reduce((s, c) => s + (c.total_orders || 0), 0), [topClients])

  const sellerTrend = useMemo(() => {
    if (!trendData?.trend) return []
    return trendData.trend
      .filter(t => t.seller_id === sellerId)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [trendData, sellerId])

  const CHART_PERIODS = [
    { key: '7d', label: '7d' },
    { key: '1m', label: '1m' },
    { key: '3m', label: '3m' },
    { key: '6m', label: '6m' },
  ]

  const chartGranularity = useMemo(() => {
    const bounds = getChartBounds()
    if (!bounds.date_from || !bounds.date_to) return 'daily'
    const totalDays = Math.round((new Date(bounds.date_to) - new Date(bounds.date_from)) / 86400000)
    if (totalDays <= 31) return 'daily'
    if (totalDays <= 120) return 'weekly'
    return 'monthly'
  }, [getChartBounds])

  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      const f = new Date(chartDateFrom + 'T00:00:00')
      const t = new Date(chartDateTo + 'T00:00:00')
      const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
      return `${f.getDate()} ${MONTHS[f.getMonth()]} – ${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`
    }
    const labels = { '7d': 'Últimos 7 días', '1m': 'Último mes', '3m': 'Últimos 3 meses', '6m': 'Últimos 6 meses' }
    return labels[chartPeriod] || 'Último mes'
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const orderBreakdown = useMemo(() => [
    { name: 'Normal', value: orders.normal || 0, color: '#06B6D4' },
    { name: '911', value: orders.urgent_911 || 0, color: '#F43F5E' },
  ].filter(d => d.value > 0), [orders])

  const designBreakdown = useMemo(() => [
    { name: 'Internas', value: orders.internal || 0, color: '#06B6D4' },
    { name: 'Externas', value: orders.external || 0, color: '#94A3B8' },
  ].filter(d => d.value > 0), [orders])

  const statusBreakdown = useMemo(() => [
    { name: 'Completadas', value: orders.completed || 0, color: '#10B981' },
    { name: 'Entregadas', value: orders.delivered || 0, color: '#22C55E' },
    { name: 'En Producción', value: orders.in_production || 0, color: '#06B6D4' },
    { name: 'Pendientes', value: orders.pending || 0, color: '#F59E0B' },
    { name: 'Canceladas', value: orders.cancelled || 0, color: '#EF4444' },
  ].filter(d => d.value > 0), [orders])

  const urgentPct = useMemo(() => (orders.total || 0) > 0 ? Math.round((orders.urgent_911 || 0) / orders.total * 1000) / 10 : 0, [orders])

  const alerts = useMemo(() => {
    const a = []
    if ((rates.cancellation_rate || 0) > 15) {
      a.push({ color: '#F43F5E', message: `Tasa de cancelación alta: ${rates.cancellation_rate}%` })
    }
    if (profile?.days_since_last_order !== null && (profile?.days_since_last_order || 0) > 7) {
      a.push({ color: '#F59E0B', message: `Sin órdenes en ${profile.days_since_last_order} días` })
    }
    if ((rates.completion_rate || 0) < 70 && (orders.total || 0) > 0) {
      a.push({ color: '#F59E0B', message: `Tasa de completado baja: ${rates.completion_rate}%` })
    }
    return a
  }, [rates, profile, orders])

  const departmentAvg = useMemo(() => {
    if (!trendData?.trend) return 0
    const byDate = {}
    trendData.trend.forEach(t => {
      if (!byDate[t.date]) byDate[t.date] = { total: 0, count: 0 }
      byDate[t.date].total += t.value
      byDate[t.date].count++
    })
    const vals = Object.values(byDate)
    if (vals.length === 0) return 0
    return Math.round(vals.reduce((s, v) => s + v.total, 0) / vals.length)
  }, [trendData])

  const periodLabel = useMemo(() => {
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
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
  }, [period, customDateFrom, customDateTo])

  const participation = useMemo(() => {
    if (!detail?.vs_department) return 0
    return Math.round((detail.vs_department.orders_vs_avg || 0) * 10) / 10
  }, [detail])

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!detail) return <EmptyState message="No hay datos para este vendedor." />

  return (
    <div className="kpi-seller-page">
      <div className="kpi-seller-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kpi-seller-avatar" style={{ background: '#F59E0B' }}>
            {(detail.name || 'V').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2>{detail.name || 'Vendedor'}</h2>
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
        <button className="kpi-seller-back-btn" onClick={onBack}>
          <Icons.ChevronLeft size={15} /> Volver al panel
        </button>
      </div>

      <div className="kpi-seller-page-body">
        {alerts.length > 0 && (
          <div className="kpi-seller-alerts">
            {alerts.map((alert, i) => (
              <div key={i} className="kpi-seller-alert-item" style={{ borderColor: alert.color }}>
                <Icons.AlertCircle size={14} style={{ color: alert.color }} />
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Hero Cards — 4 core metrics */}
        <div className="kpi-seller-hero-grid">
          <div className="kpi-seller-hero-card">
            <div className="kpi-seller-hero-header">
              <div className="kpi-seller-hero-label">Total Órdenes</div>
              <div className="kpi-seller-hero-icon" style={{ background: '#E0F2FE', color: '#06B6D4' }}><Icons.Orders size={16} /></div>
            </div>
            <div className="kpi-seller-hero-value">{formatNumber(orders.total || 0)}</div>
            <div className="kpi-seller-hero-footer">
              <div className="kpi-seller-hero-subtitle">del periodo seleccionado</div>
              {cmp && <div className="kpi-seller-hero-trend" style={{ background: cmp.orders_change_pct > 0 ? '#DCFCE7' : '#FEE2E2', color: cmp.orders_change_pct > 0 ? '#16A34A' : '#DC2626' }}>{cmp.orders_change_pct > 0 ? '↑' : '↓'} {Math.abs(cmp.orders_change_pct)}%</div>}
            </div>
          </div>
          <div className="kpi-seller-hero-card">
            <div className="kpi-seller-hero-header">
              <div className="kpi-seller-hero-label">Completadas</div>
              <div className="kpi-seller-hero-icon" style={{ background: '#DCFCE7', color: '#10B981' }}><Icons.CheckCircle size={16} /></div>
            </div>
            <div className="kpi-seller-hero-value">{rates.completion_rate || 0}%</div>
            <div className="kpi-seller-hero-footer">
              <div className="kpi-seller-hero-subtitle">tasa de finalización</div>
              {cmp && <div className="kpi-seller-hero-trend" style={{ background: cmp.completion_change_pct > 0 ? '#DCFCE7' : '#FEE2E2', color: cmp.completion_change_pct > 0 ? '#16A34A' : '#DC2626' }}>{cmp.completion_change_pct > 0 ? '↑' : '↓'} {Math.abs(cmp.completion_change_pct)}pp</div>}
            </div>
          </div>
          <div className="kpi-seller-hero-card">
            <div className="kpi-seller-hero-header">
              <div className="kpi-seller-hero-label">Cancelación</div>
              <div className="kpi-seller-hero-icon" style={{ background: '#FEE2E2', color: '#F43F5E' }}><Icons.X size={16} /></div>
            </div>
            <div className="kpi-seller-hero-value">{rates.cancellation_rate || 0}%</div>
            <div className="kpi-seller-hero-footer">
              <div className="kpi-seller-hero-subtitle">{(rates.cancellation_rate || 0) > 15 ? 'Requiere atención' : 'Dentro del rango'}</div>
              <div className="kpi-seller-hero-trend" style={{ background: (rates.cancellation_rate || 0) > 15 ? '#FEE2E2' : '#DCFCE7', color: (rates.cancellation_rate || 0) > 15 ? '#DC2626' : '#16A34A' }}>{(rates.cancellation_rate || 0) > 15 ? '⚠' : '✓'}</div>
            </div>
          </div>
          <div className="kpi-seller-hero-card">
            <div className="kpi-seller-hero-header">
              <div className="kpi-seller-hero-label">Tiempo Prom.</div>
              <div className="kpi-seller-hero-icon" style={{ background: '#FEF3C7', color: '#F59E0B' }}><Icons.Clock size={16} /></div>
            </div>
            <div className="kpi-seller-hero-value">{formatDays(rates.avg_cycle_days || 0)}</div>
            <div className="kpi-seller-hero-footer">
              <div className="kpi-seller-hero-subtitle">por orden completada</div>
              {cmp && <div className="kpi-seller-hero-trend" style={{ background: cmp.cycle_change_pct < 0 ? '#DCFCE7' : '#FEE2E2', color: cmp.cycle_change_pct < 0 ? '#16A34A' : '#DC2626' }}>{cmp.cycle_change_pct < 0 ? '↓' : '↑'} {Math.abs(cmp.cycle_change_pct)}%</div>}
            </div>
          </div>
        </div>

        {/* Evolution Chart — full width */}
        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Evolución de Productividad</h3>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{chartPeriodLabel}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
                {CHART_PERIODS.map(p => (
                  <button
                    key={p.key}
                    className={`kpi-pipeline-view-btn ${chartPeriod === p.key && !chartCustom ? 'active' : ''}`}
                    onClick={() => { setChartPeriod(p.key); setChartCustom(false) }}
                  >{p.label}</button>
                ))}
              </div>
              <button
                className={`kpi-pipeline-view-btn ${chartCustom ? 'active' : ''}`}
                onClick={() => setChartCustom(!chartCustom)}
                style={{ height: 32, padding: '0 12px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}
              >Personalizar</button>
            </div>
          </div>
          {chartCustom && (
            <div className="kpi-filter-row" style={{ marginTop: 8, marginBottom: 8 }}>
              <label>
                <span>Desde</span>
                <input type="date" value={chartDateFrom} onChange={e => setChartDateFrom(e.target.value)} />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" value={chartDateTo} onChange={e => setChartDateTo(e.target.value)} />
              </label>
            </div>
          )}
          {sellerTrend.length > 0 ? (
            <div style={{ height: 220, marginTop: chartCustom ? 8 : 16 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sellerTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8edf8" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={v => {
                      const d = new Date(v)
                      const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                      if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
                      if (chartGranularity === 'weekly') return `S${Math.ceil(d.getDate() / 7)} ${MONTHS[d.getMonth()]}`
                      return MONTHS[d.getMonth()]
                    }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <Tooltip wrapperStyle={{ zIndex: 9999 }} labelFormatter={v => new Date(v).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })} formatter={(value) => [formatNumber(value), 'Órdenes']} />
                  {departmentAvg > 0 && (
                    <ReferenceLine
                      y={departmentAvg}
                      stroke="#94A3B8"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{ value: `Prom. depto: ${departmentAvg}`, position: 'insideTopRight', fontSize: 11, fill: '#94A3B8' }}
                    />
                  )}
                  <Line type="monotone" dataKey="value" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ height: 220, marginTop: chartCustom ? 8 : 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="kpi-empty-state">
                <div className="kpi-empty-title">Sin datos de productividad para este período</div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{chartPeriodLabel}</div>
              </div>
            </div>
          )}
        </div>

        {/* Análisis de Órdenes — merged section */}
        <div className="kpi-seller-section-title">Análisis de Órdenes</div>

        <div className="kpi-seller-section-grid">
          {/* Tipo de Orden — pie */}
          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Tipo de Orden</h3>
            {orderBreakdown.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 16 }}>
                <div style={{ flex: '0 0 130px', height: 130 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={orderBreakdown} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                        {orderBreakdown.map((e, i) => <Cell key={i} fill={e.color} stroke="#fff" strokeWidth={2} />)}
                      </Pie>
                      <Tooltip wrapperStyle={{ zIndex: 9999 }} content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {orderBreakdown.map((item, i) => {
                    const pct = (orders.total || 0) > 0 ? Math.round((item.value / orders.total) * 1000) / 10 : 0
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e8edf8' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#091127' }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{formatNumber(item.value)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{pct}%</div>
                      </div>
                    )
                  })}
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Proporción 911: <strong style={{ color: '#F43F5E' }}>{urgentPct}%</strong></div>
                </div>
              </div>
            ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos</div></div>}
          </div>

          {/* Tipo de Diseño — pie */}
          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Tipo de Diseño</h3>
            {designBreakdown.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 16 }}>
                <div style={{ flex: '0 0 130px', height: 130 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={designBreakdown} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                        {designBreakdown.map((e, i) => <Cell key={i} fill={e.color} stroke="#fff" strokeWidth={2} />)}
                      </Pie>
                      <Tooltip wrapperStyle={{ zIndex: 9999 }} content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {designBreakdown.map((item, i) => {
                    const pct = (orders.total || 0) > 0 ? Math.round((item.value / orders.total) * 1000) / 10 : 0
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e8edf8' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#091127' }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{formatNumber(item.value)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{pct}%</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos</div></div>}
          </div>
        </div>

        {/* Desglose por Estado — full width */}
        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          <h3 className="kpi-card-subtitle">Desglose por Estado</h3>
          {statusBreakdown.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {statusBreakdown.map((item, i) => {
                const pct = (orders.total || 0) > 0 ? Math.round((item.value / orders.total) * 1000) / 10 : 0
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 120, fontSize: 13, fontWeight: 500, color: '#091127', flexShrink: 0 }}>{item.name}</div>
                    <div style={{ flex: 1, height: 8, background: '#e8edf8', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: item.color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ width: 50, fontSize: 13, fontWeight: 700, color: item.color, textAlign: 'right' }}>{formatNumber(item.value)}</div>
                    <div style={{ width: 45, fontSize: 11, color: '#94A3B8', textAlign: 'right' }}>{pct}%</div>
                  </div>
                )
              })}
            </div>
          ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos</div></div>}
        </div>

        {/* Frecuencia + Métricas — 2 columns */}
        <div className="kpi-seller-section-grid">
          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Frecuencia de Órdenes</h3>
            <div className="kpi-seller-freq-grid" style={{ marginTop: 16 }}>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#06B6D4' }}>{freq.per_day || 0}</div>
                <div className="kpi-seller-freq-label">Por día</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#10B981' }}>{freq.per_week || 0}</div>
                <div className="kpi-seller-freq-label">Por semana</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#F59E0B' }}>{freq.per_month || 0}</div>
                <div className="kpi-seller-freq-label">Por mes</div>
              </div>
            </div>
          </div>

          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Actividad Reciente</h3>
            <div className="kpi-seller-freq-grid" style={{ marginTop: 16 }}>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: (profile?.days_since_last_order || 0) > 7 ? '#EF4444' : '#10B981' }}>
                  {profile?.days_since_last_order ?? '—'}
                </div>
                <div className="kpi-seller-freq-label">Días sin órdenes</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#06B6D4' }}>
                  {profile?.clients_registered ?? 0}
                </div>
                <div className="kpi-seller-freq-label">Clientes registrados</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: (profile?.pending_payment_pct || 0) > 20 ? '#F59E0B' : '#10B981' }}>
                  {profile?.pending_payment_pct ?? 0}%
                </div>
                <div className="kpi-seller-freq-label">Pago pendiente</div>
              </div>
            </div>
          </div>
        </div>

        {/* Relación Comercial — renamed section */}
        <div className="kpi-seller-section-title">Relación Comercial</div>
        <p className="kpi-seller-section-subtitle">Análisis de la relación del vendedor con sus clientes y materiales predominantes.</p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div className="kpi-seller-stat-pill">
            <Icons.Users size={14} />
            <span>{profile?.clients_registered ?? 0} clientes nuevos registrados en este período</span>
          </div>
          <div className="kpi-seller-stat-pill">
            <Icons.Clock size={14} />
            <span>Última orden: {profile?.days_since_last_order === 0 ? 'Hoy' : profile?.days_since_last_order != null ? `hace ${profile.days_since_last_order} días` : '—'}</span>
          </div>
        </div>

        <div className="kpi-seller-section-grid">
          {/* Clientes Más Frecuentes */}
          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Clientes Más Frecuentes</h3>
            {topClients.length > 0 ? (
              <div className="kpi-seller-list" style={{ marginTop: 16 }}>
                {topClients.slice(0, 6).map((client, i) => {
                  const clientPct = totalClientOrders > 0 ? Math.round(client.total_orders / totalClientOrders * 1000) / 10 : 0
                  return (
                    <div key={i} className="kpi-seller-list-item">
                      <div className="kpi-seller-list-rank" style={{
                        background: i < 3 ? (i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8') : undefined,
                        color: i < 3 ? '#fff' : undefined,
                      }}>#{i + 1}</div>
                      <div className="kpi-seller-list-info">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span className="kpi-seller-list-name">{client.client_name}</span>
                          <span className="kpi-seller-list-value" style={{ color: i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8' }}>{clientPct}%</span>
                        </div>
                        <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(clientPct, 100)}%`, height: '100%', background: i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8', borderRadius: 3, transition: 'width 0.6s ease' }} />
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

          {/* Materiales Más Utilizados */}
          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Materiales Más Utilizados</h3>
            {materials.length > 0 ? (
              <div className="kpi-seller-list" style={{ marginTop: 16 }}>
                {materials.slice(0, 6).map((mat, i) => (
                  <div key={i} className="kpi-seller-list-item">
                    <div className="kpi-seller-list-rank" style={{
                      background: i < 3 ? (i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8') : undefined,
                      color: i < 3 ? '#fff' : undefined,
                    }}>#{i + 1}</div>
                    <div className="kpi-seller-list-info">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span className="kpi-seller-list-name">{mat.name}</span>
                        <span className="kpi-seller-list-value" style={{ color: i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8' }}>{mat.pct}%</span>
                      </div>
                      <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(mat.pct || 0, 100)}%`, height: '100%', background: i < SELLER_COLORS.length ? SELLER_COLORS[i] : '#94A3B8', borderRadius: 3, transition: 'width 0.6s ease' }} />
                      </div>
                      <div className="kpi-seller-list-sub" style={{ marginTop: 4 }}>{mat.count} órdenes</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin materiales registrados en órdenes</div></div>}
          </div>
        </div>

        {/* Comparación con Período Anterior — at the bottom */}
        {cmp && (
          <>
            <div className="kpi-seller-section-title">Comparación con Período Anterior</div>
            <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
              {[
                { label: 'Órdenes', prev: cmp.prev_orders, curr: orders.total, change: cmp.orders_change_pct },
                { label: 'Completado', prev: `${cmp.prev_completion_rate}%`, curr: `${rates.completion_rate}%`, change: cmp.completion_change_pct },
                { label: 'Cancelación', prev: `${cmp.prev_cancellation_rate || 0}%`, curr: `${rates.cancellation_rate || 0}%`, change: cmp.cancellation_change_pct || 0, inverse: true },
                { label: 'Pago Pendiente', prev: `${cmp.prev_pending_payment_pct || 0}%`, curr: `${profile?.pending_payment_pct || 0}%`, change: cmp.pending_payment_change_pct || 0, inverse: true },
                { label: 'Tiempo Prom.', prev: formatDays(cmp.prev_avg_cycle_days), curr: formatDays(rates.avg_cycle_days), change: cmp.cycle_change_pct, inverse: true },
              ].map((item, i) => (
                <div key={i} className="kpi-seller-comparison-card">
                  <div className="kpi-seller-comparison-label">{item.label}</div>
                  <div className="kpi-seller-comparison-value">{item.curr}</div>
                  <div className="kpi-seller-comparison-delta" style={{ color: (item.inverse ? (item.change < 0) : (item.change > 0)) ? '#10B981' : '#EF4444' }}>
                    {item.prev} {item.change > 0 ? '+' : ''}{item.change}%
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ────────────────── MAIN COMPONENT ────────────────── */

export default function KPISellerIntelligence({ period, customDateFrom, customDateTo, onSellerClick }) {
  const [overviewData, setOverviewData] = useState(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [error, setError] = useState(null)

  const getDateBounds = useCallback(() => {
    if (period === 'custom' && customDateFrom && customDateTo) {
      return { date_from: customDateFrom, date_to: customDateTo }
    }
    const now = new Date()
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
      case 'year':
        start = new Date(now.getFullYear(), 0, 1)
        end = new Date(now.getFullYear() + 1, 0, 1)
        break
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    }
    return { date_from: start.toISOString(), date_to: end.toISOString() }
  }, [period, customDateFrom, customDateTo])

  const getCompareBounds = useCallback(() => {
    const bounds = getDateBounds()
    if (!bounds.date_from || !bounds.date_to) return {}
    const from = new Date(bounds.date_from)
    const to = new Date(bounds.date_to)
    return { compare_from: new Date(from.getTime() - (to.getTime() - from.getTime())).toISOString(), compare_to: bounds.date_from }
  }, [getDateBounds])

  const fetchOverview = useCallback(async () => {
    setLoadingOverview(true)
    setError(null)
    try {
      const bounds = getDateBounds()
      const compare = getCompareBounds()
      const result = await adminApiFetch('/api/kpi-data', { action: 'sales_overview', ...bounds, ...compare })
      if (!result.response.ok) throw new Error(result.result?.error || 'Error fetching overview')
      setOverviewData(result.result)
    } catch (err) { setError(err.message) } finally { setLoadingOverview(false) }
  }, [getDateBounds, getCompareBounds])

  useEffect(() => { fetchOverview() }, [fetchOverview])

  return (
    <div>
      <div className="kpi-section-header" style={{ marginBottom: 16 }}>
        <div>
          <span className="kpi-section-kicker">Inteligencia Comercial</span>
          <h2 className="kpi-section-title">Centro de Inteligencia Comercial</h2>
          <p className="kpi-section-subtitle">Vista completa del departamento de ventas</p>
        </div>
      </div>

      {error && !overviewData ? (
        <ErrorState error={error} />
      ) : (
        <GlobalView overviewData={overviewData} loadingOverview={loadingOverview} getDateBounds={getDateBounds} onSellerClick={onSellerClick} />
      )}
    </div>
  )
}
