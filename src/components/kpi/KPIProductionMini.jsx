import { formatDays } from '../../utils/kpiHelpers'

const AREA_CONFIG = {
  digital: { label: 'Digital', color: '#06B6D4' },
  dtf: { label: 'DTF', color: '#F43F5E' },
  ploteo: { label: 'Ploteo', color: '#F59E0B' },
}

export default function KPIProductionMini({ data }) {
  if (!data) return null

  const areaLoad = data.production_insights?.area_load || {}
  const stageTiming = data.production_insights?.stage_timing || {}
  const bottlenecks = data.production_insights?.bottlenecks || []

  const areaEntries = Object.entries(areaLoad)
  const totalActive = areaEntries.reduce((sum, [, stats]) => sum + (stats.pending || 0) + (stats.in_production || 0) + (stats.in_termination || 0), 0)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Producción</span>
          <h2 className="kpi-section-title">Producción y Tiempos</h2>
          <p className="kpi-section-subtitle">Carga por área y tiempos promedio por etapa</p>
        </div>
      </div>

      <div className="kpi-prod-mini-grid">
        <div className="kpi-prod-mini-card">
          <h4 className="kpi-prod-mini-title">Carga por Área</h4>
          <div className="kpi-prod-mini-areas">
            {areaEntries.map(([code, stats]) => {
              const config = AREA_CONFIG[code] || { label: code, color: '#6B7280' }
              const active = (stats.pending || 0) + (stats.in_production || 0) + (stats.in_termination || 0)
              return (
                <div key={code} className="kpi-prod-mini-area">
                  <div className="kpi-prod-mini-area-header">
                    <span className="kpi-prod-mini-area-dot" style={{ background: config.color }} />
                    <span className="kpi-prod-mini-area-label">{config.label}</span>
                    <span className="kpi-prod-mini-area-count" style={{ color: config.color }}>{active}</span>
                  </div>
                  <div className="kpi-prod-mini-area-bar">
                    <div
                      className="kpi-prod-mini-area-bar-fill"
                      style={{
                        width: `${totalActive > 0 ? (active / totalActive) * 100 : 0}%`,
                        background: config.color,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="kpi-prod-mini-card">
          <h4 className="kpi-prod-mini-title">Tiempo por Etapa</h4>
          <div className="kpi-prod-mini-timing">
            <div className="kpi-prod-mini-timing-item">
              <span className="kpi-prod-mini-timing-label">Diseño → Caja</span>
              <span className="kpi-prod-mini-timing-value">{formatDays(stageTiming.design_to_quote)}</span>
            </div>
            <div className="kpi-prod-mini-timing-item">
              <span className="kpi-prod-mini-timing-label">Caja → Producción</span>
              <span className="kpi-prod-mini-timing-value">{formatDays(stageTiming.quote_to_production)}</span>
            </div>
            <div className="kpi-prod-mini-timing-item">
              <span className="kpi-prod-mini-timing-label">Producción → Terminación</span>
              <span className="kpi-prod-mini-timing-value">{formatDays(stageTiming.production_to_termination)}</span>
            </div>
            <div className="kpi-prod-mini-timing-item">
              <span className="kpi-prod-mini-timing-label">Terminación → Completado</span>
              <span className="kpi-prod-mini-timing-value">{formatDays(stageTiming.termination_to_completion)}</span>
            </div>
          </div>

          {bottlenecks.length > 0 && (
            <div className="kpi-prod-mini-bottleneck">
              <span className="kpi-prod-mini-bottleneck-icon">⚠</span>
              <span>{bottlenecks.length} cuello{bottlenecks.length !== 1 ? 's' : ''} de botella</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
