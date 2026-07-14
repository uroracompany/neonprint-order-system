import { Icons } from '../../utils/icons'

export default function KPIHeader({ onRefresh, loading, title = "Dashboard KPI", subtitle = "Resumen ejecutivo del estado operativo del sistema" }) {
  return (
    <div className="kpi-banner">
      <div className="kpi-banner-content">
        <div className="kpi-banner-left">
          <span className="kpi-banner-kicker-badge">Panel Ejecutivo</span>
          <h1 className="kpi-title">{title}</h1>
          <p className="kpi-subtitle">{subtitle}</p>
        </div>

        <div className="kpi-banner-right">
          <button className="kpi-btn banner-refresh" onClick={onRefresh} disabled={loading}>
            {loading ? (
              <span className="kpi-spinner-sm" />
            ) : (
              <Icons.Refresh />
            )}
            {loading ? 'Cargando...' : 'Refrescar'}
          </button>
        </div>
      </div>
    </div>
  )
}
