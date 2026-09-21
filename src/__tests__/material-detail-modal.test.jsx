import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialDetailModal from '../components/kpi/MaterialDetailModal'

const mocks = vi.hoisted(() => ({
  useKPISingle: vi.fn(),
  query: { data: null, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() },
}))

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children, data }) => <svg data-testid="material-detail-area-chart" data-points={data.length}>{children}</svg>,
  Bar: () => null,
  BarChart: ({ children, data }) => <svg data-testid="material-detail-bar-chart" data-points={data.length}>{children}</svg>,
  CartesianGrid: () => null,
  Cell: () => null,
  Line: () => null,
  LineChart: ({ children, data }) => <svg data-testid="material-detail-line-chart" data-points={data.length}>{children}</svg>,
  Pie: ({ children }) => <g>{children}</g>,
  PieChart: ({ children }) => <svg>{children}</svg>,
  ReferenceLine: () => null,
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

const catalogMaterial = { material_id: 7, name: 'Banner corporativo' }
const analyticsMaterial = {
  ...catalogMaterial,
  reference_count: 12,
  total_orders: 11,
  cancelled_orders: 3,
  urgent_orders: 1,
  normal_orders: 10,
  internal_design_orders: 9,
  external_design_orders: 3,
  trend_granularity: 'month',
  trend: [{ period: '2026-01', count: 2 }, { period: '2026-02', count: 0 }, { period: '2026-03', count: 4 }],
  top_clients: [{ client_id: 'client-1', client_name: 'Cliente Global', count: 5 }],
  top_sellers: [{ seller_id: 'seller-1', seller_name: 'Vendedor Global', count: 3 }],
}
const analytics = {
  period: { material_references: 30, summary: [analyticsMaterial] },
  comparison: { summary: [] },
  meta: { timezone: 'America/Asuncion' },
}
const props = { material: catalogMaterial, previousMaterial: null, totalReferences: 0, userId: 'user-1', onClose: vi.fn() }

beforeEach(() => {
  mocks.query = { data: analytics, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }
})

afterEach(() => {
  document.body.style.overflow = ''
  vi.clearAllMocks()
})

describe('MaterialDetailModal', () => {
  it('consulta el histórico al abrirse desde catálogo y resuelve por material_id', () => {
    render(<MaterialDetailModal {...props} source="catalog" />)

    expect(mocks.useKPISingle).toHaveBeenCalledWith('materials_analytics', expect.objectContaining({ date_from: '1970-01-01T00:00:00.000Z' }), 'user-1', true)
    expect(screen.getByText('Uso registrado en todas las órdenes del historial.')).toBeInTheDocument()
    expect(screen.getByText('Cliente Global')).toBeInTheDocument()
    expect(screen.getByText('Vendedor Global')).toBeInTheDocument()
    expect(screen.getByText('27%')).toBeInTheDocument()
    expect(screen.getByText('3 de 11 órdenes canceladas')).toBeInTheDocument()
  })

  it('no usa la RPC secundaria de cancelación', () => {
    render(<MaterialDetailModal {...props} source="catalog" />)

    expect(mocks.useKPISingle.mock.calls.every(([key]) => key === 'materials_analytics')).toBe(true)
  })

  it('evita resolver homónimos por nombre cuando no llega material_id', () => {
    mocks.query = { ...mocks.query, data: { ...analytics, period: { material_references: 2, summary: [{ ...analyticsMaterial, material_id: 1 }, { ...analyticsMaterial, material_id: 2 }] } } }
    render(<MaterialDetailModal {...props} material={{ name: 'Banner corporativo' }} source="catalog" />)

    expect(screen.getByText('No hay referencias en órdenes para este material.')).toBeInTheDocument()
  })

  it('muestra carga, error con reintento y vacío sin datos obsoletos', () => {
    mocks.query = { ...mocks.query, data: null, loading: true }
    const { rerender } = render(<MaterialDetailModal {...props} source="catalog" />)
    expect(screen.getByText('Cargando histórico del material…')).toBeInTheDocument()

    mocks.query = { ...mocks.query, loading: false, error: new Error('red') }
    rerender(<MaterialDetailModal {...props} source="catalog" />)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.query.refresh).toHaveBeenCalledTimes(1)

    mocks.query = { ...mocks.query, error: null, data: { period: { material_references: 0, summary: [] }, comparison: { summary: [] } } }
    rerender(<MaterialDetailModal {...props} source="catalog" />)
    expect(screen.getByText('No hay referencias en órdenes para este material.')).toBeInTheDocument()
  })

  it('conserva el período actual sin consulta redundante desde KPI', () => {
    render(<MaterialDetailModal {...props} material={analyticsMaterial} totalReferences={30} source="kpi" />)

    expect(mocks.useKPISingle).toHaveBeenCalledWith('materials_analytics', null, 'user-1', false)
    expect(screen.getByText('Uso registrado en las órdenes del mes actual.')).toBeInTheDocument()
  })

  it('mantiene los puntos mensuales, incluidos ceros, y alterna la gráfica', () => {
    render(<MaterialDetailModal {...props} source="catalog" />)

    expect(screen.getByTestId('material-detail-line-chart')).toHaveAttribute('data-points', '3')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar gráfica de barras' }))
    expect(screen.getByTestId('material-detail-bar-chart')).toHaveAttribute('data-points', '3')
  })

  it('respeta Escape consumido y conserva el cierre para Escape normal', () => {
    const onClose = vi.fn()
    const consumeEscape = event => { if (event.key === 'Escape') event.preventDefault() }
    document.addEventListener('keydown', consumeEscape, true)
    render(<MaterialDetailModal {...props} source="catalog" onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape', cancelable: true })
    expect(onClose).not.toHaveBeenCalled()

    document.removeEventListener('keydown', consumeEscape, true)
    fireEvent.keyDown(document, { key: 'Escape', cancelable: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cierra primero el selector de período al consumir Escape y mantiene abierto el modal', () => {
    const onClose = vi.fn()
    render(<MaterialDetailModal {...props} source="catalog" onClose={onClose} />)

    const periodSelect = screen.getByRole('button', { name: 'Período del detalle de material' })
    fireEvent.click(periodSelect)
    expect(screen.getByRole('listbox', { name: 'Período del detalle de material' })).toBeInTheDocument()

    fireEvent.keyDown(periodSelect, { key: 'Escape', cancelable: true })
    expect(screen.queryByRole('listbox', { name: 'Período del detalle de material' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape', cancelable: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
