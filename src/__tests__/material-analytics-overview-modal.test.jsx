import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialAnalyticsOverviewModal from '../components/kpi/MaterialAnalyticsOverviewModal'

const mocks = vi.hoisted(() => ({
  query: { data: null, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() },
  useKPISingle: vi.fn(),
}))

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children, data }) => <svg data-testid="trend" data-points={data.length}>{children}</svg>,
  CartesianGrid: () => null,
  Cell: () => null,
  Pie: () => null,
  PieChart: ({ children }) => <svg>{children}</svg>,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

vi.mock('../hooks/useKPI', () => ({
  useKPISingle: (...args) => {
    mocks.useKPISingle(...args)
    return mocks.query
  },
}))

const analytics = {
  snapshot: { catalog_materials: 8, open_orders_without_material: 2 },
  coverage: { unrecognized_period_references: 1 },
  period: {
    orders_with_material: 11,
    material_references: 18,
    summary: [
      { material_id: 1, name: 'Material A', reference_count: 5, total_orders: 3, urgent_orders: 2, normal_orders: 3, internal_design_orders: 1, external_design_orders: 4, daily: { '2026-01-02': 2, '2026-01-03': 3 } },
      { material_id: 2, name: 'Material B', reference_count: 8, total_orders: 1, urgent_orders: 1, normal_orders: 0, internal_design_orders: 1, external_design_orders: 0, daily: { '2026-01-02': 2 } },
      { material_id: 3, name: 'Material C', reference_count: 5, total_orders: 2, urgent_orders: 0, normal_orders: 2, internal_design_orders: 2, external_design_orders: 0, daily: { '2026-01-03': 4 } },
    ],
  },
}

beforeEach(() => {
  mocks.query = { data: analytics, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }
})

afterEach(() => {
  document.body.style.overflow = ''
  vi.clearAllMocks()
})

describe('MaterialAnalyticsOverviewModal', () => {
  it('consulta únicamente la analítica existente al abrirse y presenta métricas verificables', () => {
    render(<MaterialAnalyticsOverviewModal open userId="admin-1" onClose={vi.fn()} />)

    expect(mocks.useKPISingle).toHaveBeenCalledWith('materials_analytics', expect.objectContaining({ date_from: '1970-01-01T00:00:00.000Z' }), 'admin-1', true)
    expect(screen.getByText('Referencias registradas en órdenes; no representa stock, consumo físico ni disponibilidad de inventario.')).toBeInTheDocument()
    expect(screen.getAllByText('Material B').length).toBeGreaterThan(0)
    expect(screen.getByTestId('trend')).toHaveAttribute('data-points', '2')
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('ofrece un reintento honesto cuando falla la consulta', () => {
    mocks.query = { ...mocks.query, data: null, error: 'falló', refresh: vi.fn() }
    render(<MaterialAnalyticsOverviewModal open userId="admin-1" onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.query.refresh).toHaveBeenCalledOnce()
  })

  it('no presenta ceros como métricas durante la carga', () => {
    mocks.query = { ...mocks.query, data: null, loading: true }
    render(<MaterialAnalyticsOverviewModal open userId="admin-1" onClose={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Cargando estadísticas históricas…')
    expect(screen.queryByText('Materiales registrados')).not.toBeInTheDocument()
  })

  it('no inventa gráficos cuando no hay referencias', () => {
    mocks.query = { ...mocks.query, data: { snapshot: { catalog_materials: 1 }, coverage: {}, period: { orders_with_material: 0, material_references: 0, summary: [] } } }
    render(<MaterialAnalyticsOverviewModal open userId="admin-1" onClose={vi.fn()} />)

    expect(screen.getByText('No hay referencias de materiales en órdenes para mostrar en el histórico.')).toBeInTheDocument()
    expect(screen.queryByTestId('trend')).not.toBeInTheDocument()
  })

  it('excluye materiales sin referencias del donut y del ranking', () => {
    mocks.query = {
      ...mocks.query,
      data: {
        ...analytics,
        period: { ...analytics.period, summary: [...analytics.period.summary, { material_id: 9, name: 'Sin actividad', reference_count: 0, total_orders: 0, daily: {} }] },
      },
    }
    render(<MaterialAnalyticsOverviewModal open userId="admin-1" onClose={vi.fn()} />)

    expect(screen.queryByText('Sin actividad')).not.toBeInTheDocument()
  })
})
