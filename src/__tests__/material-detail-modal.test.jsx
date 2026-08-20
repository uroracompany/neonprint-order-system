import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialDetailModal from '../components/kpi/MaterialDetailModal'

const mocks = vi.hoisted(() => ({
  useKPISingle: vi.fn(),
  kpiSingle: { data: null, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() },
}))

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children, data, margin }) => <svg data-testid="material-detail-line-chart" data-left-margin={margin.left} data-points={data.length}>{children}</svg>,
  Bar: () => null,
  BarChart: ({ children, data, margin }) => <svg data-testid="material-detail-bar-chart" data-left-margin={margin.left} data-points={data.length}>{children}</svg>,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

vi.mock('../hooks/useKPI', () => ({
  useKPISingle: (...args) => {
    mocks.useKPISingle(...args)
    return mocks.kpiSingle
  },
}))

const material = {
  name: 'Banner corporativo de formato extendido',
  material_id: 7,
  reference_count: 8,
  total_orders: 5,
  urgent_orders: 2,
  normal_orders: 3,
  internal_design_orders: 1,
  external_design_orders: 4,
  daily: { '2026-08-01': 3, '2026-08-02': 5 },
  top_clients: [{ client_id: 'client-1', client_name: 'Cliente con un nombre muy extenso', count: 5 }],
  top_sellers: [],
}

const periodMeta = {
  date_from: '2026-08-01T00:00:00.000Z',
  date_to: '2026-09-01T00:00:00.000Z',
  compare_from: '2026-07-01T00:00:00.000Z',
  compare_to: '2026-08-01T00:00:00.000Z',
  timezone: 'UTC',
}

const baseModalProps = { material, previousMaterial: null, totalReferences: 21, userId: 'user-1', periodMeta, onClose: vi.fn() }

const globalAnalytics = () => ({
  period: {
    material_references: 30,
    summary: [
      {
        ...material,
        reference_count: 12,
        total_orders: 11,
        urgent_orders: 1,
        normal_orders: 10,
        internal_design_orders: 9,
        external_design_orders: 3,
        daily: { '2025-03-01': 2, '2026-01-10': 4 },
        top_clients: [{ client_id: 'c-global', client_name: 'Cliente Global', count: 5 }],
        top_sellers: [{ seller_id: 's-global', seller_name: 'Vendedor Global', count: 3 }],
      },
    ],
  },
  comparison: { summary: [] },
  meta: { date_from: '1970-01-01T00:00:00.000Z', date_to: '2026-12-31T00:00:00.000Z', timezone: 'UTC' },
})

const openPeriodSelect = () => fireEvent.click(screen.getByLabelText('Período del detalle de material'))
const selectPeriodMode = label => {
  openPeriodSelect()
  fireEvent.click(screen.getByRole('option', { name: label }))
}

afterEach(() => {
  document.body.style.overflow = ''
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.kpiSingle = { data: null, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }
})

