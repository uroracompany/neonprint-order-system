import { formatNumber } from '../../utils/kpiHelpers'

function RankingRow({
  rank,
  name,
  value,
  subtitle,
  avatar,
  percentage,
  trend,
  className = '',
  onClick,
}) {
  const displayValue = formatNumber(value)
  const displayPercentage = percentage !== undefined ? `${formatNumber(percentage)}%` : null

  return (
    <div
      className={`kpi-ranking-row ${className}`}
      role="listitem"
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      <div className="kpi-ranking-rank">
        <span>{rank}</span>
      </div>

      <div className="kpi-ranking-info">
        {avatar && (
          <div className="kpi-ranking-avatar">
            {typeof avatar === 'string' ? (
              <img src={avatar} alt="" className="kpi-ranking-avatar-img" />
            ) : (
              avatar
            )}
          </div>
        )}
        <div className="kpi-ranking-text">
          <strong className="kpi-ranking-name">{name || 'Sin nombre'}</strong>
          {subtitle && <span className="kpi-ranking-subtitle">{subtitle}</span>}
        </div>
      </div>

      <div className="kpi-ranking-metrics">
        <span className="kpi-ranking-value">{displayValue}</span>
        {displayPercentage && <span className="kpi-ranking-percentage">{displayPercentage}</span>}
        {trend && (
          <span className={`kpi-ranking-trend ${trend.direction}`}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
          </span>
        )}
      </div>
    </div>
  )
}

export default RankingRow