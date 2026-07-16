import { useState, useMemo } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays } from '../../utils/kpiHelpers'
import KPISellerIntelligence from './KPISellerIntelligence'

const SEMANTIC = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral:  { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
}

const DESIGNER_COLORS = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#EDE9FE', '#7C3AED', '#6D28D9', '#5B21B6', '#4C1D95', '#3B0764']

const PAGE_SIZE = 7

const ROLE_LABELS = {
  seller: 'Vendedor', designer: 'Diseñador',
  digital_producer: 'Producción Digital', dtf_producer: 'Producción DTF',
  ploteo_producer: 'Producción Ploteo', admin: 'Administrador',
  quote: 'Caja', delivery: 'Entrega', printer: 'Producción',
}

function Pagination({ page, total, pageSize, onPage }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => onPage(page - 1)} disabled={page === 0}
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: page === 0 ? '#F8FAFC' : '#fff', color: page === 0 ? '#CBD5E1' : '#475569', cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(180deg)' }}>
        <Icons.ChevronRight size={14} />
      </button>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>{page + 1} / {totalPages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1}
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: page >= totalPages - 1 ? '#F8FAFC' : '#fff', color: page >= totalPages - 1 ? '#CBD5E1' : '#475569', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.ChevronRight size={14} />
      </button>
    </div>
  )
}

export default function KPIUserAnalytics({ data, period, customDateFrom, customDateTo, onSellerClick }) {
  const [inactivePage, setInactivePage] = useState(0)

  const users = useMemo(() => data?.user_analytics || {}, [data])
  const designers = useMemo(() => users.designers || [], [users])
  const inactiveUsers = useMemo(() => users.inactive_users || [], [users])

  const totalEmployeesAll = data?.total_employees_all || 0
  const activeEmployees = totalEmployeesAll - inactiveUsers.length

  const designerPieData = useMemo(() => {
    const total = designers.reduce((s, d) => s + (d.orders_processed || 0), 0)
    return designers.slice(0, 10).map((d, i) => ({
      name: d.name,
      value: d.orders_processed || 0,
      pct: total > 0 ? Math.round((d.orders_processed / total) * 1000) / 10 : 0,
      color: DESIGNER_COLORS[i % DESIGNER_COLORS.length],
      avg_days_per_order: d.avg_days_per_order || 0,
    }))
  }, [designers])

  if (!data) return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Empleados</span>
          <h2 className="kpi-section-title">Estado del Equipo</h2>
          <p className="kpi-section-subtitle">Vista general del equipo de trabajo</p>
        </div>
      </div>
      <div className="kpi-empty-state">
        <div className="kpi-empty-icon"><Icons.Users size={28} /></div>
        <div className="kpi-empty-title">Sin datos disponibles</div>
        <div className="kpi-empty-message">Los datos de empleados aún no están disponibles. Intenta refrescar el panel.</div>
      </div>
    </div>
  )

  const heroCards = [
    { label: 'Total Empleados', value: formatNumber(totalEmployeesAll), icon: Icons.Users, trend: totalEmployeesAll > 0 ? { color: SEMANTIC.neutral.trendColor, text: 'Todos' } : null },
    { label: 'Empleados Activos', value: formatNumber(activeEmployees), icon: Icons.UserCheck, trend: activeEmployees > 0 ? { color: SEMANTIC.positive.trendColor, text: 'Recientes' } : null },
    { label: 'Inactivos (7d+)', value: formatNumber(inactiveUsers.length), icon: Icons.UserMinus, trend: inactiveUsers.length > 0 ? { color: SEMANTIC.negative.trendColor, text: 'Atención' } : { color: SEMANTIC.positive.trendColor, text: 'OK' } },
  ]

  const inactivePaged = inactiveUsers.slice(inactivePage * PAGE_SIZE, (inactivePage + 1) * PAGE_SIZE)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Empleados</span>
          <h2 className="kpi-section-title">Estado del Equipo</h2>
          <p className="kpi-section-subtitle">Vista general del equipo de trabajo</p>
        </div>
      </div>

      {/* Hero Cards */}
      <div className="kpi-hero-grid kpi-hero-grid--3" style={{ marginBottom: 24 }}>
        {heroCards.map((h, i) => {
          const Icon = h.icon
          return (
            <div key={i} className="kpi-hero-card">
              <div className="kpi-hero-header">
                <div className="kpi-hero-label">{h.label}</div>
                <div className="kpi-hero-icon"><Icon size={18} /></div>
              </div>
              <div className="kpi-hero-value">{h.value}</div>
              {h.trend && (
                <div className="kpi-hero-footer">
                  <span className="kpi-hero-trend" style={{ background: h.trend.color + '18', color: h.trend.color }}>{h.trend.text}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="kpi-grid-2col">
        {/* Diseñadores Pie */}
        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle">Ranking de Diseñadores</h3>
          {designerPieData.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 16 }}>
              <div style={{ flex: '0 0 200px', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={designerPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                      {designerPieData.map((e, i) => <Cell key={i} fill={e.color} stroke="#fff" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip wrapperStyle={{ zIndex: 9999 }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
                          <p style={{ margin: 0, fontWeight: 600, color: d.color }}>{d.name}</p>
                          <p style={{ margin: '4px 0 0', fontWeight: 500 }}>{formatNumber(d.value)} órdenes — {d.pct}%</p>
                        </div>
                      )
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
                {designerPieData.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e8edf8' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#091127', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{i + 1} {item.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: item.color, flexShrink: 0 }}>{item.pct}%</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${item.pct}%`, height: '100%', background: item.color, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>{formatNumber(item.value)} ord.</span>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          Tiempo promedio: <span style={{ fontWeight: 600, color: item.avg_days_per_order <= 3 ? '#10B981' : item.avg_days_per_order <= 5 ? '#F59E0B' : '#EF4444' }}>{formatDays(item.avg_days_per_order)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de diseñadores</div></div>
          )}
        </div>
      </div>

      {/* Centro de Inteligencia Comercial */}
      <KPISellerIntelligence period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} onSellerClick={onSellerClick} />

      {/* Inactive Users */}
      {inactiveUsers.length > 0 && (
        <div className="kpi-card" style={{ padding: 0, marginTop: 20 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #DDE3EF' }}>
            <h3 className="kpi-card-subtitle danger" style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>Empleados Inactivos (7+ días)</h3>
          </div>
          <table className="kpi-table">
            <thead>
              <tr><th>Nombre</th><th>Rol</th><th>Última Actividad</th></tr>
            </thead>
            <tbody>
              {inactivePaged.map((u, i) => (
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
          <div style={{ padding: '12px 20px', borderTop: '1px solid #DDE3EF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>{inactiveUsers.length} empleado{inactiveUsers.length !== 1 ? 's' : ''}</span>
            <Pagination page={inactivePage} total={inactiveUsers.length} pageSize={PAGE_SIZE} onPage={setInactivePage} />
          </div>
        </div>
      )}
    </div>
  )
}
