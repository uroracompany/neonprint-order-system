import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KPIMaterialsAnalytics from '../components/kpi/KPIMaterialsAnalytics'

const mocks = vi.hoisted(() => ({
  useKPISingle: vi.fn(),
  kpiSingle: { data: null, loading: true, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() },
  evolutionKpiSingle: { data: null, loading: true, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() },
  chartDataCapture: { current: null },
  chartCalls: [],
  detailModalProps: { current: null },
}))

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children, data }) => { mocks.chartDataCapture.current = data; mocks.chartCalls.push({ type: 'area', data }); return <svg>{children}</svg> },
  Bar: () => null,
  BarChart: ({ children, data }) => { mocks.chartDataCapture.current = data; mocks.chartCalls.push({ type: 'bar', data }); return <svg>{children}</svg> },
  Cell: () => null,
  CartesianGrid: () => null,
  Line: () => null,
  LineChart: ({ children, data }) => { mocks.chartDataCapture.current = data; mocks.chartCalls.push({ type: 'line', data }); return <svg>{children}</svg> },
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

vi.mock('../hooks/useKPI', () => ({
  useKPISingle: (...args) => {
    mocks.useKPISingle(...args)
    return args[1]?.date_from === '1970-01-01T00:00:00.000Z'
      ? mocks.kpiSingle
      : mocks.evolutionKpiSingle
  },
}))

vi.mock('../components/kpi/MaterialDetailModal', () => ({
  default: props => {
    mocks.detailModalProps.current = props
    return null
  },
}))
vi.mock('../components/kpi/MaterialsComparisonPanel', () => ({ default: () => null }))

const materialRow = (name, id, referenceCount, totalOrders) => ({
  material_id: id,
  name,
  reference_count: referenceCount,
  total_orders: totalOrders,
  urgent_orders: 0,
  normal_orders: totalOrders,
  internal_design_orders: totalOrders,
  external_design_orders: 0,
  top_clients: [],
  top_sellers: [],
  daily: {},
})

const periodRows = [materialRow('Banner', 7, 1, 1)]
const globalRows = [
  materialRow('Acrilico', 1, 10, 10),
  materialRow('Adhesivo', 2, 10, 10),
  materialRow('Banner', 7, 1, 1),
]

const data = {
  materials_analytics: {
    period: {
      orders_total: 1,
      orders_with_material: 1,
      material_references: 1,
      materials_used: 1,
      cancelled_orders: 0,
      summary: periodRows,
      order_type_by_material: [],
      cancellation_by_material: [],
    },
    comparison: { orders_total: 2, orders_with_material: 2, material_references: 2, summary: [] },
    snapshot: { catalog_materials: 3, open_orders: 1, open_orders_with_material: 1, materials_in_open_orders: 3 },
    coverage: { period_orders_without_material: 0, unrecognized_period_references: 0, cancellation_events_auditable: 0 },
    meta: { date_from: '2026-08-01T00:00:00.000Z', date_to: '2026-09-01T00:00:00.000Z', timezone: 'UTC' },
  },
}

