import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import KPIClientWorkspace, { ClientActivityTooltip } from '../components/kpi/KPIClientWorkspace'
import { getClientActivityTooltipLabel } from '../utils/kpiClientActivity'

vi.mock('recharts', () => {
  const Container = ({ children }) => <svg>{children}</svg>
  const BarContainer = ({ children, data }) => <svg data-bar-series={JSON.stringify(data)}>{children}</svg>
  const Bar = ({ dataKey, fill }) => <rect data-bar-key={dataKey} data-bar-fill={fill} />
  const Empty = () => null
  return { ResponsiveContainer: Container, AreaChart: Container, BarChart: BarContainer, PieChart: Container, Area: Empty, Bar, CartesianGrid: Empty, Cell: Empty, Pie: Empty, Tooltip: Empty, XAxis: Empty, YAxis: Empty }
})

const clients = [
  { client_id: 'b', client_name: 'Beto', favorite_material: 'Lona', total_orders: 4, cancelled_orders: 0, cancel_rate: 0, activity: 'Media', avg_orders_per_month: 2, internal_design_orders: 2, external_design_orders: 1, urgent_911_orders: 1, normal_orders: 3, health_score: 71, health: 'Buena', payment: { credit_active: 1, partial_active: 0, pending_active: 0 }, monthly_activity: [{ month: '2026-06', orders: 2 }, { month: '2026-07', orders: 2 }] },
  { client_id: 'a', client_name: 'Alfa', favorite_material: 'Acrílico', total_orders: 4, cancelled_orders: 1, cancel_rate: 25, activity: 'Alta', avg_orders_per_month: 4, internal_design_orders: 3, external_design_orders: 1, urgent_911_orders: 2, normal_orders: 2, health_score: 61, health: 'Buena', payment: { credit_active: 0, partial_active: 1, pending_active: 1 }, monthly_activity: [{ month: '2026-06', orders: 1 }, { month: '2026-07', orders: 3 }] },
  { client_id: 'c', client_name: 'Cora', favorite_material: 'Vinil', total_orders: 1, cancelled_orders: 0, cancel_rate: 0, activity: 'Baja', avg_orders_per_month: 1, internal_design_orders: 0, external_design_orders: 1, urgent_911_orders: 0, normal_orders: 1, health_score: 40, health: 'Media', payment: { credit_active: 0, partial_active: 0, pending_active: 0 }, monthly_activity: [{ month: '2026-07', orders: 1 }] },
]

