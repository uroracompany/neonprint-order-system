import { Icons } from '../../utils/icons'
import { formatNumber } from '../../utils/kpiHelpers'

export default function KPICreditsSummary({ data }) {
  if (!data) return null

  const paymentSummary = data.payment_summary || {}
  const creditCount = paymentSummary.credito || 0
  const partialCount = paymentSummary.parcial || 0
  const pendingPaymentCount = paymentSummary.pending_payment || 0
  const pendingPaymentAged = paymentSummary.pending_payment_aged || {}
  const pendingCount = pendingPaymentAged.count || 0

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Cobros</span>
          <h2 className="kpi-section-title">Créditos y Pagos Pendientes</h2>
          <p className="kpi-section-subtitle">Órdenes que requieren seguimiento de cobro</p>
        </div>
      </div>

      <div className="kpi-credits-grid">
        <div className="kpi-credit-card">
          <div className="kpi-credit-card-header">
            <div className="kpi-credit-icon" style={{ background: '#091127', color: '#ffffff' }}>
              <Icons.Receipt />
            </div>
            <span className="kpi-credit-label">A Crédito</span>
          </div>
          <div className="kpi-credit-value">
            {formatNumber(creditCount)}
          </div>
          <div className="kpi-credit-subtitle">Órdenes en crédito activo</div>
        </div>

        <div className="kpi-credit-card">
          <div className="kpi-credit-card-header">
            <div className="kpi-credit-icon" style={{ background: '#091127', color: '#ffffff' }}>
              <Icons.Clock />
            </div>
            <span className="kpi-credit-label">Pago Pendiente &gt;3 días</span>
          </div>
          <div className="kpi-credit-value">
            {formatNumber(pendingCount)}
          </div>
          <div className="kpi-credit-subtitle">
            {pendingCount > 0 ? 'Órdenes esperando pago' : 'Todo al día'}
          </div>
        </div>

        <div className="kpi-credit-card">
          <div className="kpi-credit-card-header">
            <div className="kpi-credit-icon" style={{ background: '#091127', color: '#ffffff' }}>
              <Icons.AlertCircle />
            </div>
            <span className="kpi-credit-label">Pagos Pendientes</span>
          </div>
          <div className="kpi-credit-value">{formatNumber(pendingPaymentCount)}</div>
          <div className="kpi-credit-subtitle">Sin ningún pago registrado</div>
        </div>

        <div className="kpi-credit-card">
          <div className="kpi-credit-card-header">
            <div className="kpi-credit-icon" style={{ background: '#091127', color: '#ffffff' }}>
              <Icons.AlertCircle />
            </div>
            <span className="kpi-credit-label">Pagos Parciales</span>
          </div>
          <div className="kpi-credit-value">{formatNumber(partialCount)}</div>
          <div className="kpi-credit-subtitle">Abono parcial con saldo pendiente</div>
        </div>
      </div>
    </div>
  )
}