beforeEach(() => {
  mocks.useKPISingle.mockClear()
  mocks.detailModalProps.current = null
  mocks.kpiSingle = { data: { period: { summary: globalRows, material_references: 21 }, comparison: { summary: [] } }, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }
  mocks.evolutionKpiSingle = { data: data.materials_analytics, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('KPIMaterialsAnalytics ranking render', () => {
  it('renderiza el ranking global por defecto consultando el histórico completo', () => {
    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)

    expect(screen.getAllByText('Ranking de Materiales').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Acrilico').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Adhesivo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Banner').length).toBeGreaterThan(0)
    expect(mocks.useKPISingle.mock.calls.find(([, bounds]) => bounds.date_from === '1970-01-01T00:00:00.000Z')).toMatchObject([
      'materials_analytics',
      { date_from: '1970-01-01T00:00:00.000Z' },
      'user-1',
    ])
  })

  it('muestra la participación contra el total global y sin comparación', () => {
    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)

    expect(screen.getAllByText('48%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('construye el Heatmap con el historial del ranking y no con el resumen mensual del banner', () => {
    const globalRowsWithMonthlyTrend = [
      { ...globalRows[0], monthly_trend: [{ month: '2026-06', count: 1 }, { month: '2026-07', count: 9 }] },
      { ...globalRows[1], monthly_trend: [{ month: '2026-06', count: 1 }, { month: '2026-07', count: 9 }] },
      { ...globalRows[2], monthly_trend: [{ month: '2026-08', count: 1 }] },
    ]
    mocks.kpiSingle = {
      data: { period: { summary: globalRowsWithMonthlyTrend, material_references: 21 }, comparison: { summary: [] } },
      loading: false,
      fetching: false,
      isPlaceholderData: false,
      error: null,
      refresh: vi.fn(),
    }

    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Heatmap' }))

    expect(screen.getByText('Top 3')).toBeInTheDocument()
    expect(screen.getByText('Acrilico')).toBeInTheDocument()
    expect(screen.getByText('Adhesivo')).toBeInTheDocument()
    expect(screen.getAllByText('Banner').length).toBeGreaterThan(1)
    expect(screen.getByText('2026-06')).toBeInTheDocument()
    expect(screen.getByText('2026-07')).toBeInTheDocument()
    expect(screen.getByText('2026-08')).toBeInTheDocument()
  })

  it('construye Alertas con los materiales y cancelaciones del ranking, no con el banner mensual', () => {
    const globalRowsWithAlerts = [
      { ...globalRows[0], cancelled_orders: 2 },
      { ...globalRows[1], cancelled_orders: 0 },
      { ...globalRows[2], cancelled_orders: 0 },
    ]
    mocks.kpiSingle = {
      data: { period: { summary: globalRowsWithAlerts, material_references: 21 }, comparison: { summary: [] } },
      loading: false,
      fetching: false,
      isPlaceholderData: false,
      error: null,
      refresh: vi.fn(),
    }

    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Alertas' }))

    const featuredCard = screen.getByText('Materiales más referenciados').closest('.kpi-materials-alert-card')
    const cancellationsCard = screen.getByText('Cancelaciones auditables por material').closest('.kpi-materials-alert-card')
    expect(featuredCard).toHaveTextContent('Acrilico')
    expect(featuredCard).toHaveTextContent('Adhesivo')
    expect(cancellationsCard).toHaveTextContent('Acrilico')
    expect(cancellationsCard).not.toHaveTextContent('No hay cancelaciones auditables por material')
  })

  it('abre el detalle desde el material y los metadatos del ranking, aunque no exista en el resumen superior', () => {
    const rankingMeta = { date_from: '1970-01-01T00:00:00.000Z', date_to: '2026-08-21T00:00:00.000Z', timezone: 'UTC' }
    mocks.kpiSingle = {
      data: {
        period: { summary: globalRows, material_references: 21 },
        comparison: { summary: [materialRow('Acrilico', 1, 7, 7)] },
        meta: rankingMeta,
      },
      loading: false,
      fetching: false,
      isPlaceholderData: false,
      error: null,
      refresh: vi.fn(),
    }

    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Acrilico' }))

    expect(mocks.detailModalProps.current).toMatchObject({
      material: expect.objectContaining({ name: 'Acrilico' }),
      previousMaterial: expect.objectContaining({ name: 'Acrilico', reference_count: 7 }),
      totalReferences: 21,
      periodMeta: rankingMeta,
    })
  })

  it('consulta Mensual, Semanal y Hoy únicamente para el ranking', () => {
    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)

    const getLatestRankingRequest = () => mocks.useKPISingle.mock.calls
      .filter(([action]) => action === 'materials_analytics')
      .at(-1)[1]
    const assertComparableBounds = (bounds) => {
      expect(new Date(bounds.date_to) - new Date(bounds.date_from)).toBe(new Date(bounds.compare_to) - new Date(bounds.compare_from))
      expect(bounds.date_from).not.toBe('1970-01-01T00:00:00.000Z')
    }

    for (const label of ['Mensual', 'Semanal', 'Hoy']) {
      fireEvent.click(screen.getByRole('button', { name: 'Período del ranking' }))
      fireEvent.click(screen.getByRole('option', { name: label }))
      assertComparableBounds(getLatestRankingRequest())
      expect(screen.getByRole('button', { name: 'Período del ranking' })).toHaveTextContent(label)
    }
  })

  it('muestra el estado de carga propio sin presentar el ranking anterior', () => {
    mocks.kpiSingle = { data: null, loading: true, fetching: true, isPlaceholderData: false, error: null, refresh: vi.fn() }
    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)

    expect(screen.getByText('Cargando ranking de materiales…')).toBeInTheDocument()
    expect(screen.queryByText('Acrilico')).not.toBeInTheDocument()
  })

  it('muestra el error del ranking con reintento', () => {
    mocks.kpiSingle = { data: null, loading: false, fetching: false, isPlaceholderData: false, error: 'fallo', refresh: vi.fn() }
    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)

    expect(screen.getByRole('alert', { name: '' })).toHaveTextContent('No fue posible actualizar el ranking de materiales.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Reintentar' }).at(-1))
    expect(mocks.kpiSingle.refresh).toHaveBeenCalledTimes(1)
  })

  it('pagina el ranking de siete en siete con el control compartido', () => {
    const rows = Array.from({ length: 8 }, (_, index) => materialRow(`Material ${index + 1}`, index + 1, 8 - index, 8 - index))
    mocks.kpiSingle = { data: { period: { summary: rows, material_references: 36 }, comparison: { summary: [] } }, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }

    render(<KPIMaterialsAnalytics data={data} userId="user-1" />)

    expect(screen.getByText('Material 1')).toBeInTheDocument()
    expect(screen.queryByText('Material 8')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.queryByText('Material 1')).not.toBeInTheDocument()
    expect(screen.getByText('Material 8')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument()
  })

  it('marca 911, normal y el icono de cliente con los estilos semánticos del ranking', () => {
    const row = {
      ...materialRow('Acrilico', 1, 8, 8),
      urgent_orders: 3,
      normal_orders: 5,
      top_clients: [{ client_name: 'JP Morgan', count: 8 }],
    }
    mocks.kpiSingle = { data: { period: { summary: [row], material_references: 8 }, comparison: { summary: [] } }, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }

    const { container } = render(<KPIMaterialsAnalytics data={data} userId="user-1" />)

    expect(screen.getByText('911 3')).toHaveClass('kpi-materials-ranking-usage-urgent')
    expect(screen.getByText('N 5')).toHaveClass('kpi-materials-ranking-usage-normal')
    expect(container.querySelector('.kpi-materials-ranking-clients svg')).toBeInTheDocument()
  })
})

