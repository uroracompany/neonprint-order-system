import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'
import { formatNumber } from '../../utils/kpiHelpers'
import ChartTooltip from './ChartTooltip'

const GRID_STROKE = '#E8EDF8'
const AXIS_TICK_COLOR = '#71809a'
const PRIMARY_COLOR = '#1E40AF'
const COMPARISON_COLOR = '#94A3B8'

function formatTrendDay(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day))
}

function TrendChart({
  data,
  comparisonData,
  mode = 'line',
  height = 200,
  color = PRIMARY_COLOR,
  comparisonColor = COMPARISON_COLOR,
  dataKey = 'count',
  nameKey = 'day',
  tooltipFormatter = value => [formatNumber(value), 'Referencias'],
  showComparison = false,
  className = '',
  margin = { top: 14, right: 12, left: 0, bottom: 0 },
  maxBarSize = 36,
  labelFormatter = formatTrendDay,
}) {
  if (!data || data.length === 0) {
    return (
      <div className={`kpi-trend-chart-empty ${className}`} style={{ height }}>
        <p className="kpi-trend-empty-text">No hay datos de tendencia disponibles</p>
      </div>
    )
  }

  const hasComparison = showComparison && comparisonData && comparisonData.length > 0
  const chartData = data.map((item, index) => ({
    ...item,
    ...(hasComparison && comparisonData[index] ? { comparison: comparisonData[index][dataKey] } : {}),
  }))

  const commonProps = {
    data: chartData,
    margin,
    children: [
      <CartesianGrid key="grid" vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />,
      <XAxis
        key="xaxis"
        dataKey={nameKey}
        tickFormatter={labelFormatter}
        tick={{ fontSize: 11, fill: AXIS_TICK_COLOR }}
        tickLine={false}
        axisLine={false}
        minTickGap={26}
      />,
      <YAxis
        key="yaxis"
        allowDecimals={false}
        width={28}
        tick={{ fontSize: 11, fill: AXIS_TICK_COLOR }}
        tickLine={false}
        axisLine={false}
      />,
      <Tooltip
        key="tooltip"
        content={<ChartTooltip />}
        formatter={tooltipFormatter}
        labelFormatter={labelFormatter}
      />,
    ],
  }

  const renderContent = () => {
    switch (mode) {
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <defs>
              <linearGradient id="trendBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                <stop offset="100%" stopColor={color} stopOpacity={0.5} />
              </linearGradient>
            </defs>
            <Bar
              dataKey={dataKey}
              name="Referencias"
              fill="url(#trendBarGradient)"
              radius={[4, 4, 0, 0]}
              maxBarSize={maxBarSize}
            >
              {chartData.map((entry, index) => (
                <Cell key={`${nameKey}-${index}`} fill={entry.comparison !== undefined ? comparisonColor : color} />
              ))}
            </Bar>
            {hasComparison && (
              <ReferenceLine
                y={0}
                stroke={comparisonColor}
                strokeDasharray="5 5"
                strokeWidth={1}
                label={{ value: 'Período anterior', position: 'right', fill: comparisonColor, fontSize: 10 }}
              />
            )}
          </BarChart>
        )

      case 'line':
        return (
          <LineChart {...commonProps}>
            <Line
              type="monotone"
              dataKey={dataKey}
              name="Referencias"
              stroke={color}
              strokeWidth={2.5}
              dot={{ fill: color, r: 3, strokeWidth: 2, stroke: '#fff' }}
              activeDot={{ r: 5, strokeWidth: 2 }}
            />
            {hasComparison && (
              <Line
                type="monotone"
                dataKey="comparison"
                name="Período anterior"
                stroke={comparisonColor}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4, fill: comparisonColor }}
              />
            )}
          </LineChart>
        )

      case 'area':
      default:
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="trendAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
              {hasComparison && (
                <linearGradient id="trendAreaComparisonGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={comparisonColor} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={comparisonColor} stopOpacity={0} />
                </linearGradient>
              )}
            </defs>
            <Area
              type="monotone"
              dataKey={dataKey}
              name="Referencias"
              stroke={color}
              strokeWidth={2}
              fill="url(#trendAreaGradient)"
            />
            {hasComparison && (
              <Area
                type="monotone"
                dataKey="comparison"
                name="Período anterior"
                stroke={comparisonColor}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                fill="url(#trendAreaComparisonGradient)"
              />
            )}
          </AreaChart>
        )
    }
  }

  return (
    <div className={`kpi-trend-chart-wrapper ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {renderContent()}
      </ResponsiveContainer>
    </div>
  )
}

export default TrendChart
