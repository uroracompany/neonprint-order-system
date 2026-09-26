import { COMPARISON_COLORS, getComparisonDelta, getPeakComparisonColor, getPreviousPeriodPeak } from './materialsComparisonColors'

const DAY_MS = 86400000

const formatShortDate = value => new Date(value).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
const rangeDays = bounds => Math.max(1, Math.round((new Date(bounds.date_to) - new Date(bounds.date_from)) / DAY_MS))

function timelineToBucketMap(timeline) {
  return new Map((timeline || []).map(item => [Number(item.bucket_index), item]))
}

function getComparisonTone(current, previous) {
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'flat'
}

function getObservableBucketCount(bounds, granularity) {
  const start = new Date(bounds.date_from)
  const end = new Date(bounds.date_to)
  const now = new Date()
  const totalBuckets = Math.ceil(rangeDays(bounds) / granularity.size)

  if (now >= end) return totalBuckets
  if (now < start) return 0

  const observedDays = Math.floor((now.getTime() - start.getTime()) / DAY_MS) + 1
  return Math.min(totalBuckets, Math.ceil(observedDays / granularity.size))
}

function buildCurrentGradientStops(rows) {
  const observableRows = rows
    .map((row, index) => ({ ...row, index }))
    .filter(row => row.periodA !== null)

  if (observableRows.length <= 1) {
    const color = observableRows[0]?.comparisonColor || COMPARISON_COLORS.flat
    return [{ offset: '0%', color }, { offset: '100%', color }]
  }
  const lastIndex = rows.length - 1
  return observableRows.map(row => ({ offset: `${(row.index / lastIndex) * 100}%`, color: row.comparisonColor }))
}

export function getMaterialComparisonShares(currentValue, previousValue) {
  const current = Number(currentValue) || 0
  const previous = Number(previousValue) || 0
  const total = current + previous
  return {
    current: total ? Math.round((current / total) * 100) : 0,
    previous: total ? Math.round((previous / total) * 100) : 0,
    tone: getComparisonTone(current, previous),
  }
}

export function buildMaterialComparisonChartRows(currentTimeline, previousTimeline, bounds, metricKey, granularity) {
  const totalDays = rangeDays(bounds)
  const buckets = Math.ceil(totalDays / granularity.size)
  const currentMap = timelineToBucketMap(currentTimeline)
  const previousMap = timelineToBucketMap(previousTimeline)
  const currentStart = new Date(bounds.date_from)
  const previousStart = new Date(bounds.compare_from)
  const observableCurrentBuckets = getObservableBucketCount(bounds, granularity)

  const rows = Array.from({ length: buckets }, (_, bucketIndex) => {
    const offset = bucketIndex * granularity.size
    const currentDate = new Date(currentStart.getTime() + offset * DAY_MS)
    const previousDate = new Date(previousStart.getTime() + offset * DAY_MS)
    const periodA = bucketIndex < observableCurrentBuckets
      ? Number(currentMap.get(bucketIndex)?.[metricKey] || 0)
      : null
    const periodB = Number(previousMap.get(bucketIndex)?.[metricKey] || 0)
    return {
      label: granularity.key === 'day' ? formatShortDate(currentDate) : `${granularity.key === 'week' ? 'Sem' : 'Mes'} ${bucketIndex + 1}`,
      periodA,
      periodB,
      periodALabel: formatShortDate(currentDate),
      periodBLabel: formatShortDate(previousDate),
    }
  })

  const previousPeak = getPreviousPeriodPeak(rows.map(row => row.periodB))
  const coloredRows = rows.map(row => ({
    ...row,
    comparisonTone: getComparisonTone(row.periodA ?? 0, previousPeak),
    comparisonReference: previousPeak,
    comparisonDelta: row.periodA === null || previousPeak <= 0 ? null : getComparisonDelta(row.periodA, previousPeak),
    comparisonColor: row.periodA === null ? COMPARISON_COLORS.flat : getPeakComparisonColor(row.periodA, previousPeak),
  }))

  return { granularity, previousPeak, rows: coloredRows, currentGradientStops: buildCurrentGradientStops(coloredRows) }
}
