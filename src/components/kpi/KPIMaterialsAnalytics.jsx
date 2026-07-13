import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area,
} from 'recharts'
import { formatNumber, getTrendConfig } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'

const PALETTE = {
  cyan: '#06B6D4', green: '#10B981', rose: '#F43F5E', amber: '#F59E0B',
  violet: '#8B5CF6', orange: '#F97316', pink: '#EC4899', teal: '#14B8A6',
  indigo: '#6366F1', red: '#EF4444',
  pie: ['#06B6D4', '#F43F5E', '#F59E0B', '#10B981', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#6366F1', '#EF4444'],
}

const PAGE_SIZE = 8

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
      {label && <p style={{ margin: 0, fontWeight: 600, color: '#091127', marginBottom: 4 }}>{label}</p>}
      {payload.map((e, i) => (
        <p key={i} style={{ margin: '2px 0', color: e.color || e.payload?.color, fontWeight: 500 }}>{e.name}: {e.value}</p>
      ))}
    </div>
  )
}

const SEMANTIC = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral:  { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
}

function MiniCard({ label, value, sub, icon, sem, trend }) {
  return (
    <div className="kpi-hero-card">
      <div className="kpi-hero-header">
        <div className="kpi-hero-label">{label}</div>
        <div className="kpi-hero-icon" style={{ background: sem?.iconBg, color: sem?.iconColor }}>{icon}</div>
      </div>
      <div className="kpi-hero-value">{value}</div>
      <div className="kpi-hero-footer">
        <div className="kpi-hero-subtitle">{sub}</div>
        {trend && (
          <div className="kpi-hero-trend" style={{ background: trend.bg, color: trend.color }}>
            <span>{trend.arrow}</span>
            {trend.change !== '0.0' && <span>{Math.abs(Number(trend.change))}%</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function Pagination({ page, total, pageSize, onPage }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => onPage(page - 1)} disabled={page === 0}
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: page === 0 ? '#F8FAFC' : '#fff', color: page === 0 ? '#CBD5E1' : '#475569', cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.ChevronLeft size={14} />
      </button>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>{page + 1} / {totalPages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1}
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: page >= totalPages - 1 ? '#F8FAFC' : '#fff', color: page >= totalPages - 1 ? '#CBD5E1' : '#475569', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(180deg)' }}>
        <Icons.ChevronLeft size={14} />
      </button>
    </div>
  )
}

export default function KPIMaterialsAnalytics({ data, period, setPeriod, customDateFrom, setCustomDateFrom, customDateTo, setCustomDateTo }) {
  const [selectedMaterial, setSelectedMaterial] = useState(-1)
  const [materialSearch, setMaterialSearch] = useState('')
  const [page, setPage] = useState(0)
  const [detailTab, setDetailTab] = useState('ranking')
  const [compPage, setCompPage] = useState(0)
  const [compView, setCompView] = useState('both')

  if (!data) return null

  const kpis = data.client_kpis || {}
  const materialAnalytics = kpis.material_analytics || {}
  const materialComparison = kpis.material_comparison || null
  const summary = materialAnalytics.summary || []
  const orderTypeByMaterial = materialAnalytics.order_type_by_material || []

  const filteredSummary = useMemo(() =>
    summary.filter(m => m.name?.toLowerCase().includes(materialSearch.toLowerCase())),
    [summary, materialSearch]
  )

  const totalCurrent = useMemo(() => summary.reduce((s, m) => s + m.total_orders, 0), [summary])
  const totalComparison = materialComparison?.period_total || 0
  const topMaterial = summary[0] || null
  const avgCancelRate = summary.length > 0 ? Math.round(summary.reduce((s, m) => s + (m.cancel_rate || 0), 0) / summary.length * 10) / 10 : 0

  const trendCurrent = getTrendConfig(totalCurrent, totalComparison)

  const compChartData = useMemo(() => {
    if (!materialComparison?.summary) return []
    const prevMap = {}
    materialComparison.summary.forEach(m => { prevMap[m.name] = m.total_orders })
    const currMap = {}
    summary.forEach(m => { currMap[m.name] = m.total_orders })
    const allNames = new Set([...Object.keys(prevMap), ...Object.keys(currMap)])
    return [...allNames].map(name => ({
      name,
      Antes: prevMap[name] || 0,
      Después: currMap[name] || 0,
    }))
  }, [materialComparison, summary])

  const globalTrendData = useMemo(() => {
    const monthMap = {}
    summary.forEach(m => {
      (m.monthly_trend || []).forEach(t => {
        if (!monthMap[t.month]) monthMap[t.month] = { month: t.month }
        monthMap[t.month].total = (monthMap[t.month].total || 0) + t.count
      })
    })
    return Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month))
  }, [summary])

  const starMaterials = useMemo(() =>
    summary.filter(m => m.total_orders >= 5 && (m.cancel_rate || 0) < 10)
      .sort((a, b) => b.total_orders - a.total_orders)
      .slice(0, 5),
    [summary]
  )

  const highCancelMaterials = useMemo(() =>
    summary.filter(m => m.cancel_rate > 20 && m.total_orders >= 3)
      .sort((a, b) => b.cancel_rate - a.cancel_rate)
      .slice(0, 5),
    [summary]
  )

  const heatmapData = useMemo(() => {
    const monthSet = new Set()
    const matMonthMap = {}
    summary.forEach(m => {
      matMonthMap[m.name] = {}
      ;(m.monthly_trend || []).forEach(t => {
        monthSet.add(t.month)
        matMonthMap[m.name][t.month] = t.count
      })
    })
    const months = [...monthSet].sort()
    const topMats = summary.slice(0, 6)
    return { months, materials: topMats, map: matMonthMap }
  }, [summary])

  const orderTypePieData = useMemo(() => {
    const totalNormal = orderTypeByMaterial.reduce((s, m) => s + m.normal, 0)
    const totalUrgent = orderTypeByMaterial.reduce((s, m) => s + m.urgent, 0)
    return [
      { name: 'Normal', value: totalNormal, color: PALETTE.cyan },
      { name: '911 (Urgente)', value: totalUrgent, color: PALETTE.rose },
    ].filter(d => d.value > 0)
  }, [orderTypeByMaterial])

  const selectedMat = selectedMaterial >= 0 ? filteredSummary[selectedMaterial] : null
  const detailPageData = selectedMat
    ? [selectedMat]
    : filteredSummary.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Materiales</span>
          <h2 className="kpi-section-title">Análisis de Materiales</h2>
          <p className="kpi-section-subtitle">Ranking, uso, tendencias y cancelaciones por material.</p>
        </div>
      </div>

      {/* ─── SUMMARY CARDS ─── */}
      <div className="kpi-hero-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <MiniCard label="Órdenes Totales" value={formatNumber(totalCurrent)} sub="en el Sistema" icon={<Icons.Orders size={16} />} sem={SEMANTIC.neutral} trend={trendCurrent} />
        <MiniCard label="Material Más Usado" value={topMaterial?.name || 'N/A'} sub={topMaterial ? `${formatNumber(topMaterial.total_orders)} órdenes` : ''} icon={<Icons.Package size={16} />} sem={SEMANTIC.positive} />
        <MiniCard label="Tasa de Cancelación" value={`${avgCancelRate}%`} sub="órdenes con material canceladas" icon={<Icons.AlertCircle size={16} />} sem={avgCancelRate > 15 ? SEMANTIC.negative : SEMANTIC.positive} />
        <MiniCard label="Materiales Activos" value={summary.length} sub="usados en el mes" icon={<Icons.Clipboard size={16} />} sem={SEMANTIC.neutral} />
      </div>

      {/* ─── PERIOD COMPARISON ─── */}
      {materialComparison && (
        <div className="kpi-card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Comparación con Período Anterior</div>
              <div style={{ fontSize: 12, color: '#94A3B8' }}>Órdenes con material en los 30 días previos al período seleccionado</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
                {[{ value: 'today', label: 'Hoy' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }, { value: 'year', label: 'Año' }].map(p => (
                  <button
                    key={p.value}
                    className={`kpi-pipeline-view-btn ${period === p.value ? 'active' : ''}`}
                    onClick={() => setPeriod(p.value)}
                  >{p.label}</button>
                ))}
                <button
                  className={`kpi-pipeline-view-btn ${period === 'custom' ? 'active' : ''}`}
                  onClick={() => setPeriod(period === 'custom' ? 'month' : 'custom')}
                >Personalizado</button>
              </div>
              {period === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="date"
                    value={customDateFrom}
                    onChange={e => setCustomDateFrom(e.target.value)}
                    style={{ height: 32, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontFamily: 'Poppins, sans-serif', fontWeight: 500 }}
                  />
                  <span style={{ color: '#94A3B8', fontSize: 12 }}>a</span>
                  <input
                    type="date"
                    value={customDateTo}
                    onChange={e => setCustomDateTo(e.target.value)}
                    style={{ height: 32, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontFamily: 'Poppins, sans-serif', fontWeight: 500 }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── Resumen rápido ── */}
          {(() => {
            const prevMats = new Set((materialComparison.summary || []).map(m => m.name))
            const currMats = new Set(summary.map(m => m.name))
            const inBoth = [...prevMats].filter(m => currMats.has(m))
            const onlyPrev = [...prevMats].filter(m => !currMats.has(m))
            const onlyCurr = [...currMats].filter(m => !prevMats.has(m))
            return (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 140, padding: '12px 16px', borderRadius: 10, background: '#F0F9FF', border: '1px solid #BAE6FD' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#0284C7', marginBottom: 4 }}>En ambos períodos</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#0284C7' }}>{inBoth.length}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>materiales</div>
                </div>
                {onlyCurr.length > 0 && (
                  <div style={{ flex: 1, minWidth: 140, padding: '12px 16px', borderRadius: 10, background: '#DCFCE7', border: '1px solid #BBF7D0' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#16A34A', marginBottom: 4 }}>Nuevos este período</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#16A34A' }}>{onlyCurr.length}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{onlyCurr.join(', ')}</div>
                  </div>
                )}
                {onlyPrev.length > 0 && (
                  <div style={{ flex: 1, minWidth: 140, padding: '12px 16px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', marginBottom: 4 }}>Descontinuados</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#DC2626' }}>{onlyPrev.length}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{onlyPrev.join(', ')}</div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Totales y cambio ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ textAlign: 'center', padding: 12, background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', marginBottom: 4 }}>Período Anterior</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#091127' }}>{formatNumber(totalComparison)}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>órdenes</div>
            </div>
            <div style={{ textAlign: 'center', padding: 12, background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', marginBottom: 4 }}>Período Actual</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#091127' }}>{formatNumber(totalCurrent)}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>órdenes</div>
            </div>
            <div style={{ textAlign: 'center', padding: 12, background: trendCurrent.bg, borderRadius: 10, border: `1px solid ${trendCurrent.color}20` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', marginBottom: 4 }}>Cambio</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: trendCurrent.color }}>{trendCurrent.arrow} {trendCurrent.change}%</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>variación</div>
            </div>
          </div>

          {/* ── Gráfica comparativa ── */}
          {compChartData.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>Comparativa por material</div>
                <div className="kpi-pipeline-view-toggle" style={{ margin: 0 }}>
                  <button className={`kpi-pipeline-view-btn ${compView === 'before' ? 'active' : ''}`} onClick={() => setCompView('before')}>Antes</button>
                  <button className={`kpi-pipeline-view-btn ${compView === 'both' ? 'active' : ''}`} onClick={() => setCompView('both')}>Ambos</button>
                  <button className={`kpi-pipeline-view-btn ${compView === 'after' ? 'active' : ''}`} onClick={() => setCompView('after')}>Después</button>
                </div>
              </div>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={compChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Antes" fill={PALETTE.cyan} radius={[4, 4, 0, 0]} hide={compView === 'after'} />
                    <Bar dataKey="Después" fill={PALETTE.violet} radius={[4, 4, 0, 0]} hide={compView === 'before'} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
                {compView !== 'after' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: PALETTE.cyan }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>Anterior</span>
                  </div>
                )}
                {compView !== 'before' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: PALETTE.violet }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>Actual</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tabla comparativa de materiales ── */}
          {materialComparison.summary?.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>Detalle por material:</div>
                <Pagination page={compPage} total={materialComparison.summary.length} pageSize={7} onPage={setCompPage} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr', gap: 8, padding: '6px 12px', fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <div>Material</div>
                  <div style={{ textAlign: 'center' }}>Anterior</div>
                  <div style={{ textAlign: 'center' }}>Actual</div>
                  <div style={{ textAlign: 'center' }}>Diferencia</div>
                  <div style={{ textAlign: 'center' }}>Estado</div>
                </div>
                {/* Rows */}
                {materialComparison.summary.slice(compPage * 7, (compPage + 1) * 7).map((m, i) => {
                  const curr = summary.find(s => s.name === m.name)
                  const currTotal = curr?.total_orders || 0
                  const diff = currTotal - m.total_orders
                  const pct = m.total_orders > 0 ? Math.round(((currTotal - m.total_orders) / m.total_orders) * 100) : (currTotal > 0 ? 100 : 0)
                  const isNew = m.total_orders === 0 && currTotal > 0
                  const isGone = m.total_orders > 0 && currTotal === 0
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', alignItems: 'center' }}>
                      <div style={{ fontWeight: 600, color: '#091127', fontSize: 13 }}>{m.name}</div>
                      <div style={{ textAlign: 'center', fontSize: 13, color: '#64748b' }}>{formatNumber(m.total_orders)}</div>
                      <div style={{ textAlign: 'center', fontSize: 13, color: '#091127', fontWeight: 600 }}>{formatNumber(currTotal)}</div>
                      <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: diff > 0 ? '#16A34A' : diff < 0 ? '#DC2626' : '#64748b' }}>
                        {diff > 0 ? '+' : ''}{diff}
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        {isGone ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#DC2626', background: '#FEE2E2', padding: '3px 8px', borderRadius: 12 }}>Descontinuado</span>
                        ) : isNew ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#16A34A', background: '#DCFCE7', padding: '3px 8px', borderRadius: 12 }}>Nuevo</span>
                        ) : diff > 0 ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#16A34A', background: '#DCFCE7', padding: '3px 8px', borderRadius: 12 }}>+{pct}%</span>
                        ) : diff < 0 ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#DC2626', background: '#FEE2E2', padding: '3px 8px', borderRadius: 12 }}>{pct}%</span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#64748b', background: '#F1F5F9', padding: '3px 8px', borderRadius: 12 }}>=</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── GLOBAL TREND LINE CHART ─── */}
      {globalTrendData.length > 0 && (
        <div className="kpi-card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>Tendencia Global de Uso</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              {globalTrendData.length === 1 ? (
                <BarChart data={globalTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total" name="Órdenes" fill={PALETTE.cyan} radius={[6, 6, 0, 0]} barSize={60}>
                    {globalTrendData.map((_, i) => <Cell key={i} fill={PALETTE.cyan} />)}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart data={globalTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="total" name="Órdenes" stroke={PALETTE.cyan} strokeWidth={2.5} dot={{ fill: PALETTE.cyan, r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── ORDER TYPE + PIE ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="kpi-card" style={{ padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>Distribución por Tipo de Orden</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={orderTypePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={4} stroke="none">
                  {orderTypePieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  const total = orderTypePieData.reduce((s, e) => s + e.value, 0)
                  return (
                    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                      <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                      <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes — {total > 0 ? Math.round((d.value / total) * 100) : 0}%</p>
                    </div>
                  )
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="kpi-card" style={{ padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>Tipo de Orden por Material</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={orderTypeByMaterial.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="normal" name="Normal" fill={PALETTE.cyan} radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="urgent" name="911" fill={PALETTE.rose} radius={[4, 4, 0, 0]} stackId="a" />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── TABS: RANKING / HEATMAP / ALERTAS ─── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['ranking', 'Ranking de Materiales'], ['heatmap', 'Heatmap'], ['alerts', 'Alertas']].map(([key, label]) => (
          <button key={key} onClick={() => setDetailTab(key)}
            style={{ padding: '8px 18px', borderRadius: 8, border: detailTab === key ? '2px solid #06B6D4' : '1px solid #E2E8F0', background: detailTab === key ? '#ECFEFF' : '#fff', color: detailTab === key ? '#0891B2' : '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ─── RANKING TAB ─── */}
      {detailTab === 'ranking' && (
        <div className="kpi-card" style={{ padding: 24 }}>
          <div className="kpi-section-header" style={{ marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>Ranking de Materiales</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{filteredSummary.length} materiales encontrados</div>
            </div>
            <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
              <label>
                <span>Buscar</span>
                <div style={{ position: 'relative' }}>
                  <Icons.Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                  <input type="text" placeholder="Nombre del material..." value={materialSearch}
                    onChange={e => { setMaterialSearch(e.target.value); setSelectedMaterial(-1); setPage(0) }}
                    style={{ paddingLeft: 32 }} />
                </div>
              </label>
              <label>
                <span>Material</span>
                <select value={selectedMaterial} onChange={e => { setSelectedMaterial(+e.target.value); setPage(0) }}>
                  <option value={-1}>Todos</option>
                  {filteredSummary.map((m, i) => <option key={i} value={filteredSummary.indexOf(m)}>{m.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detailPageData.map((m, i) => {
              const rank = selectedMat ? 1 : page * PAGE_SIZE + i + 1
              const pct = totalCurrent > 0 ? Math.round((m.total_orders / totalCurrent) * 100) : 0
              const cancelColor = m.cancel_rate > 20 ? PALETTE.rose : m.cancel_rate > 10 ? PALETTE.amber : PALETTE.green
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                  <div style={{ width: 4, background: PALETTE.pie[(rank - 1) % PALETTE.pie.length], flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#94A3B8', width: 28, textAlign: 'center', flexShrink: 0 }}>{rank}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#091127' }}>{m.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', background: '#E2E8F0', padding: '2px 8px', borderRadius: 20 }}>{pct}% uso</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b' }}>
                        <span><strong style={{ color: PALETTE.cyan }}>{m.normal_orders || 0}</strong> normal</span>
                        <span><strong style={{ color: PALETTE.rose }}>{m.urgent_orders || 0}</strong> 911</span>
                        <span style={{ color: cancelColor }}><strong>{m.cancel_rate || 0}%</strong> cancelación</span>
                        <span><strong>{m.top_clients?.length || 0}</strong> clientes</span>
                      </div>
                      <div style={{ marginTop: 6, height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden', maxWidth: 300 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: PALETTE.pie[(rank - 1) % PALETTE.pie.length], borderRadius: 2 }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 80 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#091127' }}>{formatNumber(m.total_orders)}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8' }}>órdenes</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {!selectedMat && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Pagination page={page} total={filteredSummary.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </div>
          )}
        </div>
      )}

      {/* ─── HEATMAP TAB ─── */}
      {detailTab === 'heatmap' && (
        <div className="kpi-card" style={{ padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>Heatmap: Uso Mensual por Material (Top 6)</div>
          {heatmapData.months.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600, borderBottom: '2px solid #E2E8F0', position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>Material</th>
                    {heatmapData.months.map(m => (
                      <th key={m} style={{ textAlign: 'center', padding: '8px 10px', color: '#64748b', fontWeight: 600, borderBottom: '2px solid #E2E8F0', minWidth: 70 }}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapData.materials.map((mat, mi) => {
                    const maxVal = Math.max(...heatmapData.months.map(mo => heatmapData.map[mat.name]?.[mo] || 0), 1)
                    return (
                      <tr key={mi}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: '#091127', borderBottom: '1px solid #F1F5F9', position: 'sticky', left: 0, background: '#fff', zIndex: 1, whiteSpace: 'nowrap' }}>{mat.name}</td>
                        {heatmapData.months.map((mo, moi) => {
                          const val = heatmapData.map[mat.name]?.[mo] || 0
                          const intensity = val / maxVal
                          const bg = val === 0 ? '#F8FAFC' : `rgba(6, 182, 212, ${0.1 + intensity * 0.8})`
                          const textColor = intensity > 0.5 ? '#fff' : '#091127'
                          return (
                            <td key={moi} style={{ textAlign: 'center', padding: '8px 10px', background: bg, color: textColor, fontWeight: val > 0 ? 700 : 400, borderRadius: 4, borderBottom: '1px solid #F1F5F9' }}>
                              {val > 0 ? val : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 30, color: '#94A3B8', fontSize: 13 }}>Sin datos de tendencia mensual disponibles</div>
          )}
        </div>
      )}

      {/* ─── ALERTS TAB ─── */}
      {detailTab === 'alerts' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="kpi-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Icons.AlertCircle size={18} color={PALETTE.amber} />
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Materiales Estrella</div>
            </div>
            {starMaterials.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {starMaterials.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                    <span style={{ fontSize: 16 }}>⭐</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#065F46' }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: '#047857' }}>{formatNumber(m.total_orders)} órdenes · {m.cancel_rate}% cancelación</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PALETTE.green, background: '#D1FAE5', padding: '2px 8px', borderRadius: 20 }}>Óptimo</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8', fontSize: 13 }}>No hay materiales estrella aún</div>
            )}
          </div>

          <div className="kpi-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Icons.AlertCircle size={18} color={PALETTE.rose} />
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Alta Tasa de Cancelación</div>
            </div>
            {highCancelMaterials.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {highCancelMaterials.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                    <span style={{ fontSize: 16 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: '#B91C1C' }}>{formatNumber(m.total_orders)} órdenes · <strong>{m.cancel_rate}%</strong> cancelación</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PALETTE.rose, background: '#FEE2E2', padding: '2px 8px', borderRadius: 20 }}>Revisar</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8', fontSize: 13 }}>No hay materiales con alta cancelación</div>
            )}
          </div>
        </div>
      )}

      {/* ─── TOP CLIENTS BY MATERIAL (below tabs) ─── */}
      {selectedMat && selectedMat.top_clients?.length > 0 && (
        <div className="kpi-card" style={{ padding: 24, marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
            Clientes que más usan <strong style={{ color: '#091127' }}>{selectedMat.name}</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedMat.top_clients.map((c, i) => {
              const maxCount = selectedMat.top_clients[0]?.count || 1
              const pct = Math.round((c.count / maxCount) * 100)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', width: 20, textAlign: 'center', flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{c.client_name}</div>
                    <div style={{ marginTop: 4, height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: PALETTE.pie[i % PALETTE.pie.length], borderRadius: 2 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#091127', flexShrink: 0 }}>{c.count}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
