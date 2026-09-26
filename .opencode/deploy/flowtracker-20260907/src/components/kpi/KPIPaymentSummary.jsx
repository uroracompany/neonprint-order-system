import { formatNumber } from '../../utils/kpiHelpers'

const PAYMENT_CONFIG = {
  pagado: { label: 'Pagado', color: '#10B981', bg: '#ECFDF5' },
  parcial: { label: 'Parcial', color: '#F59E0B', bg: '#FFFBEB' },
  credito: { label: 'Crédito', color: '#8B5CF6', bg: '#F5F3FF' },
  pending_payment: { label: 'Pendiente', color: '#EF4444', bg: '#FEF2F2' },
}

export default function KPIPaymentSummary({ data }) {
  if (!data) return null

  const paymentBreakdown = data.orders_analytics?.payment_status_breakdown || {}
  const totalOrders = Object.values(paymentBreakdown).reduce((sum, v) => sum + v, 0) || 1

  const paymentItems = Object.entries(PAYMENT_CONFIG)
    .map(([key, config]) => ({
      key,
      ...config,
      count: paymentBreakdown[key] || 0,
      pct: ((paymentBreakdown[key] || 0) / totalOrders) * 100,
    }))
    .filter(item => item.count > 0)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Cobros</span>
          <h2 className="kpi-section-title">Estado de Pagos</h2>
          <p className="kpi-section-subtitle">Distribución de métodos de pago en el período</p>
        </div>
      </div>

      <div className="kpi-payment-card">
        <div className="kpi-payment-grid">
          {paymentItems.map(item => (
            <div key={item.key} className="kpi-payment-item">
              <div className="kpi-payment-item-header">
                <div className="kpi-payment-dot" style={{ background: item.color }} />
                <span className="kpi-payment-label">{item.label}</span>
              </div>
              <div className="kpi-payment-value" style={{ color: item.color }}>
                {formatNumber(item.count)}
              </div>
              <div className="kpi-payment-bar-wrapper">
                <div
                  className="kpi-payment-bar"
                  style={{
                    width: `${item.pct}%`,
                    background: item.color,
                  }}
                />
              </div>
              <div className="kpi-payment-pct">{item.pct.toFixed(1)}%</div>
            </div>
          ))}
        </div>

        {paymentBreakdown.pending_payment > 0 && (
          <div className="kpi-payment-alert">
            <span className="kpi-payment-alert-icon">⚠</span>
            <span>{paymentBreakdown.pending_payment} orden{paymentBreakdown.pending_payment !== 1 ? 'es' : ''} sin pago confirmado</span>
          </div>
        )}
      </div>
    </div>
  )
}
