export const COMPARISON_COLORS = Object.freeze({ up: '#16a34a', down: '#dc2626', flat: '#2454d9', previous: '#94a3b8' })

const NEGATIVE_COMPARISON_SCALE = Object.freeze([
  { value: -40, color: COMPARISON_COLORS.down },
  { value: -30, color: '#f97316' },
  { value: -20, color: '#eab308' },
  { value: -10, color: '#84cc16' },
  { value: 0, color: COMPARISON_COLORS.up },
])

function hexToRgb(hex) {
  const normalized = hex.replace('#', '')
  return [0, 2, 4].map(offset => Number.parseInt(normalized.slice(offset, offset + 2), 16))
}

function interpolateColor(first, second, progress) {
  const start = hexToRgb(first)
  const end = hexToRgb(second)
  const amount = Math.min(1, Math.max(0, progress))
  return `#${start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`
}

function colorFromScale(value, scale) {
  const first = scale[0]
  const last = scale[scale.length - 1]
  if (value <= first.value) return first.color
  if (value >= last.value) return last.color
  const upperIndex = scale.findIndex(stop => stop.value >= value)
  const upper = scale[upperIndex]
  const lower = scale[upperIndex - 1]
  return interpolateColor(lower.color, upper.color, (value - lower.value) / (upper.value - lower.value))
}

export function getComparisonDelta(current, previous) {
  if (previous === 0) return current === 0 ? 0 : 100
  return ((current - previous) / previous) * 100
}

export function getPreviousPeriodPeak(values) {
  return values.reduce((peak, value) => Math.max(peak, Number(value) || 0), 0)
}

export function getComparisonColor(current, previous) {
  const difference = getComparisonDelta(current, previous)
  if (Math.abs(difference) < 0.0001) return COMPARISON_COLORS.flat
  if (difference < 0) return colorFromScale(difference, NEGATIVE_COMPARISON_SCALE)
  if (difference >= 10) return COMPARISON_COLORS.up
  return interpolateColor(COMPARISON_COLORS.flat, COMPARISON_COLORS.up, difference / 10)
}

export function getPeakComparisonColor(current, previousPeak) {
  const peak = Number(previousPeak) || 0
  if (peak <= 0) return COMPARISON_COLORS.flat

  const difference = getComparisonDelta(current, peak)
  if (difference <= -40) return COMPARISON_COLORS.down
  if (difference >= 10) return COMPARISON_COLORS.up
  return COMPARISON_COLORS.flat
}

export { NEGATIVE_COMPARISON_SCALE }
