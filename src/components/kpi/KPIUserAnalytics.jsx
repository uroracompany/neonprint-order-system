import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatDays } from '../../utils/kpiHelpers'

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: 12, boxShadow: '0 4px 16px rgba(15,30,64,0.10)', fontSize: 13 }}>
        <p style={{ margin: 0, fontWeight: 600, color: '#0f1e40' }}>{label}</p>
        {payload.map((entry, idx) => (
          <p key={idx} style={{ margin: '4px 0 0', color: entry.color, fontWeight: 500 }}>{entry.name}: {entry.value}</p>
        ))}
      </div>
    )
  }
  return null
}

export default function KPIUserAnalytics({ data }) {
  if (!data) return null

  const users = data.user_analytics || {}
  const sellers = users.sellers || []
  const designers = users.designers || []
  const inactiveUsers = users.inactive_users || []

  const sellerBarData = sellers.map(s => ({
    name: s.name?.length > 10 ? s.name.slice(0, 10) + '...' : s.name,
    'Órdenes': s.orders_created,
    '% Completado': s.completed_rate || 0,
  }))

  const designerBarData = designers.map(d => ({
    name: d.name?.length > 10 ? d.name.slice(0, 10) + '...' : d.name,
    'Procesadas': d.orders_processed,
    'Días Promedio': d.avg_days_per_order ? Math.round(d.avg_days_per_order) : 0,
  }))

  const ROLE_LABELS = {
    seller: 'Vendedor',
    designer: 'Diseñador',
    digital_producer: 'Producción Digital',
    dtf_producer: 'Producción DTF',
    ploteo_producer: 'Producción Ploteo',
    admin: 'Administrador',
    quote: 'Caja',
    delivery: 'Entrega',
    printer: 'Producción',
  }

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Usuarios</span>
          <h2 className="kpi-section-title">Productividad de Usuarios</h2>
          <p className="kpi-section-subtitle">Rankings y rendimiento por rol</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle">
            Ranking de Vendedores
          </h3>
          {sellers.length > 0 ? (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sellerBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Órdenes" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#8899B5', fontSize: 13 }}>Sin datos de vendedores</div>
          )}
        </div>

        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle">
            Ranking de Diseñadores
          </h3>
          {designers.length > 0 ? (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={designerBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Procesadas" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#8899B5', fontSize: 13 }}>Sin datos de diseñadores</div>
          )}
        </div>
      </div>

      <div className="kpi-table-wrapper">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #DDE3EF' }}>
          <h3 className="kpi-card-subtitle" style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>Detalle por Vendedor</h3>
        </div>
        <table className="kpi-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Órdenes</th>
              <th>% Completado</th>
              <th>Días Promedio</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s, i) => (
              <tr key={s.id}>
                <td className="kpi-table-rank">{i + 1}</td>
                <td className="kpi-table-name">{s.name}</td>
                <td>{ROLE_LABELS[s.role] || s.role}</td>
                <td className="kpi-table-stat">{s.orders_created}</td>
                <td className="kpi-table-stat">{s.completed_rate || 0}%</td>
                <td className="kpi-table-stat">{formatDays(s.avg_cycle_days)}</td>
              </tr>
            ))}
            {sellers.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#8899B5' }}>Sin datos disponibles</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {inactiveUsers.length > 0 && (
        <div className="kpi-table-wrapper" style={{ marginTop: 20 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #DDE3EF' }}>
            <h3 className="kpi-card-subtitle danger" style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>Usuarios Inactivos (7+ días)</h3>
          </div>
          <table className="kpi-table">
            <thead>
              <tr><th>Nombre</th><th>Rol</th><th>Última Actividad</th></tr>
            </thead>
            <tbody>
              {inactiveUsers.map((u, i) => (
                <tr key={i}>
                  <td className="kpi-table-name">{u.name}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="kpi-table-stat" style={{ color: '#EF4444' }}>
                    {u.last_activity ? new Date(u.last_activity).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}