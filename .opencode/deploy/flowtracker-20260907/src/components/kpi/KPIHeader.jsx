import { Icons } from '../../utils/icons'

export default function KPIHeader({ meta, title = 'Dashboard KPI', subtitle = 'Resumen ejecutivo verificable del estado operativo' }) {
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
      </div>
    </div>
  )
}
