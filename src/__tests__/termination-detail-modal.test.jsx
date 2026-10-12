import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminationDetailModal from '../components/kpi/TerminationDetailModal'

const mocks = vi.hoisted(() => ({
  useKPISingle: vi.fn(),
  query: { data: null, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() },
}))

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children, data }) => <svg data-testid="termination-detail-area-chart" data-points={data.length}>{children}</svg>,
  Bar: () => null,
  BarChart: ({ children, data }) => <svg data-testid="termination-detail-bar-chart" data-points={data.length}>{children}</svg>,
  CartesianGrid: () => null,
  Cell: () => null,
  Line: () => null,
  LineChart: ({ children, data }) => <svg data-testid="termination-detail-line-chart" data-points={data.length}>{children}</svg>,
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

const termination = { termination_id: 7, name: 'Brillante', production_area_code: 'ploteo', production_area_label: 'Ploteo' }
const analyticsTermination = {
  ...termination,
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
const props = { termination, previousTermination: null, totalReferences: 0, userId: 'admin-1', source: 'catalog', onClose: vi.fn() }

beforeEach(() => {
  mocks.query = {
    data: { period: { termination_references: 30, summary: [analyticsTermination] }, comparison: { summary: [] } },
    loading: false,
    fetching: false,
    isPlaceholderData: false,
    error: null,
    refresh: vi.fn(),
  }
})

afterEach(() => {
  document.body.style.overflow = ''
  vi.clearAllMocks()
})

describe('TerminationDetailModal', () => {
  it('consulta terminaciones_analytics y resuelve por id y área', () => {
    render(<TerminationDetailModal {...props} />)

    expect(mocks.useKPISingle).toHaveBeenCalledWith('terminations_analytics', expect.objectContaining({ date_from: '1970-01-01T00:00:00.000Z', termination_id: 7, production_area_code: 'ploteo' }), 'admin-1', true)
    expect(screen.getByText('Detalle de terminación')).toBeInTheDocument()
    expect(screen.getByText(/Área: Ploteo/)).toBeInTheDocument()
    expect(screen.getByText('Cliente Global')).toBeInTheDocument()
    expect(screen.getByText('Vendedor Global')).toBeInTheDocument()
    expect(screen.getByText('3 de 11 órdenes canceladas')).toBeInTheDocument()
    expect(screen.getByTestId('termination-detail-line-chart')).toHaveAttribute('data-points', '3')
  })

  it('no mezcla terminaciones homónimas de áreas distintas cuando falta el id', () => {
    mocks.query = {
      ...mocks.query,
      data: {
        period: {
          termination_references: 2,
          summary: [
            { ...analyticsTermination, termination_id: 1, production_area_code: 'ploteo' },
            { ...analyticsTermination, termination_id: 2, production_area_code: 'digital' },
          ],
        },
        comparison: { summary: [] },
      },
    }

    render(<TerminationDetailModal {...props} termination={{ name: 'Brillante' }} />)

    expect(screen.getByText('No hay referencias en órdenes para esta terminación.')).toBeInTheDocument()
  })

  it('muestra carga, permite reintento y conserva el estado vacío', () => {
    mocks.query = { ...mocks.query, data: null, loading: true }
    const { rerender } = render(<TerminationDetailModal {...props} />)
    expect(screen.getByText('Cargando histórico de terminaciones…')).toBeInTheDocument()

    mocks.query = { ...mocks.query, loading: false, error: new Error('red') }
    rerender(<TerminationDetailModal {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.query.refresh).toHaveBeenCalledTimes(1)

    mocks.query = { ...mocks.query, error: null, data: { period: { termination_references: 0, summary: [] }, comparison: { summary: [] } } }
    rerender(<TerminationDetailModal {...props} />)
    expect(screen.getByText('No hay referencias en órdenes para esta terminación.')).toBeInTheDocument()
  })

  it('cierra con Escape y devuelve el foco al botón que abrió el detalle', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const returnFocusRef = { current: trigger }
    const onClose = vi.fn()
    const { unmount } = render(<TerminationDetailModal {...props} returnFocusRef={returnFocusRef} onClose={onClose} />)

    const dialogButtons = within(screen.getByRole('dialog')).getAllByRole('button')
    dialogButtons.at(-1).focus()
    fireEvent.keyDown(document, { key: 'Tab', cancelable: true })
    expect(document.activeElement).toBe(dialogButtons[0])

    fireEvent.keyDown(document, { key: 'Escape', cancelable: true })
    expect(onClose).toHaveBeenCalledTimes(1)

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
