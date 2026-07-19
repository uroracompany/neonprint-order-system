import { useState, useEffect, useCallback, useMemo } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays } from '../../utils/kpiHelpers'
import { adminApiFetch } from '../../utils/adminApi'

const AREA_COLORS = { digital: '#06B6D4', dtf: '#F43F5E', ploteo: '#F59E0B' }
const AREA_ICONS = { digital: Icons.Image, dtf: Icons.Package, ploteo: Icons.Clipboard }
const LINE_COLORS = ['#06B6D4', '#F43F5E', '#F59E0B', '#10B981', '#8B5CF6', '#F97316']
const STATUS_COLORS = { pending: '#F59E0B', in_production: '#F97316', in_termination: '#0EA5E9', completed: '#10B981' }
const STATUS_LABELS = { pending: 'Pendiente', in_production: 'En Produccion', in_termination: 'En Terminacion', completed: 'Completado' }
const CHART_PERIODS = [
  { key: '7d', label: '7d' },
  { key: '1m', label: '1m' },
  { key: '3m', label: '3m' },
  { key: '6m', label: '6m' },
]

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
      <div style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Cargando datos de produccion...</div>
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

function HeroCard({ label, value, color, icon: Icon, subtitle, trend }) {
  return (
    <div className="kpi-seller-hero-card">
      <div className="kpi-seller-hero-header">
        <div className="kpi-seller-hero-label">{label}</div>
        {Icon && <div className="kpi-seller-hero-icon" style={{ background: `${color}18`, color }}><Icon size={18} /></div>}
      </div>
      <div className="kpi-seller-hero-value" style={{ color }}>{value}</div>
      {(subtitle || trend) && (
        <div className="kpi-seller-hero-footer">
          {subtitle && <span className="kpi-seller-hero-subtitle">{subtitle}</span>}
          {trend && <span className="kpi-seller-hero-trend" style={{ background: `${color}18`, color }}>{trend}</span>}
        </div>
      )}
    </div>
  )
}