describe('MaterialDetailModal', () => {
  it('abre con rendimiento global por defecto consultando todo el histórico', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    render(<MaterialDetailModal {...baseModalProps} />)

    expect(screen.getByRole('dialog', { name: material.name })).toHaveAttribute('aria-describedby', 'material-detail-description')
    expect(screen.getByText('Rendimiento global del material: todo el historial registrado.')).toHaveAttribute('id', 'material-detail-description')
    expect(mocks.useKPISingle).toHaveBeenCalledWith(
      'materials_analytics',
      expect.objectContaining({ date_from: '1970-01-01T00:00:00.000Z' }),
      'user-1',
      true,
    )
    expect(screen.getByText('Sin comparación')).toBeInTheDocument()
    expect(screen.getByText('Cliente Global')).toBeInTheDocument()
    expect(screen.getByText('Vendedor Global')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('calcula la participación con el total del período consultado, sin mezclar el del banner', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    render(<MaterialDetailModal {...baseModalProps} />)

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('abre con barras y alterna a línea sin cambiar la consulta ni los datos de tendencia', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    render(<MaterialDetailModal {...baseModalProps} />)

    expect(screen.getByRole('button', { name: 'Mostrar gráfica de barras' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('material-detail-bar-chart')).toHaveAttribute('data-points', '2')
    expect(screen.getByTestId('material-detail-bar-chart')).toHaveAttribute('data-left-margin', '0')
    const initialRequest = mocks.useKPISingle.mock.calls.at(-1)

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar gráfica de línea' }))

    expect(screen.getByRole('button', { name: 'Mostrar gráfica de línea' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('material-detail-bar-chart')).not.toBeInTheDocument()
    expect(screen.getByTestId('material-detail-line-chart')).toHaveAttribute('data-points', '2')
    expect(screen.getByTestId('material-detail-line-chart')).toHaveAttribute('data-left-margin', '0')
    expect(mocks.useKPISingle.mock.calls.at(-1)).toEqual(initialRequest)

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar gráfica de barras' }))
    expect(screen.getByTestId('material-detail-bar-chart')).toHaveAttribute('data-points', '2')
  })

  it('usa los datos del período del banner al cambiar a Período actual', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    render(<MaterialDetailModal {...baseModalProps} />)

    selectPeriodMode('Período actual')

    expect(mocks.useKPISingle).toHaveBeenLastCalledWith('materials_analytics', null, 'user-1', false)
    expect(screen.getByText('Uso registrado en las órdenes del período seleccionado.')).toBeInTheDocument()
    expect(screen.queryByText('Cliente Global')).not.toBeInTheDocument()
    expect(screen.getByText('Cliente con un nombre muy extenso')).toBeInTheDocument()
  })

  it('muestra los inputs y consulta el día elegido en Fecha específica', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    render(<MaterialDetailModal {...baseModalProps} />)

    selectPeriodMode('Fecha específica')

    const dayInput = screen.getByLabelText('Fecha')
    fireEvent.change(dayInput, { target: { value: '2026-08-08' } })

    expect(mocks.useKPISingle).toHaveBeenLastCalledWith(
      'materials_analytics',
      expect.objectContaining({
        date_from: new Date('2026-08-08T00:00:00').toISOString(),
        date_to: new Date('2026-08-09T00:00:00').toISOString(),
        compare_from: new Date('2026-08-07T00:00:00').toISOString(),
      }),
      'user-1',
      true,
    )
    expect(screen.getByText(/Uso registrado el/)).toBeInTheDocument()
  })

  it('muestra los inputs de rango y consulta con la ventana anterior equivalente', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    render(<MaterialDetailModal {...baseModalProps} />)

    selectPeriodMode('Rango de fechas')

    const [fromInput, toInput] = [screen.getByLabelText('Desde'), screen.getByLabelText('Hasta')]
    expect(fromInput.value).toBe('2026-08-01')
    expect(toInput.value).toBe('2026-08-31')
  })

  it('consulta el período anterior usando la ventana de comparación del banner', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    render(<MaterialDetailModal {...baseModalProps} />)

    selectPeriodMode('Período anterior')

    expect(mocks.useKPISingle).toHaveBeenLastCalledWith(
      'materials_analytics',
      expect.objectContaining({
        date_from: '2026-07-01T00:00:00.000Z',
        date_to: '2026-08-01T00:00:00.000Z',
        compare_from: '2026-05-31T00:00:00.000Z',
        compare_to: '2026-07-01T00:00:00.000Z',
      }),
      'user-1',
      true,
    )
  })

  it('muestra el error del período consultado con reintento sin mostrar datos mezclados', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, error: 'fallo de red' }
    render(<MaterialDetailModal {...baseModalProps} />)

    expect(screen.getByRole('alert')).toHaveTextContent('No fue posible obtener los datos de este período.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.kpiSingle.refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Cliente Global')).not.toBeInTheDocument()
  })

  it('cierra mediante Escape y al pulsar el fondo', () => {
    mocks.kpiSingle = { ...mocks.kpiSingle, data: globalAnalytics() }
    const onClose = vi.fn()
    render(<MaterialDetailModal {...baseModalProps} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(document.querySelector('.kpi-material-detail-overlay'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('muestra el estado vacío de la gráfica cuando no existe actividad diaria en el período consultado', () => {
    mocks.kpiSingle = {
      ...mocks.kpiSingle,
      data: globalAnalytics() && { ...globalAnalytics(), period: { ...globalAnalytics().period, summary: [{ ...material, daily: {} }], material_references: 21 } },
    }
    render(<MaterialDetailModal {...baseModalProps} />)

    expect(screen.getByText('No hay tendencia diaria disponible para este período.')).toBeInTheDocument()
  })

  it('usa una visualización compacta con una única fecha y ordena los rankings al top 5', () => {
    const topClients = [
      ['Cliente 1', 1], ['Cliente 2', 8], ['Cliente 3', 3], ['Cliente 4', 6], ['Cliente 5', 2], ['Cliente 6', 4],
    ].map(([client_name, count], index) => ({ client_id: `client-${index}`, client_name, count }))
    mocks.kpiSingle = {
      ...mocks.kpiSingle,
      data: { ...globalAnalytics(), period: { ...globalAnalytics().period, summary: [{ ...material, daily: { '2026-08-08': 1 }, top_clients: topClients }] } },
    }
    render(<MaterialDetailModal {...baseModalProps} />)

    expect(screen.getByText('Actividad registrada en un único día del período.')).toBeInTheDocument()
    expect(screen.getByText('Cliente 6')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      expect.stringContaining('Cliente 2'),
      expect.stringContaining('Cliente 4'),
      expect.stringContaining('Cliente 6'),
      expect.stringContaining('Cliente 3'),
      expect.stringContaining('Cliente 5'),
    ])
  })
})
