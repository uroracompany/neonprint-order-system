import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import KPISummaryCards from '../components/kpi/KPISummaryCards'
import KPIOrderPipeline from '../components/kpi/KPIOrderPipeline'
import KPIStatusTrend from '../components/kpi/KPIStatusTrend'

const data = {
  executive_summary: {
    snapshot: { active_orders: 4, blocked_orders: 1, stalled_orders: 1, urgent_911_orders: 1, employees_active: 3, clients_registered: 5 },
    pipeline: {
      open_total: 4,
      status_breakdown: { pending: 1, in_design: 1, in_quote: 1, in_production: 1, in_completed: 2 },
      by_design_type: { INTERNAL_DESING: { pending: 1, in_design: 1, in_completed: 1 } },
      by_order_type: { 'orden 911': { in_quote: 1 } },
      by_both: { 'INTERNAL_DESING|orden 911': { pending: 1 } },
    },
    period: { orders_created: 3, orders_delivered: 1, avg_delivery_cycle_days: null },
    comparison: { orders_created: 2, orders_delivered: 2 },
    trends: { created: [{ date: '2026-08-01', orders: 3 }], delivered: [{ date: '2026-08-01', orders: 1 }] },
    coverage: { delivery_cycle_available: 0, delivery_cycle_orders: 1 },
  },
}

function PipelineHarness() {
  const [filters, setFilters] = useState({ designType: 'all', orderType: 'all' })
  return <KPIOrderPipeline data={data} filters={filters} onFiltersChange={setFilters} />
}

describe('componentes del resumen ejecutivo verificado', () => {
  it('presenta una foto actual sin puntaje sintético', () => {
    render(<KPISummaryCards data={data} />)

    expect(screen.getByText('Órdenes en curso')).toBeInTheDocument()
    expect(screen.getByText('Órdenes bloqueadas')).toBeInTheDocument()
    expect(screen.queryByText('Puntaje de Salud')).not.toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('filtra la cartera y mantiene completadas como etapa terminal separada', async () => {
    const user = userEvent.setup()
    render(<PipelineHarness />)

    expect(screen.getByText('Órdenes en curso:')).toBeInTheDocument()
    expect(screen.getByText('Completadas')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Filtrar por tipo de diseño' }))
    await user.click(screen.getByRole('option', { name: 'Diseño interno' }))
    expect(screen.getByText('Órdenes en curso:').parentElement).toHaveTextContent('2')
    expect(screen.getByLabelText('Completadas: 1 órdenes')).toBeInTheDocument()
    expect(screen.queryByText('Entregada')).not.toBeInTheDocument()
  })

  it('muestra N/D cuando el ciclo de entrega no tiene trazabilidad', () => {
    render(<KPIStatusTrend data={data} />)

    expect(screen.getByText('Ciclo hasta entrega')).toBeInTheDocument()
    expect(screen.getByText('N/D')).toBeInTheDocument()
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
  })
})
