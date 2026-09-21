import { useMemo, useRef } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { formatNumber, getMaterialGlobalBounds } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'
import { useKPISingle } from '../../hooks/useKPI'
import MaterialAnalyticsDialog from './MaterialAnalyticsDialog'
import '../../css-components/material-analytics-modal.css'

const EMPTY_ARRAY = Object.freeze([])
const COLORS = ['#1E40AF', '#2563eb', '#0ea5e9', '#14b8a6', '#8b5cf6', '#94a3b8']

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function Metric({ label, value, icon, detail }) {
  return (
    <div className="kpi-material-detail-metric">
      <span className="kpi-material-detail-metric-label">{icon}{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function Distribution({ label, firstLabel, firstValue, secondLabel, secondValue, icon }) {
  const first = number(firstValue)
  const second = number(secondValue)
  const total = first + second
  const firstPercent = total ? Math.round((first / total) * 100) : 0
  const secondPercent = total ? 100 - firstPercent : 0

  return (
    <section className="kpi-material-detail-distribution">
      <div className="kpi-material-detail-distribution-heading"><span>{icon}{label}</span><strong>{formatNumber(total)} registros</strong></div>
      <div className="kpi-material-detail-distribution-bar" aria-label={`${label}: ${firstLabel} ${first}, ${secondLabel} ${second}`}>
        <span className="is-primary" style={{ width: `${firstPercent}%` }}>{first > 0 && <b>{firstLabel} · {formatNumber(first)}</b>}</span>
        <span className="is-secondary" style={{ width: `${secondPercent}%` }}>{second > 0 && <b>{secondLabel} · {formatNumber(second)}</b>}</span>
      </div>
      <div className="kpi-material-detail-distribution-legend"><span><i className="is-primary" />{firstLabel} <strong>{formatNumber(first)}</strong></span><span><i />{secondLabel} <strong>{formatNumber(second)}</strong></span></div>
    </section>
  )
}

function formatTrendDay(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day))
}

function summarize(data) {
  const snapshot = data?.snapshot || {}
  const coverage = data?.coverage || {}
  const period = data?.period || {}
  const rows = [...(Array.isArray(period.summary) ? period.summary : EMPTY_ARRAY)].sort((first, second) => (
    number(second.reference_count) - number(first.reference_count)
    || number(second.total_orders) - number(first.total_orders)
    || String(first.name || '').localeCompare(String(second.name || ''), 'es')
  ))
  const totalReferences = number(period.material_references)
  const positiveRows = rows.filter(row => number(row.reference_count) > 0)
  const top = positiveRows[0] || null
  const topFive = positiveRows.slice(0, 5)
  const otherReferences = positiveRows.slice(5).reduce((total, row) => total + number(row.reference_count), 0)
  const donut = [
    ...topFive.map(row => ({ name: row.name || 'Material sin nombre', value: number(row.reference_count) })),
    ...(otherReferences > 0 ? [{ name: 'Otros', value: otherReferences }] : []),
  ]
  const daily = new Map()
  const distribution = { urgent: 0, normal: 0, internal: 0, external: 0 }
  positiveRows.forEach(row => {
    distribution.urgent += number(row.urgent_orders)
    distribution.normal += number(row.normal_orders)
    distribution.internal += number(row.internal_design_orders)
    distribution.external += number(row.external_design_orders)
    Object.entries(row.daily || {}).forEach(([day, value]) => {
      const count = number(value)
      if (count > 0 && day) daily.set(day, number(daily.get(day)) + count)
    })
  })

  return {
    snapshot,
    coverage,
    period,
    rows,
    positiveRows,
    top,
    totalReferences,
    donut,
    distribution,
    trend: [...daily.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([day, count]) => ({ day, count })),
  }
}

export default function MaterialAnalyticsOverviewModal({ open, userId, onClose, returnFocusRef }) {
  const closeButtonRef = useRef(null)
  const bounds = useMemo(() => getMaterialGlobalBounds(), [])
  const query = useKPISingle('materials_analytics', bounds, userId, Boolean(open && userId))
  const analytics = useMemo(() => summarize(query.data), [query.data])
  const isLoading = query.loading || query.fetching || query.isPlaceholderData
  const hasValidData = Boolean(query.data) && !isLoading && !query.error
  const hasReferences = analytics.positiveRows.length > 0

  return (
    <MaterialAnalyticsDialog
      open={open}
      onClose={onClose}
      labelledBy="material-analytics-overview-title"
      describedBy="material-analytics-overview-description"
      dialogClassName="kpi-material-detail-modal kpi-material-overview-modal"
      initialFocusRef={closeButtonRef}
      returnFocusRef={returnFocusRef}
    >
      <header className="kpi-material-detail-header">
        <span className="kpi-material-detail-icon"><Icons.ChartArea /></span>
        <div>
          <span className="kpi-material-detail-eyebrow">Histórico completo</span>
          <h2 id="material-analytics-overview-title">Estadísticas generales de materiales</h2>
          <p id="material-analytics-overview-description">Actividad registrada en órdenes desde el inicio del historial.</p>
        </div>
        <button type="button" className="kpi-material-detail-close" onClick={onClose} aria-label="Cerrar estadísticas generales de materiales" ref={closeButtonRef}><Icons.Close /></button>
      </header>
      <p className="kpi-material-overview-note">Referencias registradas en órdenes; no representa stock, consumo físico ni disponibilidad de inventario.</p>
      <div className="kpi-material-detail-modal-scroll">
        {isLoading && <p className="kpi-material-detail-feedback" role="status">Cargando estadísticas históricas…</p>}
        {query.error && !isLoading && <p className="kpi-material-detail-feedback is-error" role="alert">No fue posible obtener las estadísticas generales. <button type="button" onClick={query.refresh}>Reintentar</button></p>}
        {hasValidData && <div className="kpi-material-detail-metrics">
          <Metric label="Materiales registrados" value={formatNumber(analytics.snapshot.catalog_materials)} icon={<Icons.Package size={15} />} />
          <Metric label="Órdenes abiertas sin material" value={formatNumber(analytics.snapshot.open_orders_without_material)} icon={<Icons.AlertCircle size={15} />} />
          <Metric label="Referencias no reconocidas" value={formatNumber(analytics.coverage.unrecognized_period_references)} icon={<Icons.AlertCircle size={15} />} />
          <Metric label="Órdenes con material" value={formatNumber(analytics.period.orders_with_material)} icon={<Icons.Orders size={15} />} />
          <Metric label="Referencias históricas" value={formatNumber(analytics.totalReferences)} icon={<Icons.FileText size={15} />} />
          <Metric label="Más referenciado" value={analytics.top?.name || 'Sin datos'} icon={<Icons.Package size={15} />} detail={analytics.top ? `${formatNumber(analytics.top.reference_count)} referencias` : undefined} />
        </div>}
        {hasValidData && !hasReferences && <p className="kpi-material-detail-empty" role="status" style={{ padding: '0 24px 24px' }}>No hay referencias de materiales en órdenes para mostrar en el histórico.</p>}
        {hasValidData && hasReferences && <>
          <section className="kpi-material-overview-donut" aria-label="Distribución de referencias por material">
            <div className="kpi-material-overview-donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics.donut} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                    {analytics.donut.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={value => [formatNumber(value), 'Referencias']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div><span className="kpi-material-detail-eyebrow">Distribución</span><h3 style={{ margin: 0, color: '#0f1e40', fontSize: 14 }}>Materiales más referenciados</h3><ul>{analytics.donut.map((entry, index) => <li key={entry.name}><span><i style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6, borderRadius: '50%', background: COLORS[index % COLORS.length] }} />{entry.name}</span><b>{formatNumber(entry.value)}</b></li>)}</ul></div>
          </section>
          <div className="kpi-material-detail-distributions">
            <Distribution label="Tipo de orden" icon={<Icons.Orders size={15} />} firstLabel="911" firstValue={analytics.distribution.urgent} secondLabel="Normal" secondValue={analytics.distribution.normal} />
            <Distribution label="Origen del diseño" icon={<Icons.Paintbrush size={15} />} firstLabel="Interno" firstValue={analytics.distribution.internal} secondLabel="Externo" secondValue={analytics.distribution.external} />
          </div>
          <p className="kpi-material-detail-empty" style={{ padding: '0 24px 16px', margin: 0 }}>La composición cuenta registros por material; una orden con varios materiales puede aportar a más de una fila.</p>
          <section className="kpi-material-overview-ranking">
            <h3>Ranking de referencias</h3>
            <ol>{analytics.positiveRows.slice(0, 5).map((row, index) => <li key={row.material_id || `${row.name}-${index}`}><strong>{row.name || 'Material no reconocido'}</strong><span>{formatNumber(row.reference_count)} referencias</span><span>{formatNumber(row.total_orders)} órdenes · {analytics.totalReferences ? Math.round((number(row.reference_count) / analytics.totalReferences) * 100) : 0}%</span></li>)}</ol>
          </section>
          <section className="kpi-material-detail-trend">
            <div className="kpi-material-detail-trend-heading"><div><span className="kpi-material-detail-eyebrow">Actividad</span><h3>Tendencia global de referencias</h3></div></div>
            {analytics.trend.length > 1 ? <div className="kpi-material-detail-trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics.trend} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}><defs><linearGradient id="material-overview-trend" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#1E40AF" stopOpacity={.16} /><stop offset="95%" stopColor="#1E40AF" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e7eef8" strokeDasharray="3 4" /><XAxis dataKey="day" tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} minTickGap={26} tickFormatter={formatTrendDay} /><YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} /><Tooltip formatter={value => [formatNumber(value), 'Referencias']} labelFormatter={formatTrendDay} /><Area type="monotone" dataKey="count" stroke="#1E40AF" strokeWidth={2.25} fill="url(#material-overview-trend)" /></AreaChart></ResponsiveContainer></div> : analytics.trend.length === 1 ? <div className="kpi-material-detail-trend-single"><span className="kpi-material-detail-trend-single-dot" /><div><strong>{formatNumber(analytics.trend[0].count)} referencias</strong><span>{formatTrendDay(analytics.trend[0].day)}</span></div><p>Actividad registrada en un único día del historial.</p></div> : <p className="kpi-material-detail-empty">No hay tendencia diaria disponible para el histórico.</p>}
          </section>
        </>}
      </div>
    </MaterialAnalyticsDialog>
  )
}