function GlobalView({ getDateBounds, onAreaClick }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
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
        const res = await adminApiFetch('/api/kpi-data', { action: 'production_overview', ...bounds, ...getCompareBounds(bounds) })
        if (res.response.ok && !cancelled) setData(res.result)
      } catch { /* ignore */ }
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
      <div className="kpi-hero-grid kpi-hero-grid--4" style={{ marginBottom: 24 }}>
        <HeroCard label="Archivos Totales" value={formatNumber(total_files)} color="#0EA5E9" icon={Icons.Package} subtitle="Entradas a produccion" />
        <HeroCard label="En Produccion" value={formatNumber(areas.reduce((s, a) => s + (a.in_production || 0), 0))} color="#F97316" icon={Icons.Clipboard} subtitle="Carga operativa" />
        <HeroCard label="Completados" value={formatNumber(total_completed)} color="#10B981" icon={Icons.CheckCircle} subtitle="Archivos finalizados" />
        <HeroCard label="Tasa Promedio" value={`${areas.length > 0 ? (areas.reduce((s, a) => s + (a.completion_rate || 0), 0) / areas.length).toFixed(1) : 0}%`} color="#8B5CF6" icon={Icons.TrendUp} subtitle="Promedio por area" />
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

      {comparison && (
        <>
          <div className="kpi-seller-section-title">Comparacion con Periodo Anterior</div>
          <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
            {comparison.total_files && <ComparisonCard label="Archivos" value={comparison.total_files.curr} prev={comparison.total_files.prev} change={comparison.total_files.change_pct} />}
            {comparison.completed && <ComparisonCard label="Completados" value={comparison.completed.curr} prev={comparison.completed.prev} change={comparison.completed.change_pct} />}
          </div>
        </>
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

export function ProductionAreaDetailView({ areaCode, onBack, onEmployeeClick, period, customDateFrom, customDateTo }) {
  const [data, setData] = useState(null)
  const [trendData, setTrendData] = useState(null)
  const [loading, setLoading] = useState(true)
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
    completed = 0,
    pending = 0,
    in_production = 0,
    in_termination = 0,
    completion_rate = 0,
    avg_time_days = 0,
    reversion_rate = 0,
    reversions = 0,
    users = [],
    bottlenecks = [],
    comparison,
    trend = [],
    status_breakdown: statusBreakdown,
  } = data
  const color = AREA_COLORS[areaCode] || '#0EA5E9'
  const AreaIcon = AREA_ICONS[areaCode] || Icons.Package
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

  return (
    <div className="kpi-seller-page">
      <div className="kpi-seller-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kpi-seller-avatar" style={{ background: color }}><AreaIcon size={24} /></div>
          <div>
            <h2>{area?.label || 'Area de Produccion'}</h2>
            <div className="kpi-seller-header-meta">
              <span className="kpi-seller-period-badge">Periodo: {periodLabel}</span>
              <span className="kpi-seller-participation-badge">{completion_rate}% finalizado</span>
            </div>
          </div>
        </div>
        <button className="kpi-seller-back-btn" onClick={onBack}><Icons.ChevronLeft size={15} /> Volver al panel</button>
      </div>

      <div className="kpi-seller-page-body">
        <div className="kpi-card" style={{ marginBottom: 24 }}>
          <div className="kpi-seller-section-title">Resumen Ejecutivo</div>
          <p className="kpi-section-subtitle" style={{ margin: 0 }}>
            {area?.label || 'Esta area'} proceso {formatNumber(total_files)} archivo{total_files !== 1 ? 's' : ''} durante {periodLabel}, con {formatNumber(completed)} completado{completed !== 1 ? 's' : ''}, {formatDays(avg_time_days)} de tiempo promedio y {users.length} empleado{users.length !== 1 ? 's' : ''} activo{users.length !== 1 ? 's' : ''}.
          </p>
        </div>

        <div className="kpi-seller-hero-grid">
          <HeroCard label="Archivos" value={formatNumber(total_files)} color={color} icon={Icons.Package} subtitle="Carga total" trend={`${completion_rate}% listo`} />
          <HeroCard label="Completados" value={formatNumber(completed)} color="#10B981" icon={Icons.CheckCircle} subtitle="Salida efectiva" />
          <HeroCard label="Tiempo Prom." value={formatDays(avg_time_days)} color="#8B5CF6" icon={Icons.Clock} subtitle="De inicio a cierre" />
          <HeroCard label="Reversiones" value={formatNumber(reversions)} color={reversions > 0 ? '#EF4444' : '#94A3B8'} icon={Icons.AlertCircle} subtitle={`${reversion_rate}% del volumen`} />
        </div>

        <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="kpi-seller-section-title" style={{ marginBottom: 0 }}>Tendencia del Area</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>Completados, en proceso y terminacion</div>
            </div>
            <ChartControls chartPeriod={chartPeriod} chartCustom={chartCustom} chartDateFrom={chartDateFrom} chartDateTo={chartDateTo} setChartPeriod={setChartPeriod} setChartCustom={setChartCustom} setChartDateFrom={setChartDateFrom} setChartDateTo={setChartDateTo} />
          </div>
          {chartDates.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartDates.map(date => {
                const item = areaTrend.find(t => t.date === date) || {}
                return { date, Completados: item.completed || 0, Produccion: item.in_production || 0, Terminacion: item.in_termination || 0 }
              })}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <Tooltip />
                <Line type="monotone" dataKey="Completados" stroke="#10B981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Produccion" stroke="#F97316" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Terminacion" stroke="#0EA5E9" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="kpi-empty-state" style={{ height: 260 }}><div className="kpi-empty-title">Sin tendencia para este periodo</div></div>
          )}
        </div>

        <div className="kpi-grid-2col">
          <div className="kpi-card" style={{ padding: 24 }}>
            <div className="kpi-seller-section-title">Estado Operativo</div>
            <div style={{ height: 210 }}>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} stroke="#fff" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip total={total_files} />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="kpi-empty-state"><div className="kpi-empty-title">Sin datos</div></div>}
            </div>
            <div className="kpi-seller-list" style={{ maxHeight: 180, marginTop: 12 }}>
              {pieData.map((item, idx) => (
                <div key={idx} className="kpi-seller-list-item">
                  <span className="kpi-seller-list-rank" style={{ background: item.color, color: '#fff', borderColor: item.color }} />
                  <span className="kpi-seller-list-name">{item.name}</span>
                  <span className="kpi-seller-list-value">{formatNumber(item.value)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="kpi-card" style={{ padding: 24 }}>
            <div className="kpi-seller-section-title">Ranking de Empleados del Area</div>
            {users.length > 0 ? (
              <div className="kpi-seller-list">
                {users.slice(0, 10).map(user => (
                  <button key={user.id} className="kpi-seller-list-item" onClick={() => onEmployeeClick(user.id, areaCode)} style={{ textAlign: 'left', cursor: 'pointer' }}>
                    <span className="kpi-seller-list-rank" style={{ background: color, color: '#fff', borderColor: color }}>{user.rank}</span>
                    <span className="kpi-seller-list-info">
                      <span className="kpi-seller-list-name">{user.name}</span>
                      <span className="kpi-seller-list-sub">{formatDays(user.avg_time_days)} prom. - {user.reversions} reversion{user.reversions !== 1 ? 'es' : ''}</span>
                      <span style={{ display: 'block', height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
                        <span style={{ display: 'block', width: `${Math.min(user.pct || 0, 100)}%`, height: '100%', background: color }} />
                      </span>
                    </span>
                    <span className="kpi-seller-list-value" style={{ color }}>{formatNumber(user.completed)}</span>
                    <Icons.ArrowRight size={13} style={{ color: '#94A3B8', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="kpi-empty-state"><div className="kpi-empty-title">Sin empleados activos</div></div>
            )}
          </div>
        </div>

        {bottlenecks.length > 0 && (
          <div className="kpi-card" style={{ padding: 20, marginBottom: 24 }}>
            <div className="kpi-seller-section-title">Alertas Operativas</div>
            <div className="kpi-seller-alerts" style={{ marginBottom: 0 }}>
              {bottlenecks.slice(0, 6).map(item => (
                <div key={item.file_id} className="kpi-seller-alert-item" style={{ borderColor: '#FECACA', color: item.days_in_stage > 7 ? '#DC2626' : '#D97706' }}>
                  <Icons.AlertCircle size={14} />
                  <span>Orden #{item.order_id?.slice(0, 8)} detenida por {item.days_in_stage} dias</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {comparison && (
          <>
            <div className="kpi-seller-section-title">Comparacion con Periodo Anterior</div>
            <div className="kpi-seller-comparison-grid" style={{ marginBottom: 24 }}>
              {comparison.total_files && <ComparisonCard label="Archivos" value={comparison.total_files.curr} prev={comparison.total_files.prev} change={comparison.total_files.change_pct} color={color} />}
              {comparison.completed && <ComparisonCard label="Completados" value={comparison.completed.curr} prev={comparison.completed.prev} change={comparison.completed.change_pct} color="#10B981" />}
              {comparison.avg_time_days && <ComparisonCard label="Tiempo Prom." value={formatDays(comparison.avg_time_days.curr)} prev={formatDays(comparison.avg_time_days.prev)} change={comparison.avg_time_days.change_pct} color="#8B5CF6" inverse />}
              {comparison.reversions && <ComparisonCard label="Reversiones" value={comparison.reversions.curr} prev={comparison.reversions.prev} change={comparison.reversions.change_pct} color="#EF4444" inverse />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function ProductionEmployeeDetailView({ employeeId, areaCode, onBack, period, customDateFrom, customDateTo }) {
  const [data, setData] = useState(null)
  const [activity, setActivity] = useState(null)
  const [loading, setLoading] = useState(true)

  const periodBounds = useMemo(() => getDateBoundsForPeriod(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      try {
        const [detailRes, activityRes] = await Promise.all([
          adminApiFetch('/api/kpi-data', { action: 'production_employee_detail', employee_id: employeeId, area_code: areaCode, ...periodBounds }),
          adminApiFetch('/api/kpi-data', { action: 'production_employee_activity', employee_id: employeeId, ...periodBounds }),
        ])
        if (detailRes.response.ok && !cancelled) setData(detailRes.result)
        if (activityRes.response.ok && !cancelled) setActivity(activityRes.result)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [employeeId, areaCode, periodBounds])

  if (loading) return <LoadingState />
  if (!data) return <ErrorState message="No hay datos para este empleado." />

  const { profile, total_files = 0, completed = 0, in_production = 0, in_termination = 0, pending = 0, avg_time_days = 0, reversions = 0, files_by_area } = data
  const initials = (profile?.name || 'E').split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase()
  const statusPieData = [
    { name: 'Pendiente', value: pending, color: STATUS_COLORS.pending },
    { name: 'En Produccion', value: in_production, color: STATUS_COLORS.in_production },
    { name: 'En Terminacion', value: in_termination, color: STATUS_COLORS.in_termination },
    { name: 'Completado', value: completed, color: STATUS_COLORS.completed },
  ].filter(item => item.value > 0)
  const areaBarData = Object.entries(files_by_area || {}).map(([code, stats]) => ({
    name: code === 'digital' ? 'Digital' : code === 'dtf' ? 'DTF' : code === 'ploteo' ? 'Ploteo' : code,
    Completados: stats.completed || 0,
    Produccion: stats.in_production || 0,
    Terminacion: stats.in_termination || 0,
  }))

  return (
    <div className="kpi-seller-page">
      <div className="kpi-seller-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kpi-seller-avatar" style={{ background: AREA_COLORS[areaCode] || '#0EA5E9' }}>{initials}</div>
          <div>
            <h2>{profile?.name || 'Empleado'}</h2>
            <div className="kpi-seller-header-meta">
              <span className="kpi-seller-period-badge">{formatNumber(total_files)} archivos</span>
              <span className="kpi-seller-participation-badge">{formatNumber(completed)} completados</span>
            </div>
          </div>
        </div>
        <button className="kpi-seller-back-btn" onClick={onBack}><Icons.ChevronLeft size={15} /> Volver al area</button>
      </div>

      <div className="kpi-seller-page-body">
        <div className="kpi-seller-hero-grid">
          <HeroCard label="Completados" value={formatNumber(completed)} color="#10B981" icon={Icons.CheckCircle} subtitle="Archivos finalizados" />
          <HeroCard label="Tiempo Prom." value={formatDays(avg_time_days)} color="#0EA5E9" icon={Icons.Clock} subtitle="Ciclo promedio" />
          <HeroCard label="Reversiones" value={formatNumber(reversions)} color={reversions > 0 ? '#EF4444' : '#94A3B8'} icon={Icons.AlertCircle} subtitle="Calidad operativa" />
          <HeroCard label="En Proceso" value={formatNumber(in_production + in_termination)} color="#F97316" icon={Icons.Clipboard} subtitle="Trabajo activo" />
        </div>

        <div className="kpi-grid-2col">
          <div className="kpi-card" style={{ padding: 24 }}>
            <div className="kpi-seller-section-title">Distribucion por Estado</div>
            <div style={{ height: 220 }}>
              {statusPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">
                      {statusPieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip total={total_files} />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="kpi-empty-state"><div className="kpi-empty-title">Sin datos</div></div>}
            </div>
          </div>

          <div className="kpi-card" style={{ padding: 24 }}>
            <div className="kpi-seller-section-title">Archivos por Area</div>
            {areaBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={areaBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="Completados" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Produccion" fill="#F97316" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Terminacion" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="kpi-empty-state"><div className="kpi-empty-title">Sin datos</div></div>}
          </div>
        </div>

        {activity?.events?.length > 0 && (
          <div className="kpi-card" style={{ padding: 20 }}>
            <div className="kpi-seller-section-title">Actividad Reciente</div>
            <div className="kpi-seller-timeline">
              {activity.events.slice(0, 10).map(event => (
                <div key={`${event.source}-${event.id}`} className="kpi-seller-timeline-item">
                  <span className="kpi-seller-timeline-dot" style={{ background: event.type === 'file_update' ? '#0EA5E9' : '#8B5CF6' }} />
                  <span className="kpi-seller-timeline-line" />
                  <div className="kpi-seller-timeline-content">
                    <div className="kpi-seller-timeline-desc">#{event.order_id?.slice(0, 8)} {event.detail}</div>
                    <div className="kpi-seller-timeline-time">{new Date(event.created_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function KPIProductionIntelligence({ period, customDateFrom, customDateTo, onAreaClick, onEmployeeClick }) {
  const [areaCode, setAreaCode] = useState(null)
  const [employeeId, setEmployeeId] = useState(null)

  const getDateBounds = useCallback(() => getDateBoundsForPeriod(period, customDateFrom, customDateTo), [period, customDateFrom, customDateTo])

  const handleAreaClick = useCallback((nextAreaCode) => {
    if (onAreaClick) onAreaClick(nextAreaCode)
    else setAreaCode(nextAreaCode)
  }, [onAreaClick])

  const handleEmployeeClick = useCallback((nextEmployeeId, nextAreaCode) => {
    if (onEmployeeClick) onEmployeeClick(nextEmployeeId, nextAreaCode || areaCode)
    else setEmployeeId(nextEmployeeId)
  }, [onEmployeeClick, areaCode])

  if (areaCode && employeeId) {
    return <ProductionEmployeeDetailView employeeId={employeeId} areaCode={areaCode} onBack={() => setEmployeeId(null)} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
  }

  if (areaCode) {
    return <ProductionAreaDetailView areaCode={areaCode} onBack={() => setAreaCode(null)} onEmployeeClick={handleEmployeeClick} period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} />
  }

  return <GlobalView getDateBounds={getDateBounds} onAreaClick={handleAreaClick} />
}
