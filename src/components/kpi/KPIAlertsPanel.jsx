import { Icons } from '../../utils/icons'
import { getSeverityConfig } from '../../utils/kpiHelpers'

export default function KPIAlertsPanel({ data }) {
  if (!data) return null

  const alerts = data.smart_alerts || []

  const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }
  const sorted = [...alerts].sort((a, b) => (SEVERITY_ORDER[a.severity] || 2) - (SEVERITY_ORDER[b.severity] || 2))

  if (sorted.length === 0) {
    return (
      <div className="kpi-section">
        <div className="kpi-section-header">
          <div>
            <span className="kpi-section-kicker">Panel de Alertas</span>
            <h2 className="kpi-section-title">Alertas Inteligentes</h2>
            <p className="kpi-section-subtitle">Situaciones que requieren atención</p>
          </div>
        </div>
        <div className="kpi-card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="kpi-card-icon" style={{ background: '#ECFDF5', color: '#10B981', margin: '0 auto 16px', width: 48, height: 48 }}>
            <Icons.Check />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f1e40', marginBottom: 8 }}>Todo está bajo control</h3>
          <p style={{ fontSize: 13, color: '#8899B5', margin: 0 }}>No se detectaron situaciones críticas en este momento.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="kpi-section kpi-alerts-container">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Alertas</span>
          <h2 className="kpi-section-title">Alertas Inteligentes</h2>
          <p className="kpi-section-subtitle">{sorted.length} alerta{sorted.length !== 1 ? 's' : ''} activa{sorted.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div className="kpi-alerts-grid">
        {sorted.map((alert, idx) => {
          const config = getSeverityConfig(alert.severity)
          return (
            <div key={idx} className={`kpi-alert ${alert.severity}`}>
              <div className="kpi-alert-icon" style={{ background: config.bg, color: config.icon }}>
                {alert.severity === 'high' ? <Icons.AlertCircle /> : alert.severity === 'medium' ? <Icons.Clock /> : <Icons.CheckCircle />}
              </div>
              <div className="kpi-alert-content">
                <h4 className="kpi-alert-title">{alert.title}</h4>
                <p className="kpi-alert-message">{alert.message}</p>
                {alert.action && (
                  <span className="kpi-alert-action">{alert.action}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}