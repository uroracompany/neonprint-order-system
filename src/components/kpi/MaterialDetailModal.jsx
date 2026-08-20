import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber, getMaterialGlobalBounds, MATERIAL_GLOBAL_START } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'
import { FilterSelect } from '../ui/FilterSelect'
import { useKPISingle } from '../../hooks/useKPI'

const EMPTY_ARRAY = Object.freeze([])

const PERIOD_MODES = [
  { value: 'global', label: 'Rendimiento global' },
  { value: 'current', label: 'Período actual' },
  { value: 'previous', label: 'Período anterior' },
  { value: 'day', label: 'Fecha específica' },
  { value: 'range', label: 'Rango de fechas' },
]

const DAY_MS = 86400000
const toIso = date => date.toISOString()
const isoDay = date => date.toISOString().slice(0, 10)
const startOfDay = value => new Date(`${value}T00:00:00`)
const endExclusive = value => new Date(startOfDay(value).getTime() + DAY_MS)

function getModeBounds(mode, periodMeta, dayValue, rangeFrom, rangeTo) {
  if (mode === 'current') return null
  const now = new Date()
  if (mode === 'global') {
    return getMaterialGlobalBounds()
  }
  if (mode === 'previous') {
    const start = new Date(periodMeta?.compare_from || periodMeta?.date_from || MATERIAL_GLOBAL_START)
    const end = new Date(periodMeta?.compare_to || start)
    const duration = Math.max(1, end.getTime() - start.getTime())
    return {
      date_from: toIso(start),
      date_to: toIso(end),
      compare_from: toIso(new Date(start.getTime() - duration)),
      compare_to: toIso(start),
    }
  }
  if (mode === 'day') {
    const day = dayValue || isoDay(now)
    const start = startOfDay(day)
    const end = endExclusive(day)
    return {
      date_from: toIso(start),
      date_to: toIso(end),
      compare_from: toIso(new Date(start.getTime() - DAY_MS)),
      compare_to: toIso(start),
    }
  }
  const start = startOfDay(rangeFrom || isoDay(new Date(periodMeta?.date_from || now)))
  const end = endExclusive(rangeTo || isoDay(now))
  const duration = Math.max(1, end.getTime() - start.getTime())
  return {
    date_from: toIso(start),
    date_to: toIso(end),
    compare_from: toIso(new Date(start.getTime() - duration)),
    compare_to: toIso(start),
  }
}

const formatTrendDay = (value) => {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day))
}

