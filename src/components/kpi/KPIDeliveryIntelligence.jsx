import { useState, useEffect, useCallback, useMemo } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays } from '../../utils/kpiHelpers'
import { adminApiFetch } from '../../utils/adminApi'

const DELIVERY_COLOR = '#0EA5E9'
const PAYMENT_COLORS = { pagado: '#10B981', parcial: '#F59E0B', credito: '#8B5CF6', Pending_Payment: '#94A3B8' }
const GLOBAL_METRICS = [
  { key: 'delivered', label: 'Entregadas' },
  { key: 'on_time', label: 'A Tiempo' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'avg_time', label: 'Tiempo Promedio' },
]
const CHART_PERIODS = [
  { key: '7d', label: '7d' },
  { key: '1m', label: '1m' },
  { key: '3m', label: '3m' },
  { key: '6m', label: '6m' },
]
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

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

function getMetricValue(user, metric) {
  if (metric === 'on_time') return user.on_time_rate || 0
  if (metric === 'pending') return user.pending_deliveries || 0
  if (metric === 'avg_time') return user.avg_delivery_time_days || 0
  return user.total_delivered || 0
}

function ChangeBadge({ value, inverse = false }) {
  if (value === undefined || value === null) return null
  const num = Number(value)
  if (num === 0) return <span className="kpi-seller-comparison-delta" style={{ color: '#94A3B8' }}>Sin cambio</span>
  const good = inverse ? num < 0 : num > 0
  return (
    <span className="kpi-seller-comparison-delta" style={{ color: good ? '#10B981' : '#EF4444' }}>
      {num > 0 ? '+' : ''}{num.toFixed(1)}%
    </span>
  )
}

function PieTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  const pct = total > 0 ? ((payload[0].value / total) * 100).toFixed(1) : 0
  return (
    <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 12px rgba(15,30,64,0.08)' }}>
      <div style={{ fontWeight: 700, color: item.color || '#091127' }}>{payload[0].name}</div>
      <div style={{ color: '#64748b', marginTop: 4 }}>{formatNumber(payload[0].value)} ({pct}%)</div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="kpi-card" style={{ padding: 40, textAlign: 'center' }}>
      <div className="kpi-spinner" />
      <div style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Cargando datos de entrega...</div>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="kpi-card" style={{ padding: 40, textAlign: 'center' }}>
      <Icons.AlertCircle size={32} color="#EF4444" />
      <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: '#EF4444' }}>{message}</div>
    </div>
  )
}

function HeroCard({ label, value, color, icon: Icon, subtitle }) {
  return (
    <div className="kpi-seller-hero-card">
      <div className="kpi-seller-hero-header">
        <div className="kpi-seller-hero-label">{label}</div>
        {Icon && <div className="kpi-seller-hero-icon" style={{ background: `${color}18`, color }}><Icon size={18} /></div>}
      </div>
      <div className="kpi-seller-hero-value" style={{ color }}>{value}</div>
      {subtitle && <div className="kpi-seller-hero-footer"><span className="kpi-seller-hero-subtitle">{subtitle}</span></div>}
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
        <div className="kpi-filter-row" style={{ marginTop: 12 }}>
          <label><span>Desde</span><input type="date" value={chartDateFrom} onChange={e => setChartDateFrom(e.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={chartDateTo} onChange={e => setChartDateTo(e.target.value)} /></label>
        </div>
      )}
    </>
  )
}

function ComparisonCard({ label, value, prev, change, color = '#091127', inverse = false }) {
  return (
    <div className="kpi-seller-comparison-card">
      <div className="kpi-seller-comparison-value" style={{ color }}>{value}</div>
      <div className="kpi-seller-comparison-label">{label}</div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>Anterior: {prev}</div>
      <ChangeBadge value={change} inverse={inverse} />
    </div>
  )
}

