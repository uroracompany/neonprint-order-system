import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatNumber, KPI_CHART_COLORS } from '../../utils/kpiHelpers'

function DonutChart({
  data,
  innerRadius = 52,
  outerRadius = 82,
  paddingAngle = 2,
  colors = KPI_CHART_COLORS,
  showTooltip = true,
  showLegend = true,
  label,
  totalLabel = 'Total',
  className = '',
  height = 180,
}) {
  if (!data || data.length === 0) {
    return (
      <div className={`kpi-donut-chart-empty ${className}`} style={{ height }}>
        <p className="kpi-donut-empty-text">No hay datos disponibles</p>
      </div>
    )
  }

  const total = data.reduce((sum, item) => sum + (Number(item.value) || 0), 0)
  const validData = data.filter(item => Number(item.value) > 0)

  if (validData.length === 0) {
    return (
      <div className={`kpi-donut-chart-empty ${className}`} style={{ height }}>
        <p className="kpi-donut-empty-text">No hay datos disponibles</p>
      </div>
    )
  }

  return (
    <div className={`kpi-donut-chart-wrapper ${className}`}>
      <div className="kpi-donut-chart-container" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={validData}
              dataKey="value"
              nameKey="name"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={paddingAngle}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {validData.map((entry, index) => (
                <Cell key={entry.name} fill={entry.color || colors[index % colors.length]} />
              ))}
            </Pie>
            {showTooltip && (
              <Tooltip
                formatter={(value, name) => [formatNumber(value), name || 'Valor']}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #dbe3ef',
                  borderRadius: 8,
                  boxShadow: '0 8px 20px rgba(15, 30, 64, 0.10)',
                  padding: '8px 12px',
                }}
                labelStyle={{ color: '#0f1e40', fontWeight: 600 }}
                itemStyle={{ fontWeight: 500 }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      </div>

      {showLegend && (
        <div className="kpi-donut-legend" role="list" aria-label={label || 'Leyenda'}>
          {validData.map((entry, index) => (
            <div key={entry.name} className="kpi-donut-legend-item" role="listitem">
              <span className="kpi-donut-legend-color" style={{ backgroundColor: entry.color || colors[index % colors.length] }} />
              <span className="kpi-donut-legend-label">{entry.name}</span>
              <strong className="kpi-donut-legend-value">{formatNumber(entry.value)}</strong>
            </div>
          ))}
        </div>
      )}

      {label && (
        <div className="kpi-donut-total" aria-live="polite">
          <span className="kpi-donut-total-label">{label}</span>
          <span className="kpi-donut-total-value">{totalLabel}: {formatNumber(total)}</span>
        </div>
      )}
    </div>
  )
}

export default DonutChart