describe('Espacio consolidado de Clientes KPI', () => {
  it('labels each activity series correctly in the chart tooltip', () => {
    expect(getClientActivityTooltipLabel('active_clients')).toBe('Clientes activos')
    expect(getClientActivityTooltipLabel('Clientes activos')).toBe('Clientes activos')
    expect(getClientActivityTooltipLabel('registered_clients')).toBe('Clientes registrados')
    expect(getClientActivityTooltipLabel('Clientes registrados')).toBe('Clientes registrados')
    expect(getClientActivityTooltipLabel('orders')).toBe('Órdenes')
    expect(getClientActivityTooltipLabel('Órdenes')).toBe('Órdenes')
  })

  it('keeps the general activity as the default view and exposes period controls', () => {
    render(<KPIClientWorkspace clients={clients} />)
    expect(screen.getByRole('tab', { name: 'Actividad general' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Actividad de clientes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1m' })).toHaveClass('is-active')
    expect(screen.getByRole('button', { name: '2m' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '6m' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '12m' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Área' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Línea' })).not.toBeInTheDocument()
  })

  it('shows the compact monthly registration metric in the activity tooltip', () => {
    render(<ClientActivityTooltip
      active
      label="ago 26"
      payload={[{ payload: { month: '2026-08', registered_clients: 250, active_clients: 85, orders: 142 } }]}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('Fecha')
    expect(screen.getByRole('status')).toHaveTextContent(/agosto.*2026/i)
    expect(screen.getByRole('status')).toHaveTextContent('Clientes registrados')
    expect(screen.getByRole('status')).toHaveTextContent('250')
    expect(screen.getByRole('status')).toHaveTextContent('Clientes activos')
    expect(screen.getByRole('status')).toHaveTextContent('85')
    expect(screen.getByRole('status')).toHaveTextContent('Órdenes')
    expect(screen.getByRole('status')).toHaveTextContent('142')
  })

  it('normalizes serialized order totals before drawing the bar chart', () => {
    const stringOrders = [{ ...clients[0], created_at: '2026-07-02T00:00:00.000Z', monthly_activity: [{ month: '2026-07', orders: '17' }] }]
    const { container } = render(<KPIClientWorkspace clients={stringOrders} />)

    expect(container.querySelector('[data-bar-series]')).toHaveAttribute(
      'data-bar-series',
      expect.stringContaining('"orders":17'),
    )
    expect(container.querySelector('[data-bar-series]')).toHaveAttribute(
      'data-bar-series',
      expect.stringContaining('"registered_clients":1'),
    )
    expect(container.querySelector('[data-bar-key="active_clients"]')).toHaveAttribute('data-bar-fill', 'var(--kpi-secondary)')
    expect(container.querySelector('[data-bar-key="orders"]')).toHaveAttribute('data-bar-fill', '#1E40AF')
  })

  it('uses the registered-client total together with the monthly server timeline', () => {
    const { container } = render(<KPIClientWorkspace clients={clients} activityTimeline={[
      { month: '2026-06', orders: '4', active_clients: '2', registered_clients: '3' },
      { month: '2026-07', orders: '9', active_clients: '3', registered_clients: '4' },
      { month: '2026-08', orders: '17', active_clients: '5', registered_clients: '8' },
    ]} registeredClientCount={250} />)

    expect(container.querySelector('[data-bar-series]')).toHaveAttribute(
      'data-bar-series',
      expect.stringContaining('"orders":17'),
    )
    expect(container.querySelector('[data-bar-series]')).toHaveAttribute(
      'data-bar-series',
      expect.stringContaining('"registered_clients":250'),
    )
    expect(screen.getAllByText('17')).toHaveLength(2)
  })

  it('labels the historical repeat-buyer ratio without changing its calculation', () => {
    render(<KPIClientWorkspace clients={clients} />)

    expect(screen.getByText('Clientes recurrentes')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('Con más de un pedido histórico')).toBeInTheDocument()
    expect(screen.queryByText('Retención')).not.toBeInTheDocument()
  })

  it('ranks clients, filters active credit and opens the detailed modal', () => {
    render(<KPIClientWorkspace clients={clients} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Actividad individual' }))

    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Alfa')

    fireEvent.change(screen.getByLabelText('Filtrar clientes con crédito activo'), { target: { value: 'yes' } })
    expect(screen.getByText('Beto')).toBeInTheDocument()
    expect(screen.queryByText('Cora')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Beto'))
    expect(screen.getByRole('dialog')).toHaveTextContent('911 vs. normal')
    expect(screen.getByRole('dialog')).toHaveTextContent('Estados de pago activos')
  })

  it('uses the established KPI payload when the complete workspace query is unavailable', () => {
    render(<KPIClientWorkspace clients={[]} legacyData={{
      client: { top_clients: [{ id: 'legacy-1', name: 'Cliente existente', total_orders: 6 }] },
      kpis: { frequency_by_client: [{ client_name: 'Cliente existente', total_orders: 6, orders_per_month: 3, frequency: 'Media', months: { '2026-06': 2, '2026-07': 4 } }] },
    }} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Actividad individual' }))
    expect(screen.getByText('Cliente existente')).toBeInTheDocument()
    expect(screen.getByText('6 órdenes')).toBeInTheDocument()
  })
})
