import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialsComparisonPanel from '../components/kpi/MaterialsComparisonPanel'
import { useKPISingle } from '../hooks/useKPI'
import { getComparisonColor, getComparisonDelta, getPeakComparisonColor } from '../utils/materialsComparisonColors'
import { buildMaterialComparisonChartRows, getMaterialComparisonShares } from '../utils/materialsComparisonChart'

vi.mock('../hooks/useKPI', () => ({ useKPISingle: vi.fn() }))
vi.mock('../components/ui/FilterSelect', () => ({
  FilterSelect: ({ label, onChange, options, value }) => <div data-testid={`filter-${label}`}><span>{value}</span>{options.map(option => <button key={option.value} type="button" onClick={() => onChange(option.value)}>{option.label}</button>)}</div>,
}))

const zeroMetrics = {
  references: 0,
  orders_with_material: 0,
  materials_used: 0,
  normal_orders: 0,
  urgent_orders: 0,
  internal_orders: 0,
  external_orders: 0,
}

function renderPanel() {
  return render(<MaterialsComparisonPanel userId="admin-1" />)
}

const getLatestRequest = () => useKPISingle.mock.calls.at(-1)[1]
const expectEquivalentPeriods = request => {
  expect(new Date(request.date_to) - new Date(request.date_from)).toBe(new Date(request.compare_to) - new Date(request.compare_from))
  expect(new Date(request.date_from).getTime()).toBeLessThan(new Date(request.date_to).getTime())
  expect(new Date(request.compare_from).getTime()).toBeLessThan(new Date(request.compare_to).getTime())
}

