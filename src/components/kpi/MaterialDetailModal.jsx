import { useEffect, useMemo, useRef } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../utils/kpiHelpers'
import { Icons } from '../../utils/icons'

const EMPTY_ARRAY = Object.freeze([])

function Metric({ label, value, tone = 'default' }) {
  return (
    <div className={`kpi-material-detail-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Distribution({ label, firstLabel, firstValue, secondLabel, secondValue }) {
  const firstCount = Number(firstValue || 0)
  const secondCount = Number(secondValue || 0)
  const total = firstCount + secondCount
  const firstPercent = total ? Math.round((firstCount / total) * 100) : 0

  return (
    <section className="kpi-material-detail-distribution">
      <div className="kpi-material-detail-distribution-heading"><span>{label}</span><strong>{formatNumber(total)} órdenes</strong></div>
      <div className="kpi-material-detail-distribution-bar" aria-label={`${label}: ${firstLabel} ${firstCount}, ${secondLabel} ${secondCount}`}>
        <span style={{ width: `${firstPercent}%` }} />
      </div>
      <div className="kpi-material-detail-distribution-legend">
        <span><i className="is-primary" />{firstLabel} <strong>{formatNumber(firstCount)}</strong></span>
        <span><i />{secondLabel} <strong>{formatNumber(secondCount)}</strong></span>
      </div>
    </section>
  )
}

function RankedList({ title, icon, items, emptyText }) {
  return (
    <section className="kpi-material-detail-list">
      <h3>{icon}{title}</h3>
      {items.length ? (
        <ol>
          {items.slice(0, 5).map((item, index) => (
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

export default function MaterialDetailModal({ material, previousMaterial, totalReferences, onClose }) {
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)

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

  const trend = useMemo(() => {
    const current = Number(material?.reference_count ?? material?.total_orders ?? 0)
    const previous = Number(previousMaterial?.reference_count ?? previousMaterial?.total_orders ?? 0)
    if (!previous) return current ? { label: 'Nuevo en el período', tone: 'positive' } : { label: 'Sin cambios', tone: 'neutral' }
    const percent = Math.round(((current - previous) / previous) * 100)
    return percent > 0
      ? { label: `↑ +${percent}%`, tone: 'positive' }
      : percent < 0 ? { label: `↓ ${percent}%`, tone: 'negative' } : { label: 'Sin cambios', tone: 'neutral' }
  }, [material, previousMaterial])

  if (!material) return null
  const references = Number(material.reference_count ?? material.total_orders ?? 0)
  const orders = Number(material.total_orders || 0)
  const participation = totalReferences ? Math.round((references / totalReferences) * 100) : 0
  const trendData = Object.entries(material.daily || {}).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }))
  const clients = material.top_clients || EMPTY_ARRAY
  const sellers = material.top_sellers || EMPTY_ARRAY

  return (
    <div className="kpi-material-detail-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="kpi-material-detail-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="material-detail-title">
        <header className="kpi-material-detail-header">
          <span className="kpi-material-detail-icon"><Icons.Package /></span>
          <div>
            <span className="kpi-section-kicker">Detalle de material</span>
            <h2 id="material-detail-title">{material.name}</h2>
            <p>Uso registrado en las órdenes del período seleccionado.</p>
          </div>
          <button type="button" className="kpi-material-detail-close" onClick={onClose} aria-label={`Cerrar detalle de ${material.name}`} ref={closeButtonRef}><Icons.Close /></button>
        </header>

        <div className="kpi-material-detail-metrics">
          <Metric label="Referencias" value={formatNumber(references)} />
          <Metric label="Órdenes" value={formatNumber(orders)} />
          <Metric label="Participación" value={`${participation}%`} />
          <Metric label="Variación" value={trend.label} tone={trend.tone} />
        </div>

        <div className="kpi-material-detail-distributions">
          <Distribution label="Tipo de orden" firstLabel="911" firstValue={material.urgent_orders} secondLabel="Normal" secondValue={material.normal_orders} />
          <Distribution label="Origen del diseño" firstLabel="Interno" firstValue={material.internal_design_orders} secondLabel="Externo" secondValue={material.external_design_orders} />
        </div>

        <div className="kpi-material-detail-lists">
          <RankedList title="Clientes principales" icon={<Icons.User size={16} />} items={clients} emptyText="No hay clientes asociados en este período." />
          <RankedList title="Vendedores principales" icon={<Icons.Users size={16} />} items={sellers} emptyText="No hay vendedores asociados en este período." />
        </div>

        <section className="kpi-material-detail-trend">
          <div><span className="kpi-section-kicker">Actividad</span><h3>Tendencia de referencias</h3></div>
          {trendData.length ? (
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={trendData} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <defs><linearGradient id="material-detail-trend" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#2454D9" stopOpacity={0.22} /><stop offset="95%" stopColor="#2454D9" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} minTickGap={26} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#71809a' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={value => [formatNumber(value), 'Referencias']} labelFormatter={value => value} />
                <Area type="monotone" dataKey="count" stroke="#2454D9" strokeWidth={2.5} fill="url(#material-detail-trend)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="kpi-material-detail-empty">No hay tendencia diaria disponible para este período.</p>}
        </section>
      </section>
    </div>
  )
}
