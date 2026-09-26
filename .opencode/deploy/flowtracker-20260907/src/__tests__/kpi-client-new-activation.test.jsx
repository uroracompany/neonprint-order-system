import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import KPIClientAnalytics from '../components/kpi/KPIClientAnalytics'

vi.mock('recharts', () => {
  const Container = ({ children }) => <div>{children}</div>
  const Empty = () => null

  return {
    ResponsiveContainer: Container,
    BarChart: Container,
    PieChart: Container,
    LineChart: Container,
    AreaChart: Container,
    Bar: Empty,
    XAxis: Empty,
    YAxis: Empty,
    Tooltip: Empty,
    CartesianGrid: Empty,
    Pie: Empty,
    Cell: Empty,
    Line: Empty,
    Area: Empty,
  }
})

const data = {
  total_clients: 10,
  client_analytics: {
    new_clients: { count: 3, clients: [] },
    recurring_clients: { count: 0 },
    top_clients: [],
    inactive_clients: { clients: [] },
  },
  client_kpis: {
    new_client_activation: {
      total: 3,
      with_first_order: 2,
      pending_first_order: 1,
    },
  },
}

describe('Clientes nuevos KPI', () => {
  it('shows only activation counts for clients registered in the selected period', () => {
    render(<KPIClientAnalytics data={data} />)

    const filter = screen.getByLabelText('Filtro de Clientes Nuevos')
    const card = filter.closest('.kpi-hero-card')

    expect(card).toHaveTextContent('Registrados en período')
    expect(card).toHaveTextContent('3')

    fireEvent.change(filter, { target: { value: 'with_first_order' } })
    expect(card).toHaveTextContent('Con primer pedido')
    expect(card).toHaveTextContent('2')

    fireEvent.change(filter, { target: { value: 'pending_first_order' } })
    expect(card).toHaveTextContent('Sin pedido')
    expect(card).toHaveTextContent('1')
  })
})
