import { useState, useMemo } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber } from '../../utils/kpiHelpers'
import KPISellerIntelligence from './KPISellerIntelligence'
import KPIDesignIntelligence from './KPIDesignIntelligence'
import KPIQuoteIntelligence from './KPIQuoteIntelligence'
import KPIProductionIntelligence from './KPIProductionIntelligence'
import KPIDeliveryIntelligence from './KPIDeliveryIntelligence'

const SEMANTIC = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral:  { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
}

const DESIGNER_COLORS = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#EDE9FE', '#7C3AED', '#6D28D9', '#5B21B6', '#4C1D95', '#3B0764']
const SELLER_COLORS = ['#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A', '#FEF3C7', '#D97706', '#B45309', '#92400E', '#78350F', '#451A03']

const PAGE_SIZE = 7

const DEPARTMENTS = [
  { key: 'general', label: 'General', icon: Icons.Users },
  { key: 'sales', label: 'Equipo de Ventas', icon: Icons.TrendUp },
  { key: 'design', label: 'Equipo de Diseño', icon: Icons.Brush },
  { key: 'quote', label: 'Equipo de Caja', icon: Icons.Money },
  { key: 'production', label: 'Equipo de Producción', icon: Icons.Package },
  { key: 'delivery', label: 'Equipo de Entrega', icon: Icons.Truck },
]

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

