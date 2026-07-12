import { useState } from 'react'
import { Icons } from '../../utils/icons'
import { formatNumber, getTrendConfig } from '../../utils/kpiHelpers'

export default function KPITrendIndicator({ value, previous, label, icon, size = 'medium' }) {
  const trend = getTrendConfig(value, previous)
  const sizeClasses = {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
  }

  return (
    <div className="kpi-card" style={{ borderColor: trend.color }}>
      <div className="kpi-card-header">
        <div className="kpi-card-title">{label}</div>
        <div className="kpi-card-icon" style={{ background: trend.bg, color: trend.color }}>
          {icon}
        </div>
      </div>
      <div className="kpi-card-value" style={{ color: trend.color }}>{formatNumber(value)}</div>
      <div className="kpi-card-label">{label}</div>
      <div className="kpi-card-trend" style={{ color: trend.color }}>
        <span>{trend.arrow}</span>
        {trend.change !== '0.0' && <span>{Math.abs(trend.change)}%</span>}
      </div>
    </div>
  )
}