function Metric({ label, value, tone = 'default', icon }) {
  return (
    <div className={`kpi-material-detail-metric is-${tone}`}>
      <span className="kpi-material-detail-metric-label">{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Distribution({ label, icon, firstLabel, firstValue, secondLabel, secondValue }) {
  const firstCount = Number(firstValue || 0)
  const secondCount = Number(secondValue || 0)
  const total = firstCount + secondCount
  const firstPercent = total ? Math.round((firstCount / total) * 100) : 0
  const secondPercent = total ? 100 - firstPercent : 0

  return (
    <section className="kpi-material-detail-distribution">
      <div className="kpi-material-detail-distribution-heading"><span>{icon}{label}</span><strong>{formatNumber(total)} órdenes</strong></div>
      <div className="kpi-material-detail-distribution-bar" aria-label={`${label}: ${firstLabel} ${firstCount}, ${secondLabel} ${secondCount}`}>
        <span className="is-primary" style={{ width: `${firstPercent}%` }}>{firstCount > 0 && <b>{firstLabel} · {formatNumber(firstCount)}</b>}</span>
        <span className="is-secondary" style={{ width: `${secondPercent}%` }}>{secondCount > 0 && <b>{secondLabel} · {formatNumber(secondCount)}</b>}</span>
      </div>
      <div className="kpi-material-detail-distribution-legend">
        <span><i className="is-primary" />{firstLabel} <strong>{formatNumber(firstCount)}</strong></span>
        <span><i />{secondLabel} <strong>{formatNumber(secondCount)}</strong></span>
      </div>
    </section>
  )
}

function RankedList({ title, icon, items, emptyText }) {
  const topItems = [...items]
    .sort((first, second) => Number(second.count || 0) - Number(first.count || 0) || String(first.client_name || first.seller_name || first.name || '').localeCompare(String(second.client_name || second.seller_name || second.name || ''), 'es'))
    .slice(0, 5)

  return (
    <section className="kpi-material-detail-list">
      <h3>{icon}{title}</h3>
      {topItems.length ? (
        <ol>
          {topItems.map((item, index) => (
            <li key={item.client_id || item.seller_id || item.name || index}>
              <span>{index + 1}</span>
              <strong>{item.client_name || item.seller_name || item.name}</strong>
              <em>{formatNumber(item.count)} órdenes</em>
            </li>
          ))}
        </ol>
      ) : <p className="kpi-material-detail-empty">{emptyText}</p>}
    </section>
  )
}

export default function MaterialDetailModal({ material, previousMaterial, totalReferences, userId, periodMeta, onClose }) {
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const [periodMode, setPeriodMode] = useState('global')
  const [dayValue, setDayValue] = useState('')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [chartType, setChartType] = useState('bar')

  useEffect(() => {
    if (!material) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [material, onClose])

  const requestBounds = useMemo(
    () => getModeBounds(periodMode, periodMeta, dayValue, rangeFrom, rangeTo),
    [dayValue, periodMode, periodMeta, rangeFrom, rangeTo],
  )

  const detailQuery = useKPISingle('materials_analytics', requestBounds, userId, Boolean(userId) && periodMode !== 'current')

  const resolved = useMemo(() => {
    if (periodMode === 'current' || !requestBounds) {
      return {
        material,
        previousMaterial,
        totalReferences: Number(totalReferences || 0),
        loading: false,
        error: null,
        meta: periodMeta,
        retry: () => {},
      }
    }
    const rows = detailQuery.data?.period?.summary || EMPTY_ARRAY
    const key = String(material?.material_id || material?.name || '')
    const row = rows.find(item => String(item.material_id || item.name) === key) || null
    const comparisonRow = detailQuery.data?.comparison?.summary?.find(item => item.name === (row?.name || material?.name)) || null
    return {
      material: row,
      previousMaterial: comparisonRow,
      totalReferences: Number(detailQuery.data?.period?.material_references || 0),
      loading: detailQuery.loading || detailQuery.fetching || detailQuery.isPlaceholderData,
      error: detailQuery.error || null,
      meta: detailQuery.data?.meta || periodMeta,
      retry: detailQuery.refresh,
    }
  }, [detailQuery.data, detailQuery.error, detailQuery.fetching, detailQuery.isPlaceholderData, detailQuery.loading, detailQuery.refresh, material, periodMeta, periodMode, previousMaterial, requestBounds, totalReferences])

  const trend = useMemo(() => {
    const current = Number(resolved.material?.reference_count ?? resolved.material?.total_orders ?? 0)
    const previous = Number(resolved.previousMaterial?.reference_count ?? resolved.previousMaterial?.total_orders ?? 0)
    if (!previous) {
      return periodMode === 'global'
        ? { label: 'Sin comparación', tone: 'neutral' }
        : current ? { label: 'Nuevo en el período', tone: 'positive' } : { label: 'Sin cambios', tone: 'neutral' }
    }
    const percent = Math.round(((current - previous) / previous) * 100)
    return percent > 0
      ? { label: `↑ +${percent}%`, tone: 'positive' }
      : percent < 0 ? { label: `↓ ${percent}%`, tone: 'negative' } : { label: 'Sin cambios', tone: 'neutral' }
  }, [periodMode, resolved.material, resolved.previousMaterial])

  const periodLabel = useMemo(() => {
    const timezone = resolved.meta?.timezone || 'UTC'
    const formatRange = value => new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone }).format(new Date(value))
    const formatDay = value => new Intl.DateTimeFormat('es-DO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone }).format(new Date(`${value}T12:00:00`))
    switch (periodMode) {
      case 'global':
        return 'Rendimiento global del material: todo el historial registrado.'
      case 'current':
        return 'Uso registrado en las órdenes del período seleccionado.'
      case 'previous':
        return `Uso registrado en el período anterior (${formatRange(periodMeta?.compare_from)} – ${formatRange(new Date(new Date(periodMeta?.compare_to).getTime() - 1))}).`
      case 'day':
        return `Uso registrado el ${formatDay(dayValue || isoDay(new Date()))}.`
      case 'range':
        return `Uso registrado del ${formatRange(rangeFrom)} al ${formatRange(new Date(endExclusive(rangeTo).getTime() - 1))}.`
      default:
        return 'Uso registrado en las órdenes del período seleccionado.'
    }
  }, [dayValue, periodMode, periodMeta, rangeFrom, rangeTo, resolved.meta?.timezone])

  const handleModeChange = value => {
    setPeriodMode(value)
    const now = new Date()
    if (value === 'day') {
      setDayValue(current => current || isoDay(periodMeta?.date_to ? new Date(new Date(periodMeta.date_to).getTime() - 1) : now))
    }
    if (value === 'range') {
      setRangeFrom(current => current || isoDay(new Date(periodMeta?.date_from || now)))
      setRangeTo(current => current || isoDay(periodMeta?.date_to ? new Date(new Date(periodMeta.date_to).getTime() - 1) : now))
    }
  }

  if (!material) return null

  const activeMaterial = resolved.material || material
  const references = Number(activeMaterial.reference_count ?? activeMaterial.total_orders ?? 0)
  const orders = Number(activeMaterial.total_orders || 0)
  const participation = resolved.totalReferences ? Math.round((references / resolved.totalReferences) * 100) : 0
  const trendData = Object.entries(activeMaterial.daily || {}).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }))
  const clients = activeMaterial.top_clients || EMPTY_ARRAY
  const sellers = activeMaterial.top_sellers || EMPTY_ARRAY

  return createPortal(
    <div className="kpi-material-detail-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="kpi-material-detail-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="material-detail-title" aria-describedby="material-detail-description">
        <header className="kpi-material-detail-header">
          <span className="kpi-material-detail-icon"><Icons.Package /></span>
          <div>
            <span className="kpi-material-detail-eyebrow">Detalle de material</span>
            <h2 id="material-detail-title">{material.name}</h2>
            <p id="material-detail-description">{periodLabel}</p>
          </div>
          <button type="button" className="kpi-material-detail-close" onClick={onClose} aria-label={`Cerrar detalle de ${material.name}`} ref={closeButtonRef}><Icons.Close /></button>
        </header>

        <div className="kpi-material-detail-period">
          <FilterSelect
            icon={<Icons.Calendar size={14} />}
            value={periodMode}
            onChange={handleModeChange}
            options={PERIOD_MODES}
            label="Período del detalle de material"
            isActive={periodMode !== 'global'}
            disabled={resolved.loading}
          />
          {periodMode === 'day' && (
            <label className="kpi-material-detail-period-date"><span>Fecha</span><input className="kpi-input" type="date" value={dayValue} onChange={event => setDayValue(event.target.value)} disabled={resolved.loading} /></label>
          )}
          {periodMode === 'range' && (
            <>
              <label className="kpi-material-detail-period-date"><span>Desde</span><input className="kpi-input" type="date" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)} disabled={resolved.loading} /></label>
              <label className="kpi-material-detail-period-date"><span>Hasta</span><input className="kpi-input" type="date" value={rangeTo} onChange={event => setRangeTo(event.target.value)} disabled={resolved.loading} /></label>
            </>
          )}
        </div>

        <div className="kpi-material-detail-modal-scroll">
          {resolved.loading && <p className="kpi-material-detail-feedback" role="status">Actualizando el período…</p>}
          {resolved.error && !resolved.loading && (
            <p className="kpi-material-detail-feedback is-error" role="alert">
              No fue posible obtener los datos de este período.{' '}
              <button type="button" onClick={resolved.retry}>Reintentar</button>
            </p>
          )}
          {!resolved.material ? (
            <div className="kpi-material-detail-loading">
              {resolved.error && !resolved.loading ? 'Sin datos para este período.' : 'Cargando histórico del material…'}
            </div>
          ) : (
          <>
          <div className="kpi-material-detail-metrics">
            <Metric label="Referencias" value={formatNumber(references)} icon={<Icons.Package size={15} />} />
            <Metric label="Órdenes" value={formatNumber(orders)} icon={<Icons.FileText size={15} />} />
            <Metric label="Participación" value={`${participation}%`} icon={<Icons.ChartArea size={15} />} />
            <Metric label="Variación" value={trend.label} tone={trend.tone} icon={<Icons.ChartLine size={15} />} />
          </div>

          <div className="kpi-material-detail-distributions">
            <Distribution label="Tipo de orden" icon={<Icons.Orders size={15} />} firstLabel="911" firstValue={resolved.material.urgent_orders} secondLabel="Normal" secondValue={resolved.material.normal_orders} />
            <Distribution label="Origen del diseño" icon={<Icons.Paintbrush size={15} />} firstLabel="Interno" firstValue={resolved.material.internal_design_orders} secondLabel="Externo" secondValue={resolved.material.external_design_orders} />
          </div>

          <div className="kpi-material-detail-lists">
            <RankedList title="Clientes principales" icon={<Icons.User size={16} />} items={clients} emptyText="No hay clientes asociados en este período." />
            <RankedList title="Vendedores principales" icon={<Icons.Users size={16} />} items={sellers} emptyText="No hay vendedores asociados en este período." />
          </div>

          <section className="kpi-material-detail-trend">
            <div className="kpi-material-detail-trend-heading">
              <div><span className="kpi-material-detail-eyebrow">Actividad</span><h3>Tendencia de referencias</h3></div>
              <div className="kpi-material-detail-trend-toggle" role="group" aria-label="Tipo de gráfica de tendencia">
                <button type="button" className={chartType === 'bar' ? 'active' : ''} onClick={() => setChartType('bar')} aria-pressed={chartType === 'bar'} aria-label="Mostrar gráfica de barras"><Icons.BarChart size={14} />Barras</button>
                <button type="button" className={chartType === 'line' ? 'active' : ''} onClick={() => setChartType('line')} aria-pressed={chartType === 'line'} aria-label="Mostrar gráfica de línea"><Icons.ChartLine size={14} />Línea</button>
              </div>
            </div>
            {trendData.length > 1 ? (
              <div className="kpi-material-detail-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'bar' ? (
                    <BarChart data={trendData} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e7eef8" strokeDasharray="3 4" />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} minTickGap={26} tickFormatter={formatTrendDay} />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ border: '1px solid #dbe3ef', borderRadius: 8, boxShadow: '0 8px 20px rgba(15, 30, 64, .10)', color: '#0f1e40', fontSize: 12, fontWeight: 600 }} labelStyle={{ color: '#64748b', fontSize: 11 }} formatter={value => [formatNumber(value), 'Referencias']} labelFormatter={formatTrendDay} />
                      <Bar dataKey="count" name="Referencias" fill="#2454D9" radius={[5, 5, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  ) : (
                    <AreaChart data={trendData} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
                      <defs><linearGradient id="material-detail-trend" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#2454D9" stopOpacity={0.16} /><stop offset="95%" stopColor="#2454D9" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid vertical={false} stroke="#e7eef8" strokeDasharray="3 4" />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} minTickGap={26} tickFormatter={formatTrendDay} />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ border: '1px solid #dbe3ef', borderRadius: 8, boxShadow: '0 8px 20px rgba(15, 30, 64, .10)', color: '#0f1e40', fontSize: 12, fontWeight: 600 }} labelStyle={{ color: '#64748b', fontSize: 11 }} formatter={value => [formatNumber(value), 'Referencias']} labelFormatter={formatTrendDay} />
                      <Area type="monotone" dataKey="count" stroke="#2454D9" strokeWidth={2.25} fill="url(#material-detail-trend)" dot={{ r: 3.5, fill: '#fff', stroke: '#2454D9', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#2454D9', stroke: '#fff', strokeWidth: 2 }} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            ) : trendData.length === 1 ? (
              <div className="kpi-material-detail-trend-single" aria-label={`${formatNumber(trendData[0].count)} referencias el ${formatTrendDay(trendData[0].day)}`}>
                <span className="kpi-material-detail-trend-single-dot" aria-hidden="true" />
                <div><strong>{formatNumber(trendData[0].count)} referencia{Number(trendData[0].count) === 1 ? '' : 's'}</strong><span>{formatTrendDay(trendData[0].day)}</span></div>
                <p>Actividad registrada en un único día del período.</p>
              </div>
            ) : <p className="kpi-material-detail-empty">No hay tendencia diaria disponible para este período.</p>}
          </section>
          </>
          )}
        </div>
      </section>
    </div>,
    document.body
  )
}