function GlobalView({ getDateBounds, onUserClick }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedMetric, setSelectedMetric] = useState('delivered')
  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      const bounds = getDateBounds()
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'delivery_metrics', ...bounds, ...getCompareBounds(bounds) })
        if (res.response.ok && !cancelled) setData(res.result)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [getDateBounds])

  const chartBounds = useMemo(() => getChartBounds(chartPeriod, chartCustom, chartDateFrom, chartDateTo), [chartPeriod, chartCustom, chartDateFrom, chartDateTo])
  const chartGranularity = useMemo(() => {
    const diff = (new Date(chartBounds.date_to) - new Date(chartBounds.date_from)) / 86400000
    if (diff <= 31) return 'daily'
    if (diff <= 120) return 'weekly'
    return 'monthly'
  }, [chartBounds])
  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) return `${new Date(chartDateFrom).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })} - ${new Date(chartDateTo).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })}`
    return { '7d': 'Ultimos 7 dias', '1m': 'Ultimo mes', '3m': 'Ultimos 3 meses', '6m': 'Ultimos 6 meses' }[chartPeriod] || ''
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const sortedUsers = useMemo(() => {
    if (!data?.users) return []
    const sorted = [...data.users]
    if (selectedMetric === 'avg_time') sorted.sort((a, b) => (a.avg_delivery_time_days || 999) - (b.avg_delivery_time_days || 999))
    else if (selectedMetric === 'on_time') sorted.sort((a, b) => (b.on_time_rate || 0) - (a.on_time_rate || 0))
    else sorted.sort((a, b) => getMetricValue(b, selectedMetric) - getMetricValue(a, selectedMetric))
    const maxVal = sorted.length > 0 ? Math.max(getMetricValue(sorted[0], selectedMetric), 1) : 1
    return sorted.map((user, index) => ({ ...user, rank: index + 1, pct: +((getMetricValue(user, selectedMetric) / maxVal) * 100).toFixed(1) }))
  }, [data, selectedMetric])

  if (loading) return <LoadingState />
  if (!data) return <ErrorState message="No hay datos de entrega disponibles." />

  const { users = [], trend = [], total_delivered = 0, total_pending = 0, comparison } = data
  const trendDates = [...new Set(trend.map(t => t.date))].sort()
  const currentMetricLabel = GLOBAL_METRICS.find(m => m.key === selectedMetric)?.label || 'Entregadas'
  const formatXAxis = (date) => {
    const d = new Date(date + 'T12:00:00')
    if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
    if (chartGranularity === 'weekly') return `${d.getDate()} ${d.toLocaleDateString('es-DO', { month: 'short' })}`
    return d.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' })
  }

  return (
    <>
      <div className="kpi-hero-grid kpi-hero-grid--4" style={{ marginBottom: 24 }}>
        <HeroCard label="Entregadas" value={formatNumber(total_delivered)} color="#10B981" icon={Icons.CheckCircle} subtitle="Ordenes cerradas" />
        <HeroCard label="Equipo" value={formatNumber(users.length)} color={DELIVERY_COLOR} icon={Icons.Users} subtitle="Repartidores activos" />
        <HeroCard label="Pendientes" value={formatNumber(total_pending)} color="#F59E0B" icon={Icons.Clock} subtitle="Por entregar" />
        <HeroCard label="Mejor A Tiempo" value={`${users.length > 0 ? Math.max(...users.map(u => u.on_time_rate || 0)).toFixed(1) : 0}%`} color="#10B981" icon={Icons.TrendUp} subtitle="Mayor puntualidad" />
      </div>

      <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Evolucion de Entregas</h3>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{chartPeriodLabel}</div>
          </div>
          <ChartControls chartPeriod={chartPeriod} chartCustom={chartCustom} chartDateFrom={chartDateFrom} chartDateTo={chartDateTo} setChartPeriod={setChartPeriod} setChartCustom={setChartCustom} setChartDateFrom={setChartDateFrom} setChartDateTo={setChartDateTo} />
        </div>
        {trendDates.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendDates.map(date => {
              const item = trend.find(t => t.date === date) || {}
              return { date, Entregadas: item.delivered || 0, Pendientes: item.pending || 0 }
            })}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <Tooltip />
              <Line type="monotone" dataKey="Entregadas" stroke="#10B981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Pendientes" stroke="#F59E0B" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="kpi-empty-state" style={{ height: 260 }}><div className="kpi-empty-title">Sin datos de tendencia</div></div>}
      </div>

      <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="kpi-seller-section-title" style={{ marginBottom: 0 }}>Ranking - {currentMetricLabel}</div>
          <label style={{ minWidth: 180 }}>
            <select className="kpi-select" value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
              {GLOBAL_METRICS.map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
            </select>
          </label>
        </div>
        {sortedUsers.length > 0 ? (
          <div className="kpi-seller-list">
            {sortedUsers.slice(0, 10).map(user => (
              <button key={user.id} className="kpi-seller-list-item" onClick={() => onUserClick(user.id)} style={{ textAlign: 'left', cursor: 'pointer' }}>
                <span className="kpi-seller-list-rank" style={{ background: DELIVERY_COLOR, color: '#fff', borderColor: DELIVERY_COLOR }}>{user.rank}</span>
                <span className="kpi-seller-list-info">
                  <span className="kpi-seller-list-name">{user.name}</span>
                  <span className="kpi-seller-list-sub">{user.total_delivered} entregadas - {user.on_time_rate}% a tiempo - {user.pending_deliveries} pendientes</span>
                  <span style={{ display: 'block', height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
                    <span style={{ display: 'block', width: `${Math.min(user.pct || 0, 100)}%`, height: '100%', background: DELIVERY_COLOR }} />
                  </span>
                </span>
                <span className="kpi-seller-list-value" style={{ color: DELIVERY_COLOR }}>
                  {selectedMetric === 'avg_time' ? formatDays(getMetricValue(user, selectedMetric)) : formatNumber(getMetricValue(user, selectedMetric))}
                </span>
                <Icons.ArrowRight size={13} style={{ color: '#94A3B8', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        ) : <div className="kpi-empty-state"><div className="kpi-empty-title">Sin datos de entrega</div></div>}
      </div>

      {comparison && (
        <>
          <div className="kpi-seller-section-title">Comparacion con Periodo Anterior</div>
          <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
            {comparison.total_delivered && <ComparisonCard label="Entregas" value={comparison.total_delivered.curr} prev={comparison.total_delivered.prev} change={comparison.total_delivered.change_pct} color="#10B981" />}
          </div>
        </>
      )}
    </>
  )
}

export function DeliveryDetailView({ deliveryUserId, onBack, period, customDateFrom, customDateTo }) {
  const [detail, setDetail] = useState(null)
  const [profile, setProfile] = useState(null)
  const [trendData, setTrendData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')

  const periodBounds = useMemo(() => getDateBoundsForPeriod(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo])
  const chartBounds = useMemo(() => getChartBounds(chartPeriod, chartCustom, chartDateFrom, chartDateTo), [chartPeriod, chartCustom, chartDateFrom, chartDateTo])
  const chartGranularity = useMemo(() => {
    const diff = (new Date(chartBounds.date_to) - new Date(chartBounds.date_from)) / 86400000
    if (diff <= 31) return 'daily'
    if (diff <= 120) return 'weekly'
    return 'monthly'
  }, [chartBounds])
  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) return `${new Date(chartDateFrom).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })} - ${new Date(chartDateTo).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })}`
    return { '7d': 'Ultimos 7 dias', '1m': 'Ultimo mes', '3m': 'Ultimos 3 meses', '6m': 'Ultimos 6 meses' }[chartPeriod] || ''
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [detailRes, profileRes] = await Promise.all([
          adminApiFetch('/api/kpi-data', { action: 'delivery_detail', delivery_user_id: deliveryUserId, ...periodBounds, ...getCompareBounds(periodBounds) }),
          adminApiFetch('/api/kpi-data', { action: 'delivery_profile', delivery_user_id: deliveryUserId, ...periodBounds }),
        ])
        if (!cancelled) {
          if (detailRes.response.ok) setDetail(detailRes.result)
          else setError(detailRes.result?.error || 'Error al cargar entrega')
          if (profileRes.response.ok) setProfile(profileRes.result)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [deliveryUserId, periodBounds])

  useEffect(() => {
    let cancelled = false
    async function fetchChart() {
      try {
        const res = await adminApiFetch('/api/kpi-data', { action: 'delivery_daily_trend', delivery_user_id: deliveryUserId, ...chartBounds })
        if (res.response.ok && !cancelled) setTrendData(res.result)
      } catch { /* ignore */ }
    }
    fetchChart()
    return () => { cancelled = true }
  }, [deliveryUserId, chartBounds])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!detail) return <ErrorState message="No hay datos para este empleado." />

  const { profile: empProfile, orders: ord, rates, payment, comparison: cmp } = detail
  const initials = (empProfile?.name || 'D').split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase()
  const participation = Math.round((detail?.vs_team?.orders_vs_avg || 0) * 10) / 10
  const periodLabel = getPeriodLabel(period, customDateFrom, customDateTo)
  const paymentData = [
    { name: 'Pagado', value: payment?.paid || 0, color: PAYMENT_COLORS.pagado },
    { name: 'Parcial', value: payment?.partial || 0, color: PAYMENT_COLORS.parcial },
    { name: 'Credito', value: payment?.credit || 0, color: PAYMENT_COLORS.credito },
    { name: 'Pendiente', value: payment?.pending || 0, color: PAYMENT_COLORS.Pending_Payment },
  ].filter(item => item.value > 0)
  const statusBreakdown = [
    { name: 'Entregadas', value: ord?.delivered || 0, color: '#10B981' },
    { name: 'Pendientes', value: ord?.pending || 0, color: '#F59E0B' },
    { name: 'A Tiempo', value: ord?.on_time || 0, color: DELIVERY_COLOR },
  ].filter(item => item.value > 0)
  const topClients = profile?.top_clients || []
  const materials = profile?.materials || []
  const alerts = []
  if (rates?.on_time_rate < 80 && (ord?.delivered || 0) > 0) alerts.push({ color: '#EF4444', message: `Tasa de entrega a tiempo baja: ${rates.on_time_rate}%` })
  if ((ord?.pending || 0) > 5) alerts.push({ color: '#F59E0B', message: `${ord.pending} ordenes pendientes de entrega` })
  if (profile?.days_since_last_order !== null && profile?.days_since_last_order > 7) alerts.push({ color: '#EF4444', message: `Sin actividad de entrega hace ${profile.days_since_last_order} dias` })
  const formatXAxis = (date) => {
    const d = new Date(date + 'T12:00:00')
    if (chartGranularity === 'daily') return `${d.getDate()}/${d.getMonth() + 1}`
    if (chartGranularity === 'weekly') return `${d.getDate()} ${MONTHS[d.getMonth()]}`
    return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
  }

  return (
    <div className="kpi-seller-page">
      <div className="kpi-seller-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kpi-seller-avatar" style={{ background: DELIVERY_COLOR }}>{initials}</div>
          <div>
            <h2>{empProfile?.name || 'Empleado de Entrega'}</h2>
            <div className="kpi-seller-header-meta">
              <span className="kpi-seller-period-badge">Periodo: {periodLabel}</span>
              {participation !== 0 && <span className="kpi-seller-participation-badge">{participation > 0 ? '+' : ''}{participation}% vs promedio</span>}
            </div>
          </div>
        </div>
        <button className="kpi-seller-back-btn" onClick={onBack}><Icons.ChevronLeft size={15} /> Volver al panel</button>
      </div>

      <div className="kpi-seller-page-body">
        <div className="kpi-card" style={{ marginBottom: 24 }}>
          <div className="kpi-seller-section-title">Resumen Ejecutivo</div>
          <p className="kpi-section-subtitle" style={{ margin: 0 }}>
            {empProfile?.name || 'El empleado'} gestiono {formatNumber(ord?.total || 0)} orden{ord?.total !== 1 ? 'es' : ''} durante {periodLabel}, con {formatNumber(ord?.delivered || 0)} entregada{ord?.delivered !== 1 ? 's' : ''}, {rates?.on_time_rate || 0}% a tiempo y {formatDays(rates?.avg_delivery_time_days || 0)} promedio.
          </p>
        </div>

        <div className="kpi-seller-hero-grid">
          <HeroCard label="Entregadas" value={formatNumber(ord?.delivered || 0)} color="#10B981" icon={Icons.CheckCircle} subtitle="Ordenes cerradas" />
          <HeroCard label="A Tiempo" value={`${rates?.on_time_rate || 0}%`} color={DELIVERY_COLOR} icon={Icons.TrendUp} subtitle="Puntualidad" />
          <HeroCard label="Tiempo Prom." value={formatDays(rates?.avg_delivery_time_days || 0)} color="#8B5CF6" icon={Icons.Clock} subtitle="Despacho promedio" />
          <HeroCard label="Pendientes" value={formatNumber(ord?.pending || 0)} color="#F59E0B" icon={Icons.Package} subtitle="Carga abierta" />
        </div>

        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="kpi-seller-section-title" style={{ marginBottom: 0 }}>Evolucion Personal</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{chartPeriodLabel}</div>
            </div>
            <ChartControls chartPeriod={chartPeriod} chartCustom={chartCustom} chartDateFrom={chartDateFrom} chartDateTo={chartDateTo} setChartPeriod={setChartPeriod} setChartCustom={setChartCustom} setChartDateFrom={setChartDateFrom} setChartDateTo={setChartDateTo} />
          </div>
          {trendData?.trend?.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData.trend.map(item => ({ date: item.date, Entregadas: item.delivered || 0, Pendientes: item.pending || 0 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <Tooltip />
                <Line type="monotone" dataKey="Entregadas" stroke="#10B981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Pendientes" stroke="#F59E0B" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="kpi-empty-state" style={{ height: 260 }}><div className="kpi-empty-title">Sin datos de tendencia</div></div>}
        </div>

        <div className="kpi-grid-2col">
          <DistributionCard title="Estado de Ordenes" data={statusBreakdown} total={ord?.total || 0} />
          <DistributionCard title="Distribucion de Pago" data={paymentData} total={ord?.total || 0} />
        </div>

        <div className="kpi-grid-2col" style={{ marginTop: 16 }}>
          {topClients.length > 0 && <SimpleRanking title="Top Clientes" items={topClients.slice(0, 6).map(item => ({ name: item.client_name, value: `${item.total_orders} ordenes` }))} />}
          {materials.length > 0 && <SimpleRanking title="Materiales" items={materials.slice(0, 6).map(item => ({ name: item.name, value: `${item.pct}%` }))} />}
        </div>

        {alerts.length > 0 && (
          <div className="kpi-card" style={{ padding: 20, marginTop: 16 }}>
            <div className="kpi-seller-section-title">Alertas</div>
            <div className="kpi-seller-alerts" style={{ marginBottom: 0 }}>
              {alerts.map((alert, index) => (
                <div key={index} className="kpi-seller-alert-item" style={{ borderColor: alert.color, color: alert.color }}>
                  <Icons.AlertCircle size={14} />
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cmp && (
          <>
            <div className="kpi-seller-section-title" style={{ marginTop: 24 }}>Comparacion con Periodo Anterior</div>
            <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
              {cmp.total && <ComparisonCard label="Ordenes" value={cmp.total.curr} prev={cmp.total.prev} change={cmp.total.change_pct} />}
              {cmp.delivered && <ComparisonCard label="Entregadas" value={cmp.delivered.curr} prev={cmp.delivered.prev} change={cmp.delivered.change_pct} color="#10B981" />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DistributionCard({ title, data, total }) {
  return (
    <div className="kpi-card" style={{ padding: 24 }}>
      <div className="kpi-seller-section-title">{title}</div>
      <div style={{ height: 210 }}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">
                {data.map((entry, idx) => <Cell key={idx} fill={entry.color} stroke="#fff" strokeWidth={2} />)}
              </Pie>
              <Tooltip content={<PieTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
        ) : <div className="kpi-empty-state"><div className="kpi-empty-title">Sin datos</div></div>}
      </div>
      <div className="kpi-seller-list" style={{ maxHeight: 180, marginTop: 12 }}>
        {data.map((item, index) => (
          <div key={index} className="kpi-seller-list-item">
            <span className="kpi-seller-list-rank" style={{ background: item.color, color: '#fff', borderColor: item.color }} />
            <span className="kpi-seller-list-name">{item.name}</span>
            <span className="kpi-seller-list-value">{formatNumber(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SimpleRanking({ title, items }) {
  return (
    <div className="kpi-card" style={{ padding: 20 }}>
      <div className="kpi-seller-section-title">{title}</div>
      <div className="kpi-seller-list" style={{ maxHeight: 260 }}>
        {items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="kpi-seller-list-item">
            <span className="kpi-seller-list-rank">{index + 1}</span>
            <span className="kpi-seller-list-name">{item.name}</span>
            <span className="kpi-seller-list-value" style={{ color: DELIVERY_COLOR }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function KPIDeliveryIntelligence({ period, customDateFrom, customDateTo, onDeliveryUserClick }) {
  const [userId, setUserId] = useState(null)
  const getDateBounds = useCallback(() => getDateBoundsForPeriod(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo])

  const handleUserClick = useCallback((id) => {
    if (onDeliveryUserClick) onDeliveryUserClick(id)
    else setUserId(id)
  }, [onDeliveryUserClick])

  if (userId) {
    return <DeliveryDetailView deliveryUserId={userId} onBack={() => setUserId(null)} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
  }

  return <GlobalView getDateBounds={getDateBounds} onUserClick={handleUserClick} />
}
