import { useState, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatNumber, formatDays, KPI_CHART_COLORS } from '../../utils/kpiHelpers'
import KPITooltip from '../ui/KPITooltip'

const PALETTE = { pie: KPI_CHART_COLORS }

const SEMANTIC = {
  positive: { iconBg: '#DCFCE7', iconColor: '#16A34A', trendBg: '#DCFCE7', trendColor: '#16A34A' },
  negative: { iconBg: '#FEE2E2', iconColor: '#DC2626', trendBg: '#FEE2E2', trendColor: '#DC2626' },
  neutral:  { iconBg: '#E0F2FE', iconColor: '#0284C7', trendBg: '#E0F2FE', trendColor: '#0284C7' },
}

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

export default function KPIUserAnalytics({ data }) {
  const [sellerSearch, setSellerSearch] = useState('')
  const [sellerSort, setSellerSort] = useState('orders')
  const [sellerPage, setSellerPage] = useState(0)
  const [inactivePage, setInactivePage] = useState(0)

  const users = data?.user_analytics || {}
  const sellers = useMemo(() => users.sellers || [], [users])
  const designers = useMemo(() => users.designers || [], [users])
  const inactiveUsers = useMemo(() => users.inactive_users || [], [users])

  const filteredSellers = useMemo(() => {
    let list = [...sellers]
    if (sellerSearch) {
      const q = sellerSearch.toLowerCase()
      list = list.filter(s => s.name?.toLowerCase().includes(q))
    }
    switch (sellerSort) {
      case 'name': list.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break
      case 'rate': list.sort((a, b) => (b.completed_rate || 0) - (a.completed_rate || 0)); break
      case 'days': list.sort((a, b) => (a.avg_cycle_days || 999) - (b.avg_cycle_days || 999)); break
      default: list.sort((a, b) => (b.orders_created || 0) - (a.orders_created || 0))
    }
    return list
  }, [sellers, sellerSearch, sellerSort])

  if (!data) return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Usuarios</span>
          <h2 className="kpi-section-title">Productividad de Usuarios</h2>
          <p className="kpi-section-subtitle">Rankings y rendimiento por rol</p>
        </div>
      </div>
      <div className="kpi-empty-state">
        <div className="kpi-empty-icon"><Icons.Users size={28} /></div>
        <div className="kpi-empty-title">Sin datos disponibles</div>
        <div className="kpi-empty-message">Los datos de usuarios aún no están disponibles. Intenta refrescar el panel.</div>
      </div>
    </div>
  )

  const totalOrders = sellers.reduce((s, se) => s + (se.orders_created || 0), 0)
  const avgCompletion = sellers.length > 0
    ? Math.round(sellers.reduce((s, se) => s + (se.completed_rate || 0), 0) / sellers.length)
    : 0
  const avgDays = sellers.length > 0
    ? (sellers.reduce((s, se) => s + (se.avg_cycle_days || 0), 0) / sellers.length)
    : 0

  const heroCards = [
    { label: 'Total Vendedores', value: formatNumber(sellers.length), icon: Icons.User, trend: sellers.length > 0 ? { color: SEMANTIC.positive.trendColor, text: 'Activos' } : null },
    { label: 'Total Diseñadores', value: formatNumber(designers.length), icon: Icons.Brush, trend: designers.length > 0 ? { color: SEMANTIC.positive.trendColor, text: 'Activos' } : null },
    { label: 'Órdenes Totales', value: formatNumber(totalOrders), icon: Icons.Orders },
    { label: '% Completado Prom.', value: `${avgCompletion}%`, icon: Icons.Check, trend: avgCompletion >= 80 ? { color: SEMANTIC.positive.trendColor, text: 'Bueno' } : { color: SEMANTIC.negative.trendColor, text: 'Mejorar' } },
    { label: 'Días Promedio', value: formatDays(avgDays), icon: Icons.Clock },
    { label: 'Inactivos (7d+)', value: formatNumber(inactiveUsers.length), icon: Icons.UserMinus, trend: inactiveUsers.length > 0 ? { color: SEMANTIC.negative.trendColor, text: 'Atención' } : { color: SEMANTIC.positive.trendColor, text: 'OK' } },
  ]

  const sellerPaged = filteredSellers.slice(sellerPage * PAGE_SIZE, (sellerPage + 1) * PAGE_SIZE)

  const sellerBarData = sellers.slice(0, 10).map(s => ({
    name: s.name?.length > 12 ? s.name.slice(0, 12) + '...' : s.name,
    'Órdenes': s.orders_created,
  }))

  const designerBarData = designers.slice(0, 10).map(d => ({
    name: d.name?.length > 12 ? d.name.slice(0, 12) + '...' : d.name,
    'Procesadas': d.orders_processed,
  }))

  const inactivePaged = inactiveUsers.slice(inactivePage * PAGE_SIZE, (inactivePage + 1) * PAGE_SIZE)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Usuarios</span>
          <h2 className="kpi-section-title">Productividad de Usuarios</h2>
          <p className="kpi-section-subtitle">Rankings y rendimiento por rol</p>
        </div>
      </div>

      {/* Hero Cards */}
      <div className="kpi-hero-grid kpi-hero-grid--6" style={{ marginBottom: 24 }}>
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
        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle">Ranking de Vendedores</h3>
          {sellerBarData.length > 0 ? (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sellerBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<KPITooltip />} wrapperStyle={{ zIndex: 9999 }} />
                  <Bar dataKey="Órdenes" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de vendedores</div></div>
          )}
        </div>

        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle">Ranking de Diseñadores</h3>
          {designerBarData.length > 0 ? (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={designerBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<KPITooltip />} wrapperStyle={{ zIndex: 9999 }} />
                  <Bar dataKey="Procesadas" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="kpi-empty-state" style={{ padding: 20 }}><div className="kpi-empty-title">Sin datos de diseñadores</div></div>
          )}
        </div>
      </div>

      {/* Seller Table */}
      <div className="kpi-card" style={{ padding: 0, marginTop: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #DDE3EF' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <h3 className="kpi-card-subtitle" style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>Detalle por Vendedor</h3>
            <div className="kpi-filter-row" style={{ gap: 10 }}>
              <label style={{ flex: '1 1 160px', minWidth: 160 }}>
                <div style={{ position: 'relative' }}>
                  <Icons.Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                  <input type="text" placeholder="Buscar vendedor..." value={sellerSearch}
                    onChange={e => { setSellerSearch(e.target.value); setSellerPage(0) }}
                    style={{ paddingLeft: 32 }} />
                </div>
              </label>
              <label style={{ flex: '0 0 140px' }}>
                <select value={sellerSort} onChange={e => setSellerSort(e.target.value)}>
                  <option value="orders">Más órdenes</option>
                  <option value="rate">Mejor % completado</option>
                  <option value="days">Menor días promedio</option>
                  <option value="name">Nombre A-Z</option>
                </select>
              </label>
            </div>
          </div>
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
            {sellerPaged.map((s, i) => (
              <tr key={s.id || i}>
                <td className="kpi-table-rank">{sellerPage * PAGE_SIZE + i + 1}</td>
                <td className="kpi-table-name">{s.name}</td>
                <td>{ROLE_LABELS[s.role] || s.role}</td>
                <td className="kpi-table-stat">{s.orders_created}</td>
                <td className="kpi-table-stat">
                  <span style={{ color: (s.completed_rate || 0) >= 80 ? '#10B981' : (s.completed_rate || 0) >= 50 ? '#F59E0B' : '#EF4444' }}>
                    {s.completed_rate || 0}%
                  </span>
                </td>
                <td className="kpi-table-stat">{formatDays(s.avg_cycle_days)}</td>
              </tr>
            ))}
            {sellerPaged.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#8899B5' }}>
                {sellerSearch ? 'No se encontraron vendedores' : 'Sin datos disponibles'}
              </td></tr>
            )}
          </tbody>
        </table>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #DDE3EF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>{filteredSellers.length} vendedor{filteredSellers.length !== 1 ? 'es' : ''}</span>
          <Pagination page={sellerPage} total={filteredSellers.length} pageSize={PAGE_SIZE} onPage={setSellerPage} />
        </div>
      </div>

      {/* Inactive Users */}
      {inactiveUsers.length > 0 && (
        <div className="kpi-card" style={{ padding: 0, marginTop: 20 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #DDE3EF' }}>
            <h3 className="kpi-card-subtitle danger" style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>Usuarios Inactivos (7+ días)</h3>
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
            <span style={{ fontSize: 12, color: '#64748b' }}>{inactiveUsers.length} usuario{inactiveUsers.length !== 1 ? 's' : ''}</span>
            <Pagination page={inactivePage} total={inactiveUsers.length} pageSize={PAGE_SIZE} onPage={setInactivePage} />
          </div>
        </div>
      )}
    </div>
  )
}
