import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { Icons } from '../../utils/icons'
import { formatDays } from '../../utils/kpiHelpers'

const AREA_LABELS = {
  digital: 'Digital',
  dtf: 'DTF',
  ploteo: 'Ploteo',
}

const AREA_COLORS = {
  digital: '#06B6D4',
  dtf: '#F43F5E',
  ploteo: '#F59E0B',
}

const STATUS_COLORS = {
  pending: '#F59E0B',
  in_production: '#F97316',
  in_termination: '#0EA5E9',
  completed: '#10B981',
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: 12, boxShadow: '0 4px 16px rgba(15,30,64,0.10)', fontSize: 13 }}>
        <p style={{ margin: 0, fontWeight: 600, color: '#0f1e40' }}>{label}</p>
        {payload.map((entry, idx) => (
          <p key={idx} style={{ margin: '4px 0 0', color: entry.color || entry.fill, fontWeight: 500 }}>{entry.name}: {entry.value}</p>
        ))}
      </div>
    )
  }
  return null
}

export default function KPIProductionInsights({ data }) {
  if (!data) return null

  const prod = data.production_insights || {}
  const areaLoad = prod.area_load || {}
  const stageTiming = prod.stage_timing || {}
  const bottlenecks = prod.bottlenecks || []
  const fileStatus = prod.file_status || {}

  const areaBarData = Object.entries(areaLoad).map(([code, stats]) => ({
    name: AREA_LABELS[code] || code,
    Pendientes: stats.pending || 0,
    Producción: stats.in_production || 0,
    Terminación: stats.in_termination || 0,
    Completados: stats.completed || 0,
  }))

  const filePieData = [
    { name: 'Pendientes', value: fileStatus.pending || 0, color: '#F59E0B' },
    { name: 'En Producción', value: fileStatus.in_production || 0, color: '#F97316' },
    { name: 'En Terminación', value: fileStatus.in_termination || 0, color: '#0EA5E9' },
    { name: 'Completados', value: fileStatus.completed || 0, color: '#10B981' },
  ].filter(d => d.value > 0)

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Producción</span>
          <h2 className="kpi-section-title">Insights de Producción</h2>
          <p className="kpi-section-subtitle">Carga por área, tiempos y cuellos de botella</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginBottom: 32 }}>
        {Object.entries(areaLoad).map(([code, stats]) => (
          <div key={code} className="kpi-card" style={{ borderLeft: `4px solid ${AREA_COLORS[code]}` }}>
            <div className="kpi-card-header">
              <div className="kpi-card-title" style={{ color: AREA_COLORS[code] }}>{AREA_LABELS[code] || code}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: '#F59E0B' }}>{stats.pending || 0}</div><div style={{ fontSize: 11, color: '#8899B5' }}>Pendientes</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: '#F97316' }}>{stats.in_production || 0}</div><div style={{ fontSize: 11, color: '#8899B5' }}>Producción</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: '#0EA5E9' }}>{stats.in_termination || 0}</div><div style={{ fontSize: 11, color: '#8899B5' }}>Terminación</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: '#10B981' }}>{stats.completed || 0}</div><div style={{ fontSize: 11, color: '#8899B5' }}>Completados</div></div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle">Carga por Área</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={areaBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
                <Bar dataKey="Pendientes" stackId="a" fill="#F59E0B" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Producción" stackId="a" fill="#F97316" />
                <Bar dataKey="Terminación" stackId="a" fill="#0EA5E9" />
                <Bar dataKey="Completados" stackId="a" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="kpi-card" style={{ padding: 24 }}>
          <h3 className="kpi-card-subtitle">Archivos por Estado</h3>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={filePieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {filePieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div style={{ borderTop: '1px solid #DDE3EF', paddingTop: 16, marginTop: 16 }}>
            <h4 style={{ fontSize: 12, fontWeight: 600, color: '#4A5E80', marginBottom: 8 }}>Tiempo Promedio por Etapa</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ fontSize: 13 }}><span style={{ color: '#8899B5' }}>Diseño → Caja:</span> <strong>{formatDays(stageTiming.design_to_quote)}</strong></div>
              <div style={{ fontSize: 13 }}><span style={{ color: '#8899B5' }}>Caja → Producción:</span> <strong>{formatDays(stageTiming.quote_to_production)}</strong></div>
              <div style={{ fontSize: 13 }}><span style={{ color: '#8899B5' }}>Producción → Terminación:</span> <strong>{formatDays(stageTiming.production_to_termination)}</strong></div>
              <div style={{ fontSize: 13 }}><span style={{ color: '#8899B5' }}>Terminación → Completado:</span> <strong>{formatDays(stageTiming.termination_to_completion)}</strong></div>
            </div>
          </div>
        </div>
      </div>

      {bottlenecks.length > 0 && (
        <div className="kpi-table-wrapper">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #DDE3EF' }}>
            <h3 className="kpi-card-subtitle danger" style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>Cuellos de Botella (&gt;3 días en etapa)</h3>
          </div>
          <table className="kpi-table">
            <thead>
              <tr><th>Orden</th><th>Cliente</th><th>Etapa</th><th>Días</th></tr>
            </thead>
            <tbody>
              {bottlenecks.slice(0, 15).map((b, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>#{b.order_id?.slice(0, 8)}</td>
                  <td className="kpi-table-name">{b.client_name || 'Sin nombre'}</td>
                  <td>
                    <span style={{
                      padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: '#FEE2E2', color: '#991B1B',
                    }}>{b.stage}</span>
                  </td>
                  <td className="kpi-table-stat" style={{ color: b.days_in_stage > 7 ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>
                    {Math.round(b.days_in_stage)}d
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