describe('KPIMaterialsAnalytics evolution chart — cumulative period comparison', () => {
  const evoMaterial = (name, id, daily) => {
    const references = Object.values(daily).reduce((sum, count) => sum + count, 0)
    return {
      material_id: id,
      name,
      reference_count: references,
      total_orders: references,
      urgent_orders: 0,
      normal_orders: references,
      internal_design_orders: 0,
      external_design_orders: 0,
      top_clients: [],
      top_sellers: [],
      daily,
      monthly_trend: [],
    }
  }

  const evoSummary = [
    evoMaterial('Pintura', 10, { '2026-08-01': 2, '2026-08-03': 3 }),
    evoMaterial('Tela', 20, { '2026-08-02': 4, '2026-08-03': 1 }),
  ]
  const evoComparison = [
    evoMaterial('Pintura', 10, { '2026-07-26': 1, '2026-07-27': 3, '2026-07-31': 1 }),
    evoMaterial('Tela', 20, { '2026-07-27': 2, '2026-07-28': 4 }),
  ]
  const evoData = {
    materials_analytics: {
      period: { orders_total: 2, orders_with_material: 2, material_references: 10, materials_used: 2, cancelled_orders: 0, summary: evoSummary, order_type_by_material: [], cancellation_by_material: [] },
      comparison: { orders_total: 2, orders_with_material: 2, material_references: 11, summary: evoComparison },
      snapshot: { catalog_materials: 2, open_orders: 0, open_orders_with_material: 0, materials_in_open_orders: 0 },
      coverage: { period_orders_without_material: 0, unrecognized_period_references: 0, cancellation_events_auditable: 0 },
      meta: { date_from: '2026-08-01T04:00:00.000Z', date_to: '2026-08-07T04:00:00.000Z', compare_from: '2026-07-26T04:00:00.000Z', compare_to: '2026-08-01T04:00:00.000Z', timezone: 'America/Asuncion' },
    },
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    mocks.chartDataCapture.current = null
    mocks.chartCalls = []
    mocks.useKPISingle.mockClear()
    mocks.kpiSingle = { data: { period: { summary: globalRows, material_references: 21 }, comparison: { summary: [] } }, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }
    mocks.evolutionKpiSingle = { data: evoData.materials_analytics, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }
  })

  afterEach(() => vi.useRealTimers())

  it('acumula ambos períodos desde cero usando exclusivamente los conteos diarios', () => {
    render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)

    const chartData = mocks.chartDataCapture.current
    expect(chartData).toHaveLength(32)
    expect(chartData[0]).toMatchObject({ name: 'Inicio', Materiales: 0, 'Período anterior': 0 })
    expect(chartData.slice(0, 5).map(point => point.Materiales)).toEqual([0, 2, 6, 10, null])
    expect(chartData.slice(26).map(point => point['Período anterior'])).toEqual([1, 6, 10, 10, 10, 11])
  })

  it('mantiene el período anterior completo y corta el actual en el último día observable', () => {
    render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)

    expect(mocks.chartDataCapture.current[4]).toMatchObject({ name: 'Día 4', Materiales: null, 'Período anterior': 0 })
    expect(mocks.chartDataCapture.current.at(-1)).toMatchObject({ name: 'Día 31', Materiales: null, 'Período anterior': 11 })
  })

  it('limita el alcance global al mes actual contra el mes anterior', () => {
    const globalSummary = [
      evoMaterial('Pintura', 10, { ...evoSummary[0].daily, ...evoComparison[0].daily }),
      evoMaterial('Tela', 20, { ...evoSummary[1].daily, ...evoComparison[1].daily }),
    ]
    const globalData = {
      materials_analytics: {
        ...evoData.materials_analytics,
        period: { ...evoData.materials_analytics.period, summary: globalSummary },
        meta: {
          ...evoData.materials_analytics.meta,
          date_from: '1970-01-01T00:00:00.000Z',
          date_to: '2026-08-04T04:00:00.000Z',
          compare_from: '1970-01-01T00:00:00.000Z',
          compare_to: '1970-01-01T00:00:00.000Z',
        },
      },
    }
    mocks.evolutionKpiSingle = { data: globalData.materials_analytics, loading: false, fetching: false, isPlaceholderData: false, error: null, refresh: vi.fn() }

    render(<KPIMaterialsAnalytics data={globalData} userId="user-1" />)

    const chartData = mocks.chartDataCapture.current
    expect(chartData).toHaveLength(32)
    expect(chartData[0].name).toBe('Inicio')
    expect(chartData.at(-1)).toMatchObject({ name: 'Día 31', Materiales: null, 'Período anterior': 11 })
    expect(chartData.slice(0, 5).map(point => point.Materiales)).toEqual([0, 2, 6, 10, null])
    expect(screen.getAllByText('Acumulado de referencias de materiales: mes actual vs. mes anterior equivalente.').length).toBeGreaterThan(0)
  })

  it('recalcula la acumulación para un material seleccionado y para materiales diferentes', () => {
    render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar evolución por material' }))
    fireEvent.click(screen.getByRole('option', { name: 'Pintura' }))
    expect(mocks.chartDataCapture.current.slice(0, 7).map(point => point.Materiales)).toEqual([0, 2, 2, 5, null, null, null])
    expect(mocks.chartDataCapture.current.slice(26).map(point => point['Período anterior'])).toEqual([1, 4, 4, 4, 4, 5])

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar evolución por material' }))
    fireEvent.click(screen.getByRole('option', { name: 'Materiales diferentes' }))
    expect(mocks.chartDataCapture.current.slice(0, 7).map(point => point.Materiales)).toEqual([0, 1, 2, 2, null, null, null])
    expect(mocks.chartDataCapture.current.slice(26).map(point => point['Período anterior'])).toEqual([1, 2, 2, 2, 2, 2])
  })

  it('usa la misma serie para Área y Línea, y exactamente dos barras para los totales', () => {
    render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)
    const areaData = mocks.chartDataCapture.current

    fireEvent.click(screen.getByRole('button', { name: 'Línea' }))
    expect(mocks.chartCalls.at(-1)).toMatchObject({ type: 'line', data: areaData })

    fireEvent.click(screen.getByRole('button', { name: 'Barras' }))
    expect(mocks.chartCalls.at(-1)).toMatchObject({
      type: 'bar',
      data: [
        { name: 'Período anterior', value: 11 },
        { name: 'Período actual', value: 10 },
      ],
    })
  })

  it('describe la comparación temporal seleccionada', () => {
    render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)
    expect(screen.getAllByText('Acumulado de referencias de materiales: mes actual vs. mes anterior equivalente.').length).toBeGreaterThan(0)
  })

  it('consulta cada período de tendencia con una comparación de igual duración', () => {
    render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)

    const latestEvolutionBounds = () => mocks.useKPISingle.mock.calls
      .filter(([action, bounds]) => action === 'materials_analytics' && bounds.date_from !== '1970-01-01T00:00:00.000Z')
      .at(-1)[1]
    const assertEquivalentDuration = (bounds) => {
      expect(new Date(bounds.date_to) - new Date(bounds.date_from)).toBe(new Date(bounds.compare_to) - new Date(bounds.compare_from))
    }

    expect(latestEvolutionBounds().date_from.slice(0, 10)).toBe('2026-08-01')
    assertEquivalentDuration(latestEvolutionBounds())

    fireEvent.click(screen.getByRole('button', { name: 'Comparar período de evolución' }))
    fireEvent.click(screen.getByRole('option', { name: 'Últimos 2 meses vs. los 2 anteriores' }))
    expect(latestEvolutionBounds().date_from.slice(0, 10)).toBe('2026-07-01')
    assertEquivalentDuration(latestEvolutionBounds())
    expect(screen.getAllByText('Acumulado de referencias de materiales: últimos 2 meses vs. los 2 anteriores equivalentes.').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Comparar período de evolución' }))
    fireEvent.click(screen.getByRole('option', { name: 'Últimos 3 meses vs. los 3 anteriores' }))
    expect(latestEvolutionBounds().date_from.slice(0, 10)).toBe('2026-06-01')
    assertEquivalentDuration(latestEvolutionBounds())

    fireEvent.click(screen.getByRole('button', { name: 'Comparar período de evolución' }))
    fireEvent.click(screen.getByRole('option', { name: 'Esta semana vs. semana anterior' }))
    expect(latestEvolutionBounds().date_from.slice(0, 10)).toBe('2026-08-02')
    assertEquivalentDuration(latestEvolutionBounds())
  })

  it('permite seleccionar un material ausente del período actual si existe en el anterior', () => {
    const previousOnly = evoMaterial('Vinilo', 30, { '2026-07-26': 2, '2026-07-27': 1 })
    mocks.evolutionKpiSingle = {
      data: {
        ...evoData.materials_analytics,
        comparison: { ...evoData.materials_analytics.comparison, summary: [...evoComparison, previousOnly] },
      },
      loading: false,
      fetching: false,
      isPlaceholderData: false,
      error: null,
      refresh: vi.fn(),
    }
    render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar evolución por material' }))
    fireEvent.click(screen.getByRole('option', { name: 'Vinilo' }))

    expect(mocks.chartDataCapture.current.slice(0, 7).map(point => point.Materiales)).toEqual([0, 0, 0, 0, null, null, null])
    expect(mocks.chartDataCapture.current.slice(26).map(point => point['Período anterior'])).toEqual([2, 3, 3, 3, 3, 3])
  })

  it('no presenta una serie anterior mientras se actualiza y permite reintentar ante un error', () => {
    const refresh = vi.fn()
    mocks.evolutionKpiSingle = { data: evoData.materials_analytics, loading: false, fetching: true, isPlaceholderData: true, error: null, refresh }
    const { rerender } = render(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando tendencias…')

    mocks.evolutionKpiSingle = { data: null, loading: false, fetching: false, isPlaceholderData: false, error: 'fallo', refresh }
    rerender(<KPIMaterialsAnalytics data={evoData} userId="user-1" />)
    expect(screen.getByText('No fue posible actualizar las tendencias.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
