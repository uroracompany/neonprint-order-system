import { formatNumber } from '../../utils/kpiHelpers'

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null

  const item = payload[0]
  const value = item.value
  const name = item.name || item.dataKey || 'Valor'
  const color = item.color || '#1E40AF'

  return (
    <div className="kpi-chart-tooltip" style={{ borderLeft: `3px solid ${color}` }}>
      <p className="kpi-chart-tooltip-label">{label}</p>
      <p className="kpi-chart-tooltip-value">
        <span className="kpi-chart-tooltip-color" style={{ backgroundColor: color }} />
        {name}: {formatNumber(value)}
      </p>
    </div>
  )
}

export default ChartTooltip