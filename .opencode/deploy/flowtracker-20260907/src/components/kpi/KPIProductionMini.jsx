import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatDays } from '../../utils/kpiHelpers'

const AREA_CONFIG = {
  digital: { label: 'Digital', color: '#06B6D4' },
  dtf: { label: 'DTF', color: '#F43F5E' },
  ploteo: { label: 'Ploteo', color: '#F59E0B' },
}

function LoadTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const area = payload[0].payload
  return <div className="kpi-production-tooltip"><strong>{area.label}</strong><span>{area.active} archivo{area.active === 1 ? '' : 's'} abierto{area.active === 1 ? '' : 's'}</span></div>
}

const displayTiming = (label, value) => value !== null && value !== undefined && Number.isFinite(Number(value))
  ? label.includes('Cuellos') ? value : formatDays(Number(value))
  : 'N/D'

export default function KPIProductionMini({ data }) {
  const production = data?.executive_summary?.snapshot?.production
  const stageTiming = data?.executive_summary?.period?.production_stage_timing || {}
  if (!production) return null

  const areas = Object.entries(production.area_load || {}).map(([code, counts]) => {
    const config = AREA_CONFIG[code] || { label: code.replaceAll('_', ' '), color: '#64748B' }
    return { code, label: config.label, color: config.color, active: Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0) }
  })
  const timingCards = [
    ['Diseño → Caja', stageTiming.design_to_quote, <Icons.Brush />],
    ['Caja → Producción', stageTiming.quote_to_production, <Icons.FileText />],
    ['Producción → Terminación', stageTiming.production_to_termination, <Icons.Package />],
    ['Terminación → Completado', stageTiming.termination_to_completion, <Icons.Check />],
    ['Cuellos de botella >3 días', production.bottleneck_count, <Icons.AlertCircle />],
  ]

  return (
    <div className="kpi-section">
      <div className="kpi-section-header"><div><span className="kpi-section-kicker">Foto de producción</span><h2 className="kpi-section-title">Carga actual por área</h2><p className="kpi-section-subtitle">Archivos abiertos actualmente, sin depender de cuándo fueron creados.</p></div></div>
      <div className="kpi-prod-mini-grid">
        <article className="kpi-prod-mini-card kpi-production-load-card">
          <div className="kpi-executive-card-heading"><div><h4 className="kpi-prod-mini-title">Carga por área</h4><span>Archivos abiertos actualmente</span></div><span className="kpi-executive-count-badge">{areas.reduce((sum, area) => sum + area.active, 0)} activos</span></div>
          {areas.length === 0 ? <p className="kpi-empty-message">No hay archivos abiertos en producción.</p> : <div className="kpi-production-chart" role="img" aria-label="Carga de archivos abiertos por área de producción"><ResponsiveContainer width="100%" height="100%"><BarChart data={areas} margin={{ top: 12, right: 6, left: -24, bottom: 0 }}><CartesianGrid stroke="#e8edf8" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip content={<LoadTooltip />} /><Bar dataKey="active" radius={[8, 8, 0, 0]}>{areas.map(area => <Cell key={area.code} fill={area.color} />)}</Bar></BarChart></ResponsiveContainer></div>}
        </article>
        <article className="kpi-prod-mini-card kpi-production-timing-card"><div className="kpi-executive-card-heading"><div><h4 className="kpi-prod-mini-title">Tiempos verificables</h4><span>Solo secuencias auditables</span></div><span className="kpi-executive-count-badge is-info"><Icons.Check />Trazabilidad</span></div><div className="kpi-prod-mini-timing-grid">{timingCards.map(([label, value, icon]) => <div className="kpi-prod-mini-timing-item" key={label}><span className="kpi-prod-mini-timing-icon">{icon}</span><span className="kpi-prod-mini-timing-label">{label}</span><strong className="kpi-prod-mini-timing-value">{displayTiming(label, value)}</strong></div>)}</div><p className="kpi-card-subtitle">N/D indica que no existe una secuencia de eventos válida para calcular el tiempo.</p></article>
      </div>
    </div>
  )
}