export default function KPIUserAnalytics({
  data,
  period,
  customDateFrom,
  customDateTo,
  onSellerClick,
  onDesignerClick,
  onQuoteClick,
  onProductionAreaClick,
  onProductionEmployeeClick,
  onDeliveryUserClick,
}) {
  const [inactivePage, setInactivePage] = useState(0)
  const [departmentFilter, setDepartmentFilter] = useState('general')

  const users = useMemo(() => data?.user_analytics || {}, [data])
  const designers = useMemo(() => users.designers || [], [users])
  const sellers = useMemo(() => users.sellers || [], [users])
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

  const sellerPieData = useMemo(() => {
    const total = sellers.reduce((s, d) => s + (d.orders_created || 0), 0)
    return sellers.slice(0, 10).map((d, i) => ({
      name: d.name,
      value: d.orders_created || 0,
      pct: total > 0 ? Math.round((d.orders_created / total) * 1000) / 10 : 0,
      color: SELLER_COLORS[i % SELLER_COLORS.length],
      avg_cycle_days: d.avg_cycle_days || 0,
    }))
  }, [sellers])

  if (!data) return (
    <div className="kpi-section">
      <div className="kpi-employee-panel-header">
        <div className="kpi-employee-panel-icon"><Icons.Users size={22} /></div>
        <div className="kpi-employee-panel-text">
          <div className="kpi-employee-panel-kicker">Panel de Empleados</div>
          <h2 className="kpi-employee-panel-title">Estado del Equipo</h2>
          <p className="kpi-employee-panel-subtitle">Vista general del equipo de trabajo</p>
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
      {/* Department Filter Bar */}
      <div className="kpi-dept-filter-bar">
        {DEPARTMENTS.map(dept => {
          const DeptIcon = dept.icon
          return (
            <button
              key={dept.key}
              className={`kpi-dept-filter-btn ${departmentFilter === dept.key ? 'active' : ''}`}
              onClick={() => setDepartmentFilter(dept.key)}
            >
              <DeptIcon size={14} />
              <span>{dept.label}</span>
            </button>
          )
        })}
      </div>

      {/* ═══ GENERAL VIEW ═══ */}
      {departmentFilter === 'general' && (
        <>
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

          {/* Rankings */}
          <div className="kpi-grid-2col">
            {/* Diseñadores Pie */}
            <div className="kpi-card" style={{ padding: 24 }}>
              <h3 className="kpi-card-subtitle">Ranking de Diseñadores</h3>
              {designerPieData.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 16, minWidth: 0 }}>
                  <div style={{ position: 'relative', width: '40%', minWidth: 130, maxWidth: 180, aspectRatio: '1', flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={designerPieData} cx="50%" cy="50%" innerRadius="48%" outerRadius="70%" paddingAngle={3} dataKey="value">
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
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#000', lineHeight: 1 }}>100%</div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: '#64748b', marginTop: 2 }}>cobertura</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto', minWidth: 0 }}>
                    {designerPieData.map((item, i) => (
                      <div key={i} onClick={() => onDesignerClick?.(designers[i]?.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 10,
                        background: i === 0 ? '#F5F3FF' : '#f8fafc',
                        border: i === 0 ? '1px solid #DDD6FE' : '1px solid #e8edf8',
                        cursor: 'pointer', transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#8B5CF6'; e.currentTarget.style.background = '#F5F3FF' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = i === 0 ? '#DDD6FE' : '#e8edf8'; e.currentTarget.style.background = i === 0 ? '#F5F3FF' : '#f8fafc' }}
                      >
                        <div style={{
                          width: 26, height: 26, borderRadius: 7,
                          background: '#8B5CF6',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#091127', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#8B5CF6', flexShrink: 0 }}>{item.pct}%</span>
                          </div>
                          <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(item.pct || 0, 100)}%`, height: '100%', background: '#8B5CF6', borderRadius: 3, transition: 'width 0.6s ease' }} />
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{formatNumber(item.value)} órdenes totales</div>
                        </div>
                        <Icons.ArrowRight size={13} style={{ color: '#94A3B8', flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de diseñadores</div></div>
              )}
            </div>

            {/* Vendedores Pie */}
            <div className="kpi-card" style={{ padding: 24 }}>
              <h3 className="kpi-card-subtitle">Ranking de Vendedores</h3>
              {sellerPieData.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 16, minWidth: 0 }}>
                  <div style={{ position: 'relative', width: '40%', minWidth: 130, maxWidth: 180, aspectRatio: '1', flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={sellerPieData} cx="50%" cy="50%" innerRadius="48%" outerRadius="70%" paddingAngle={3} dataKey="value">
                          {sellerPieData.map((e, i) => <Cell key={i} fill={e.color} stroke="#fff" strokeWidth={2} />)}
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
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#000', lineHeight: 1 }}>100%</div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: '#64748b', marginTop: 2 }}>cobertura</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto', minWidth: 0 }}>
                    {sellerPieData.map((item, i) => (
                      <div key={i} onClick={() => onSellerClick?.(sellers[i]?.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 10,
                        background: i === 0 ? '#FFFBEB' : '#f8fafc',
                        border: i === 0 ? '1px solid #FDE68A' : '1px solid #e8edf8',
                        cursor: 'pointer', transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.background = '#FFFBEB' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = i === 0 ? '#FDE68A' : '#e8edf8'; e.currentTarget.style.background = i === 0 ? '#FFFBEB' : '#f8fafc' }}
                      >
                        <div style={{
                          width: 26, height: 26, borderRadius: 7,
                          background: '#F59E0B',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#091127', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', flexShrink: 0 }}>{item.pct}%</span>
                          </div>
                          <div style={{ height: 4, background: '#e8edf8', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(item.pct || 0, 100)}%`, height: '100%', background: '#F59E0B', borderRadius: 3, transition: 'width 0.6s ease' }} />
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{formatNumber(item.value)} órdenes totales</div>
                        </div>
                        <Icons.ArrowRight size={13} style={{ color: '#94A3B8', flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de vendedores</div></div>
              )}
            </div>
          </div>

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
        </>
      )}

      {/* ═══ SALES VIEW ═══ */}
      {departmentFilter === 'sales' && (
        <KPISellerIntelligence period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} onSellerClick={onSellerClick} />
      )}

      {/* ═══ DESIGN VIEW ═══ */}
      {departmentFilter === 'design' && (
        <KPIDesignIntelligence period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} onDesignerClick={onDesignerClick} />
      )}

      {/* ═══ QUOTE VIEW ═══ */}
      {departmentFilter === 'quote' && (
        <KPIQuoteIntelligence period={period} customDateFrom={customDateFrom} customDateTo={customDateTo} onQuoteClick={onQuoteClick} />
      )}

      {/* ═══ PRODUCTION VIEW ═══ */}
      {departmentFilter === 'production' && (
        <KPIProductionIntelligence
          period={period}
          customDateFrom={customDateFrom}
          customDateTo={customDateTo}
          onAreaClick={onProductionAreaClick}
          onEmployeeClick={onProductionEmployeeClick}
        />
      )}

      {/* ═══ DELIVERY VIEW ═══ */}
      {departmentFilter === 'delivery' && (
        <KPIDeliveryIntelligence
          period={period}
          customDateFrom={customDateFrom}
          customDateTo={customDateTo}
          onDeliveryUserClick={onDeliveryUserClick}
        />
      )}
    </div>
  )
}
