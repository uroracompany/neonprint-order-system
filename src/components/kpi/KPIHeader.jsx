import { Icons } from '../../utils/icons'
import { FilterSelect } from '../ui/FilterSelect'

const PERIODS = [
  { value: 'general', label: 'General' },
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: '3months', label: 'Últimos 3 meses' },
  { value: 'year', label: 'Este año' },
  { value: 'custom', label: 'Personalizado' },
]

export default function KPIHeader({ onRefresh, loading, period, onPeriodChange, customDateFrom, customDateTo, meta, title = 'Dashboard KPI', subtitle = 'Resumen ejecutivo verificable del estado operativo' }) {
  const updateCustomDate = (field, value) => {
    onPeriodChange('custom', field === 'from' ? value : customDateFrom, field === 'to' ? value : customDateTo)
  }

  return (
    <div className="kpi-banner">
      <div className="kpi-banner-content">
        <div className="kpi-banner-left">
          <span className="acm-badge info kpi-banner-kicker-badge"><Icons.Dashboard />Panel Ejecutivo</span>
          <h1 className="kpi-title">{title}</h1>
          <div className="kpi-banner-meta" aria-label="Estado del resumen ejecutivo">
            <span className="kpi-banner-meta-badge is-verified"><Icons.Check />{subtitle}</span>
            {meta?.generated_at && <span className="kpi-banner-meta-badge is-updated"><Icons.Clock />Datos actualizados: {new Date(meta.generated_at).toLocaleString('es-PY')}</span>}
          </div>
        </div>

        <div className="kpi-banner-right">
          <div className="kpi-banner-period-control">
            <span className="kpi-label">Período de rendimiento</span>
            <FilterSelect icon={<Icons.Calendar />} value={period} onChange={onPeriodChange} options={PERIODS} label="Período de rendimiento" disabled={loading} isActive={period !== 'general'} />
          </div>
          {period === 'custom' && (
            <>
              <label className="kpi-label">Desde<input className="kpi-input" type="date" value={customDateFrom} onChange={event => updateCustomDate('from', event.target.value)} disabled={loading} /></label>
              <label className="kpi-label">Hasta<input className="kpi-input" type="date" value={customDateTo} onChange={event => updateCustomDate('to', event.target.value)} disabled={loading} /></label>
            </>
          )}
          <button className="kpi-btn banner-refresh" onClick={onRefresh} disabled={loading}>
            {loading ? <span className="kpi-spinner-sm" /> : <Icons.Refresh />}
            {loading ? 'Cargando...' : 'Refrescar'}
          </button>
        </div>
      </div>
    </div>
  )
}
