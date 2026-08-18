import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialsComparisonPanel from '../components/kpi/MaterialsComparisonPanel'
import { useKPISingle } from '../hooks/useKPI'
import { getComparisonColor, getComparisonDelta, getPreviousPeriodPeak } from '../utils/materialsComparisonColors'

vi.mock('../hooks/useKPI', () => ({ useKPISingle: vi.fn() }))
vi.mock('../components/ui/FilterSelect', () => ({
  FilterSelect: ({ label }) => <div data-testid={`filter-${label}`}>{label}</div>,
}))

const bounds = {
  date_from: '2026-08-01T00:00:00.000Z',
  date_to: '2026-09-01T00:00:00.000Z',
  compare_from: '2026-07-01T00:00:00.000Z',
  compare_to: '2026-08-01T00:00:00.000Z',
}

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
  return render(<MaterialsComparisonPanel globalBounds={bounds} fallbackAnalytics={{}} userId="admin-1" />)
}

describe('MaterialsComparisonPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
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

    renderPanel()

    expect(screen.queryByText('Datos de comparación no disponibles')).not.toBeInTheDocument()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getByText(/No hay datos de referencias registradas/i)).toBeInTheDocument()
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

  it('interpolates the current curve color from its percentage difference', () => {
    expect(getComparisonDelta(60, 100)).toBe(-40)
    expect(getComparisonColor(60, 100)).toBe('#dc2626')
    expect(getComparisonColor(80, 100)).toBe('#eab308')
    expect(getComparisonColor(100, 100)).toBe('#2454d9')
    expect(getComparisonColor(105, 100)).not.toBe('#2454d9')
    expect(getComparisonColor(105, 100)).not.toBe('#16a34a')
    expect(getComparisonColor(110, 100)).toBe('#16a34a')
  })

  it('uses the maximum of the full previous series as the color reference', () => {
    const peak = getPreviousPeriodPeak([80, 95, 120, 100, 90])

    expect(peak).toBe(120)
    expect(getComparisonDelta(70, peak)).toBeCloseTo(-41.67, 2)
    expect(getComparisonColor(70, peak)).toBe('#dc2626')
    expect(getComparisonColor(120, peak)).toBe('#2454d9')
    expect(getComparisonColor(135, peak)).toBe('#16a34a')
    expect(getComparisonColor(80, peak)).not.toBe('#16a34a')
  })
})
