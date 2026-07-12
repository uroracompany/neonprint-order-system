import { Icons } from '../../utils/icons'

export default function KPISlaIndicator({ data }) {
  if (!data) return null

  const sla = data.sla_violations || {}
  const summary = sla.summary || {}
  const violations = sla.violations?.orders || []
  const criticalCount = summary.critical || 0
  const warningCount = summary.warning || 0
  const totalCount = summary.total || 0

  if (totalCount === 0) {
    return (
      <div className="kpi-sla-card kpi-sla-ok">
        <div className="kpi-sla-icon">
          <Icons.CheckCircle />
        </div>
        <div className="kpi-sla-content">
          <h4 className="kpi-sla-title">SLA Cumplido</h4>
          <p className="kpi-sla-message">Ninguna orden excede los tiempos establecidos</p>
        </div>
      </div>
    )
  }

  return (
    <div className="kpi-sla-card kpi-sla-alert">
      <div className="kpi-sla-header">
        <div className="kpi-sla-icon-alert">
          <Icons.AlertCircle />
        </div>
        <div>
          <h4 className="kpi-sla-title">Violaciones de SLA</h4>
          <p className="kpi-sla-subtitle">{totalCount} orden{totalCount !== 1 ? 'es' : ''} exced{totalCount === 1 ? 'e' : 'en'} los tiempos</p>
        </div>
      </div>

      <div className="kpi-sla-counts">
        {criticalCount > 0 && (
          <div className="kpi-sla-count critical">
            <span className="kpi-sla-count-value">{criticalCount}</span>
            <span className="kpi-sla-count-label">Críticas</span>
          </div>
        )}
        {warningCount > 0 && (
          <div className="kpi-sla-count warning">
            <span className="kpi-sla-count-value">{warningCount}</span>
            <span className="kpi-sla-count-label">Advertencia</span>
          </div>
        )}
      </div>

      {violations.length > 0 && (
        <div className="kpi-sla-list">
          {violations.slice(0, 5).map((v, idx) => (
            <div key={idx} className={`kpi-sla-item ${v.severity}`}>
              <div className="kpi-sla-item-info">
                <span className="kpi-sla-item-name">{v.client_name || 'Sin nombre'}</span>
                <span className="kpi-sla-item-stage">{v.status}</span>
              </div>
              <div className="kpi-sla-item-hours">
                {Math.round(v.hours_in_stage)}h
                <span className="kpi-sla-item-limit">/ {v.critical_hours}h</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
