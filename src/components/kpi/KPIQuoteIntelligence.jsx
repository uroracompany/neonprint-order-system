import { useState, useEffect, useMemo, useCallback } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, CartesianGrid, XAxis, YAxis, ReferenceLine } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays } from '../../utils/kpiHelpers'
import { adminApiFetch } from '../../utils/adminApi'
import QuoteActivityTimeline from './QuoteActivityTimeline'

const QUOTE_COLORS = ['#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD', '#E0F2FE', '#0284C7', '#0369A1', '#075985', '#0C4A6E', '#082F49']
const LINE_COLORS = ['#0EA5E9', '#06B6D4', '#10B981', '#F43F5E', '#F59E0B', '#F97316', '#EC4899', '#14B8A6', '#6366F1', '#84CC16']

const CHART_PERIODS = [
  { key: '7d', label: '7d' },
  { key: '1m', label: '1m' },
  { key: '3m', label: '3m' },
  { key: '6m', label: '6m' },
]

const QUOTE_DETAIL_METRICS = [
  { key: 'orders', label: 'Órdenes' },
  { key: 'completed', label: 'Completadas' },
  { key: 'converted', label: 'Conversión %' },
  { key: 'avg_time', label: 'Tiempo Prom.' },
]

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function PieTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : 0
  return (
    <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
      <p style={{ margin: 0, fontWeight: 600, color: d.fill || d.color || '#333' }}>{d.name}</p>
      <p style={{ margin: '4px 0 0', color: '#64748b' }}>{formatNumber(d.value)} ({pct}%)</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="kpi-seller-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="kpi-spinner" />
          <p style={{ color: '#4A5E80', fontSize: 14, fontWeight: 500, marginTop: 12 }}>Cargando datos del cotizador...</p>
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

export function QuoteDetailView({ quoteId, onBack, period, customDateFrom, customDateTo }) {
  const [detail, setDetail] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedMetric, setSelectedMetric] = useState('orders')
  const [chartPeriod, setChartPeriod] = useState('1m')
  const [chartCustom, setChartCustom] = useState(false)
  const [chartDateFrom, setChartDateFrom] = useState('')
  const [chartDateTo, setChartDateTo] = useState('')
  const [trendData, setTrendData] = useState(null)
  const [loadingTrend, setLoadingTrend] = useState(false)
  const [chartError, setChartError] = useState(null)
  const [profileError, setProfileError] = useState(null)

  const getPeriodBounds = useCallback(() => {
    if (period === 'custom' && customDateFrom && customDateTo) {
      return { date_from: customDateFrom, date_to: customDateTo }
    }
    const now = new Date()
    let start, end
    switch (period) {
      case 'today': {
        start = new Date(now)
        start.setHours(0, 0, 0, 0)
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
        break
      }
      case 'week': {
        start = new Date(now)
        start.setDate(now.getDate() - now.getDay())
        start.setHours(0, 0, 0, 0)
        end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
        break
      }
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

  const getChartBounds = useCallback(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      return { date_from: new Date(chartDateFrom).toISOString(), date_to: new Date(chartDateTo + 'T23:59:59').toISOString() }
    }
    const now = new Date()
    let start
    switch (chartPeriod) {
      case '7d': start = new Date(now.getTime() - 7 * 86400000); break
      case '3m': start = new Date(now.getTime() - 90 * 86400000); break
      case '6m': start = new Date(now.getTime() - 180 * 86400000); break
      default: start = new Date(now.getTime() - 30 * 86400000)
    }
    return { date_from: start.toISOString(), date_to: now.toISOString() }
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  const chartPeriodLabel = useMemo(() => {
    if (chartCustom && chartDateFrom && chartDateTo) {
      const f = new Date(chartDateFrom)
      const t = new Date(chartDateTo)
      return `${f.getDate()} ${MONTHS[f.getMonth()]} – ${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`
    }
    return CHART_PERIODS.find(p => p.key === chartPeriod)?.label || chartPeriod
  }, [chartPeriod, chartCustom, chartDateFrom, chartDateTo])

  useEffect(() => {
    let cancelled = false
    async function fetchDetail() {
      setLoading(true)
      setError(null)
      try {
        const bounds = getPeriodBounds()
        const [detailRes, profileRes] = await Promise.all([
          adminApiFetch('/api/kpi-data', { action: 'quote_detail', quote_id: quoteId, ...bounds }),
          adminApiFetch('/api/kpi-data', { action: 'quote_profile', quote_id: quoteId, ...bounds }),
        ])
        if (cancelled) return
        if (detailRes.response.ok) setDetail(detailRes.result)
        else setError(detailRes.result?.error || 'Error al cargar datos')
        if (profileRes.response.ok) setProfile(profileRes.result)
        else setProfileError('No se pudieron cargar los datos del perfil.')
      } catch { if (!cancelled) setError('Error de conexión') }
      finally { if (!cancelled) setLoading(false) }
    }
    fetchDetail()
    return () => { cancelled = true }
  }, [quoteId, getPeriodBounds])

  useEffect(() => {
    let cancelled = false
    async function fetchChart() {
      setLoadingTrend(true)
      setChartError(null)
      try {
        const bounds = getChartBounds()
        const res = await adminApiFetch('/api/kpi-data', { action: 'quote_daily_trend', quote_id: quoteId, metric: selectedMetric, ...bounds })
        if (!cancelled) {
          if (res.response.ok) setTrendData(res.result)
          else setChartError('No se pudo cargar el gráfico de tendencia.')
        }
      } catch { if (!cancelled) setChartError('Error de conexión al cargar tendencia.') }
      finally { if (!cancelled) setLoadingTrend(false) }
    }
    fetchChart()
    return () => { cancelled = true }
  }, [quoteId, getChartBounds, selectedMetric])

  const formatXAxis = (date) => {
    const d = new Date(date)
    if (chartPeriod === '7d') return `${d.getDate()}/${d.getMonth() + 1}`
    return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
  }

  const participation = useMemo(() => {
    if (!detail?.vs_department) return 0
    return Math.round((detail.vs_department.orders_vs_avg || 0) * 10) / 10
  }, [detail])

  const quoteMetricLabel = useMemo(() => QUOTE_DETAIL_METRICS.find(m => m.key === selectedMetric)?.label || 'Órdenes', [selectedMetric])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!detail) return <ErrorState message="No hay datos para este cotizador." />

  const { quote, orders: ord, payment: pay, rates, comparison: cmp } = detail
  const initials = (quote?.name || 'C').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const trend = trendData?.trend || []
  const quoteTrend = trend.filter(t => t.quote_id === quoteId)
  const quoteDates = [...new Set(quoteTrend.map(t => t.date))].sort()
  const avgByDate = quoteDates.map(date => {
    const dayValues = trend.filter(t => t.date === date).map(t => t.value)
    return dayValues.reduce((s, v) => s + v, 0) / dayValues.length
  })
  const departmentAvg = avgByDate.length > 0 ? avgByDate.reduce((s, v) => s + v, 0) / avgByDate.length : 0

  const alerts = []
  if ((pay?.pending || 0) > 5) alerts.push({ color: '#EF4444', message: `${pay.pending} órdenes con pago pendiente` })
  if ((pay?.partial || 0) > 3) alerts.push({ color: '#F59E0B', message: `${pay.partial} órdenes con pago parcial por cobrar` })
  if ((pay?.credit || 0) > 3) alerts.push({ color: '#8B5CF6', message: `${pay.credit} órdenes a crédito activas` })
  if (rates.avg_quote_days > 3) alerts.push({ color: '#EF4444', message: `Tiempo promedio alto: ${rates.avg_quote_days} días` })
  if (profile?.days_since_last_order !== null && profile?.days_since_last_order > 7) alerts.push({ color: '#EF4444', message: `Sin actividad de cotización hace ${profile.days_since_last_order} días` })

  const paymentBreakdown = [
    { name: 'Pagado', value: pay?.paid || 0, color: '#10B981' },
    { name: 'Parcial', value: pay?.partial || 0, color: '#F59E0B' },
    { name: 'Crédito', value: pay?.credit || 0, color: '#8B5CF6' },
    { name: 'Pendiente de Pago', value: pay?.pending || 0, color: '#EF4444' },
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
          <div className="kpi-seller-avatar" style={{ background: '#0EA5E9' }}>{initials}</div>
          <div>
            <h2>{quote?.name || 'Cotizador'}</h2>
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
            { label: 'Órdenes Totales', value: formatNumber(ord?.total || 0), icon: Icons.Orders, color: '#0EA5E9', sub: `${pay?.paid || 0} pagadas · ${pay?.outstanding || 0} por cobrar`, change: cmp?.total?.change_pct },
            { label: 'Conversión de Pago', value: `${pay?.conversion_rate || 0}%`, icon: Icons.CheckCircle, color: '#10B981', sub: `${pay?.paid || 0} pagadas de ${ord?.total || 0}`, change: cmp?.payment_paid?.change_pct },
            { label: 'Tiempo Prom. Cotización', value: formatDays(rates.avg_quote_days), icon: Icons.Clock, color: '#F59E0B', sub: `${ord?.completed || 0} completadas`, change: cmp?.avg_days?.change_pct, inverse: true },
            { label: 'Carga Pendiente', value: pay?.outstanding || 0, icon: Icons.Clipboard, color: ((pay?.outstanding || 0) > 10 ? '#EF4444' : (pay?.outstanding || 0) > 5 ? '#F59E0B' : '#10B981'), sub: `${pay?.partial || 0} parciales · ${pay?.credit || 0} crédito · ${pay?.pending || 0} pendientes`, change: cmp?.payment_pending?.change_pct },
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
                      {changeVal !== 0 ? (isPositive ? '↑' : '↓') : '→'} {Math.abs(changeVal).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {paymentBreakdown.length > 0 && (
          <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
            <h3 className="kpi-card-subtitle">Distribución por Estado de Pago</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 16 }}>
              <div style={{ flex: '0 0 130px', height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={paymentBreakdown.map(d => ({ ...d, fill: d.color }))} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3}>
                    </Pie>
                    <Tooltip content={(props) => <PieTooltip {...props} total={ord?.total || 0} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {paymentBreakdown.map((item, i) => {
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
                {QUOTE_DETAIL_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
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
            {loadingTrend ? (
              <div style={{ height: 220, display: 'grid', placeItems: 'center' }}><div className="kpi-spinner-sm" /></div>
            ) : chartError ? (
              <div className="kpi-empty-state" style={{ height: 220 }}>
                <div className="kpi-empty-title">{chartError}</div>
              </div>
            ) : quoteTrend.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={quoteDates.map((date, i) => ({ date, value: quoteTrend.find(t => t.date === date)?.value || 0, avg: avgByDate[i] }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8edf8" />
                    <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                    <Tooltip wrapperStyle={{ zIndex: 9999 }} labelFormatter={(v) => { const d = new Date(v); return d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) }} formatter={(v) => [`${v} ${quoteMetricLabel.toLowerCase()}`, quote?.name]} />
                    <ReferenceLine y={departmentAvg} stroke="#94A3B8" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `Prom. depto: ${departmentAvg.toFixed(1)}`, position: 'insideTopRight', fontSize: 11, fill: '#94A3B8' }} />
                    <Line type="monotone" dataKey="value" stroke="#0EA5E9" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name={quote?.name} />
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

        <div className="kpi-seller-section-title">Desglose por Estado de Pago</div>
        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          {paymentBreakdown.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {paymentBreakdown.map((s, i) => {
                const pct = (ord?.total || 0) > 0 ? Math.round((s.value / ord.total) * 1000) / 10 : 0
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 130, fontSize: 13, fontWeight: 500, color: '#091127', flexShrink: 0 }}>{s.name}</div>
                    <div style={{ flex: 1, height: 8, background: '#e8edf8', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: s.color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ width: 50, fontSize: 13, fontWeight: 700, color: s.color, textAlign: 'right' }}>{formatNumber(s.value)}</div>
                    <div style={{ width: 45, fontSize: 11, color: '#94A3B8', textAlign: 'right' }}>{pct}%</div>
                  </div>
                )
              })}
            </div>
          ) : <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de pago</div></div>}
        </div>

        <div className="kpi-seller-section-grid">
          <div className="kpi-card" style={{ padding: 24 }}>
            <h3 className="kpi-card-subtitle">Frecuencia de Órdenes</h3>
            <div className="kpi-seller-freq-grid" style={{ marginTop: 16 }}>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#0EA5E9' }}>{profile?.order_frequency?.per_day || 0}</div>
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
            <h3 className="kpi-card-subtitle">Estado de Cobro</h3>
            <div className="kpi-seller-freq-grid" style={{ marginTop: 16 }}>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#10B981' }}>{pay?.paid || 0}</div>
                <div className="kpi-seller-freq-label">Pagadas</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#F59E0B' }}>{pay?.partial || 0}</div>
                <div className="kpi-seller-freq-label">Pago Parcial</div>
              </div>
              <div className="kpi-seller-freq-card">
                <div className="kpi-seller-freq-value" style={{ color: '#8B5CF6' }}>{pay?.credit || 0}</div>
                <div className="kpi-seller-freq-label">A Crédito</div>
              </div>
            </div>
          </div>
        </div>

        {profileError && (
          <div className="kpi-seller-alerts" style={{ marginBottom: 16 }}>
            <div className="kpi-seller-alert-item" style={{ borderColor: '#F59E0B' }}>
              <Icons.AlertCircle size={14} style={{ color: '#F59E0B' }} />
              <span>{profileError}</span>
            </div>
          </div>
        )}

        {topClients.length > 0 && (
          <>
            <div className="kpi-seller-section-title" style={{ marginTop: 8 }}>Relación con Clientes</div>
            <p className="kpi-seller-section-subtitle">Análisis de la relación del cotizador con sus clientes asignados y materiales predominantes.</p>
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
                          background: '#0EA5E9',
                          color: '#fff',
                        }}>{i + 1}</div>
                        <div className="kpi-seller-list-info">
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span className="kpi-seller-list-name">{client.client_name}</span>
                            <span className="kpi-seller-list-value" style={{ color: '#0EA5E9' }}>{clientPct}%</span>
                          </div>
                          <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(clientPct, 100)}%`, height: '100%', background: '#0EA5E9', borderRadius: 3, transition: 'width 0.6s ease' }} />
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
                {(profile?.materials || []).length > 0 ? (
                  <div className="kpi-seller-list" style={{ marginTop: 16 }}>
                    {(profile?.materials || []).slice(0, 6).map((mat, i) => (
                      <div key={i} className="kpi-seller-list-item">
                        <div className="kpi-seller-list-rank" style={{
                          background: '#0EA5E9',
                          color: '#fff',
                        }}>{i + 1}</div>
                        <div className="kpi-seller-list-info">
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span className="kpi-seller-list-name">{mat.name}</span>
                            <span className="kpi-seller-list-value" style={{ color: '#0EA5E9' }}>{mat.pct}%</span>
                          </div>
                          <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(mat.pct || 0, 100)}%`, height: '100%', background: '#0EA5E9', borderRadius: 3, transition: 'width 0.6s ease' }} />
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
          const comparisonItems = [
            { label: 'Órdenes', curr: cmp.total.curr, prev: cmp.total.prev, change: cmp.total.change_pct },
            { label: 'Conversión de Pago', curr: cmp.payment_paid?.curr || 0, prev: cmp.payment_paid?.prev || 0, change: cmp.payment_paid?.change_pct || 0 },
            { label: 'Pago Pendiente', curr: cmp.payment_pending?.curr || 0, prev: cmp.payment_pending?.prev || 0, change: cmp.payment_pending?.change_pct || 0, inverse: true },
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

        <QuoteActivityTimeline quoteId={quoteId} getDateBounds={getChartBounds} />
      </div>
    </div>
  )
}

export default function KPIQuoteIntelligence({ period, customDateFrom, customDateTo, onQuoteClick }) {
  const [metricsData, setMetricsData] = useState(null)
  const [selectedMetric, setSelectedMetric] = useState('orders')
  const [loading, setLoading] = useState(true)

  const getPeriodBounds = useCallback(() => {
    if (period === 'custom' && customDateFrom && customDateTo) {
      return { date_from: customDateFrom, date_to: customDateTo }
    }
    const now = new Date()
    let start, end
    switch (period) {
      case 'today': {
        start = new Date(now)
        start.setHours(0, 0, 0, 0)
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
        break
      }
      case 'week': {
        start = new Date(now)
        start.setDate(now.getDate() - now.getDay())
        start.setHours(0, 0, 0, 0)
        end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
        break
      }
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

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      try {
        const bounds = getPeriodBounds()
        const res = await adminApiFetch('/api/kpi-data', { action: 'quote_metrics', metric: selectedMetric, ...bounds })
        if (!cancelled && res.response.ok) setMetricsData(res.result)
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false) }
    }
    fetch()
    return () => { cancelled = true }
  }, [getPeriodBounds, selectedMetric])

  const quotes = metricsData?.quotes || []
  const totalQuotes = quotes.length
  const totalOrders = quotes.reduce((s, q) => s + q.value, 0)

  return (
    <div>
      <div className="kpi-filter-row" style={{ marginBottom: 16 }}>
        <label style={{ flex: '1 1 280px', minWidth: 200 }}>
          <select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
            <option value="orders">Órdenes Asignadas</option>
            <option value="partial_payment">Pago Parcial</option>
            <option value="credit">Crédito</option>
            <option value="pending">Pendientes de Pago</option>
          </select>
        </label>
      </div>

      <div className="kpi-leader-grid" style={{ marginBottom: 24 }}>
        {[
          { category: 'Cotizadores Activos', value: formatNumber(totalQuotes), icon: Icons.Users, color: '#0EA5E9' },
          { category: 'Órdenes en Período', value: formatNumber(totalOrders), icon: Icons.Orders, color: '#10B981' },
          { category: 'Métrica Seleccionada', value: metricsData?.metric_label || 'Órdenes', icon: Icons.TrendUp, color: '#F59E0B' },
        ].map((h, i) => {
          const Icon = h.icon
          return (
            <div key={i} className="kpi-leader-card">
              <div className="kpi-leader-header">
                <div className="kpi-leader-icon" style={{ background: `${h.color}15`, color: h.color }}><Icon size={16} /></div>
                <div className="kpi-leader-category">{h.category}</div>
              </div>
              <div className="kpi-leader-value" style={{ color: h.color }}>{h.value}</div>
            </div>
          )
        })}
      </div>

      <div className="kpi-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Todos los Usuarios</h3>
          {loading && <div className="kpi-spinner-sm" />}
        </div>
        {!loading && quotes.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quotes.map((q) => (
              <div key={q.id} onClick={() => onQuoteClick?.(q.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 10,
                background: '#f8fafc',
                border: '1px solid #e8edf8',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#0EA5E9'; e.currentTarget.style.background = '#F0F9FF' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8edf8'; e.currentTarget.style.background = '#f8fafc' }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: '#0EA5E9',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}>{q.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#091127', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0EA5E9', flexShrink: 0 }}>{formatNumber(q.value)} {metricsData?.metric_label?.toLowerCase() || 'órdenes'}</span>
                  </div>
                  <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(q.pct || 0, 100)}%`, height: '100%', background: '#0EA5E9', borderRadius: 3, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
                <Icons.ArrowRight size={13} style={{ color: '#94A3B8', flexShrink: 0 }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin cotizadores activos</div></div>
        )}
      </div>
    </div>
  )
}