describe('MaterialsComparisonPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })

  afterEach(() => vi.useRealTimers())

  it('inicia en mes y construye una consulta autónoma con períodos equivalentes', () => {
    useKPISingle.mockReturnValue({ data: null, loading: true, fetching: false, error: null, errorInfo: null, isPlaceholderData: false, refresh: vi.fn() })

    renderPanel()

    const request = getLatestRequest()
    expect(screen.getByTestId('filter-Base temporal')).toHaveTextContent('month')
    expect(request.date_from.slice(0, 10)).toBe('2026-03-01')
    expect(request.granularity).toBe('day')
    expectEquivalentPeriods(request)
  })

  it('calcula week, 2months y 3months con rangos válidos de igual duración', () => {
    useKPISingle.mockReturnValue({ data: null, loading: true, fetching: false, error: null, errorInfo: null, isPlaceholderData: false, refresh: vi.fn() })
    renderPanel()

    for (const label of ['Esta semana vs. semana anterior', 'Últimos 2 meses vs. los 2 anteriores', 'Últimos 3 meses vs. los 3 anteriores']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expectEquivalentPeriods(getLatestRequest())
    }

    expect(getLatestRequest().granularity).toBe('week')
  })

  it('ignora por completo rangos y datos externos del KPI superior', () => {
    useKPISingle.mockReturnValue({ data: null, loading: true, fetching: false, error: null, errorInfo: null, isPlaceholderData: false, refresh: vi.fn() })
    const { rerender } = renderPanel()
    const initialRequest = getLatestRequest()

    rerender(<MaterialsComparisonPanel userId="admin-1" globalBounds={{ date_from: '1970-01-01T00:00:00.000Z', date_to: '2026-03-16T00:00:00.000Z', compare_from: '1970-01-01T00:00:00.000Z', compare_to: '1970-01-01T00:00:00.000Z' }} fallbackAnalytics={{ period: { summary: [{ material_id: 1, name: 'No debe usarse' }] } }} />)

    expect(getLatestRequest()).toEqual(initialRequest)
    expect(screen.queryByText('No debe usarse')).not.toBeInTheDocument()
  })

  it('does not render false zero metrics when the comparison source fails', () => {
    useKPISingle.mockReturnValue({
      data: null,
      loading: false,
      fetching: false,
      error: 'source unavailable',
      errorInfo: { code: 'MATERIALS_COMPARISON_SOURCE_UNAVAILABLE' },
      isPlaceholderData: false,
      refresh: vi.fn(),
    })

    renderPanel()

    expect(screen.getByText('Datos de comparación no disponibles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(screen.queryByText('vs. 0 en el período anterior')).not.toBeInTheDocument()
  })

  it('renders zeros only when the RPC explicitly returns a valid empty result', () => {
    useKPISingle.mockReturnValue({
      data: { period: { metrics: zeroMetrics, timeline: [] }, comparison: { metrics: zeroMetrics, timeline: [] }, materials: [] },
      loading: false,
      fetching: false,
      error: null,
      errorInfo: null,
      isPlaceholderData: false,
      refresh: vi.fn(),
    })

    const { container } = renderPanel()

    expect(screen.queryByText('Datos de comparación no disponibles')).not.toBeInTheDocument()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getByText(/No hay datos de referencias registradas/i)).toBeInTheDocument()
    expect(container.querySelectorAll('.kpi-materials-compare-split-bar.is-empty')).toHaveLength(2)
    expect(container.querySelectorAll('.kpi-materials-compare-split-segment')).toHaveLength(0)
  })

  it('uses the exact category colors in split bars and legends', () => {
    useKPISingle.mockReturnValue({
      data: {
        period: {
          metrics: { ...zeroMetrics, normal_orders: 7, urgent_orders: 3, internal_orders: 6, external_orders: 4 },
          timeline: [],
        },
        comparison: {
          metrics: { ...zeroMetrics, normal_orders: 2, urgent_orders: 1, internal_orders: 2, external_orders: 1 },
          timeline: [],
        },
        materials: [],
      },
      loading: false,
      fetching: false,
      error: null,
      errorInfo: null,
      isPlaceholderData: false,
      refresh: vi.fn(),
    })

    const { container } = renderPanel()
    const bars = container.querySelectorAll('.kpi-materials-compare-split-bar')
    const orderSegments = bars[0].querySelectorAll('.kpi-materials-compare-split-segment')
    const designSegments = bars[1].querySelectorAll('.kpi-materials-compare-split-segment')
    const dots = container.querySelectorAll('.kpi-materials-compare-split-dot')

    expect(orderSegments[0]).toHaveStyle({ width: '30%' })
    expect(orderSegments[1]).toHaveStyle({ width: '70%' })
    expect(orderSegments[0].style.getPropertyValue('--split-color')).toBe('#F43F5E')
    expect(orderSegments[1].style.getPropertyValue('--split-color')).toBe('#2454D9')
    expect(designSegments[0].style.getPropertyValue('--split-color')).toBe('#2454D9')
    expect(designSegments[1].style.getPropertyValue('--split-color')).toBe('#F43F5E')
    expect(Array.from(dots, dot => dot.style.getPropertyValue('--split-color'))).toEqual([
      '#F43F5E', '#2454D9', '#2454D9', '#F43F5E',
    ])
  })

  it('keeps the remaining category color when its counterpart has no records', () => {
    useKPISingle.mockReturnValue({
      data: {
        period: {
          metrics: { ...zeroMetrics, normal_orders: 5, internal_orders: 4 },
          timeline: [],
        },
        comparison: { metrics: zeroMetrics, timeline: [] },
        materials: [],
      },
      loading: false,
      fetching: false,
      error: null,
      errorInfo: null,
      isPlaceholderData: false,
      refresh: vi.fn(),
    })

    const { container } = renderPanel()
    const bars = container.querySelectorAll('.kpi-materials-compare-split-bar')
    const orderSegments = bars[0].querySelectorAll('.kpi-materials-compare-split-segment')
    const designSegments = bars[1].querySelectorAll('.kpi-materials-compare-split-segment')

    expect(orderSegments[0]).toHaveStyle({ width: '0%' })
    expect(orderSegments[1]).toHaveStyle({ width: '100%' })
    expect(orderSegments[1].style.getPropertyValue('--split-color')).toBe('#2454D9')
    expect(designSegments[0]).toHaveStyle({ width: '100%' })
    expect(designSegments[1]).toHaveStyle({ width: '0%' })
    expect(designSegments[0].style.getPropertyValue('--split-color')).toBe('#2454D9')
  })

  it('uses the comparison outcome to color the current period share', () => {
    useKPISingle.mockReturnValue({
      data: {
        period: { metrics: { ...zeroMetrics, references: 4 }, timeline: [{ bucket_index: 0, references: 3, orders_with_material: 3, materials_used: 1 }, { bucket_index: 1, references: 1, orders_with_material: 1, materials_used: 1 }] },
        comparison: { metrics: { ...zeroMetrics, references: 2 }, timeline: [{ bucket_index: 0, references: 1, orders_with_material: 1, materials_used: 1 }, { bucket_index: 1, references: 1, orders_with_material: 1, materials_used: 1 }] },
        materials: [],
      },
      loading: false,
      fetching: false,
      error: null,
      errorInfo: null,
      isPlaceholderData: false,
      refresh: vi.fn(),
    })

    renderPanel()

    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText('67%').closest('span')).toHaveClass('is-up')
  })

  it('preserves absent future buckets instead of representing them as zero activity', () => {
    const bounds = {
      date_from: '2026-03-01T00:00:00.000Z',
      date_to: '2026-04-01T00:00:00.000Z',
      compare_from: '2026-01-29T00:00:00.000Z',
      compare_to: '2026-03-01T00:00:00.000Z',
    }
    const chart = buildMaterialComparisonChartRows(
      [{ bucket_index: 0, references: 2 }, { bucket_index: 14, references: 3 }],
      [{ bucket_index: 0, references: 4 }, { bucket_index: 15, references: 1 }],
      bounds,
      'references',
      { key: 'day', size: 1 },
    )

    expect(chart.rows[14].periodA).toBe(3)
    expect(chart.rows[15]).toMatchObject({ periodA: null, periodB: 1 })
    expect(chart.currentGradientStops).toHaveLength(15)
    expect(chart.currentGradientStops[0]).toEqual({ offset: '0%', color: '#dc2626' })
    expect(chart.currentGradientStops[14]).toEqual({ offset: `${(14 / 30) * 100}%`, color: '#2454d9' })
  })

  it('calculates variety shares from the complete unique-material metrics, not bucket sums', () => {
    expect(getMaterialComparisonShares(2, 1)).toEqual({ current: 67, previous: 33, tone: 'up' })
    expect(getMaterialComparisonShares(0, 0)).toEqual({ current: 0, previous: 0, tone: 'flat' })
  })

  it('keeps the legacy bucket comparison helper available for other consumers', () => {
    expect(getComparisonDelta(60, 100)).toBe(-40)
    expect(getComparisonColor(60, 100)).toBe('#dc2626')
    expect(getComparisonColor(80, 100)).toBe('#eab308')
    expect(getComparisonColor(100, 100)).toBe('#2454d9')
    expect(getComparisonColor(105, 100)).not.toBe('#2454d9')
    expect(getComparisonColor(105, 100)).not.toBe('#16a34a')
    expect(getComparisonColor(110, 100)).toBe('#16a34a')
  })

  it('colors each current point against the full previous-period peak', () => {
    const chart = buildMaterialComparisonChartRows(
      [{ bucket_index: 0, references: 50 }, { bucket_index: 1, references: 70 }],
      [{ bucket_index: 0, references: 10 }, { bucket_index: 1, references: 100 }],
      {
        date_from: '2026-01-01T00:00:00.000Z',
        date_to: '2026-01-03T00:00:00.000Z',
        compare_from: '2025-12-30T00:00:00.000Z',
        compare_to: '2026-01-01T00:00:00.000Z',
      },
      'references',
      { key: 'day', size: 1 },
    )

    expect(chart.previousPeak).toBe(100)
    expect(chart.rows[0]).toMatchObject({ comparisonReference: 100, comparisonDelta: -50, comparisonColor: '#dc2626' })
    expect(chart.rows[1]).toMatchObject({ comparisonReference: 100, comparisonDelta: -30, comparisonColor: '#2454d9' })
    expect(chart.currentGradientStops).toEqual([
      { offset: '0%', color: '#dc2626' },
      { offset: '100%', color: '#2454d9' },
    ])
  })

  it('uses the exact thresholds and neutral zero-baseline behavior for peak comparison', () => {
    expect(getPeakComparisonColor(60, 100)).toBe('#dc2626')
    expect(getPeakComparisonColor(61, 100)).toBe('#2454d9')
    expect(getPeakComparisonColor(100, 100)).toBe('#2454d9')
    expect(getPeakComparisonColor(109, 100)).toBe('#2454d9')
    expect(getPeakComparisonColor(110, 100)).toBe('#16a34a')
    expect(getPeakComparisonColor(4, 0)).toBe('#2454d9')
  })

  it('keeps current bars neutral when the previous period has no peak', () => {
    const chart = buildMaterialComparisonChartRows(
      [{ bucket_index: 0, materials_used: 4 }],
      [{ bucket_index: 0, materials_used: 0 }, { bucket_index: 1, materials_used: 0 }],
      {
        date_from: '2026-01-01T00:00:00.000Z',
        date_to: '2026-01-03T00:00:00.000Z',
        compare_from: '2025-12-30T00:00:00.000Z',
        compare_to: '2026-01-01T00:00:00.000Z',
      },
      'materials_used',
      { key: 'day', size: 1 },
    )

    expect(chart.rows[0]).toMatchObject({ comparisonReference: 0, comparisonDelta: null, comparisonColor: '#2454d9' })
  })
})
