import { useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts'

const PALETTE = {
  cyan: '#06B6D4', green: '#10B981', rose: '#F43F5E', amber: '#F59E0B',
  violet: '#8B5CF6', orange: '#F97316', pink: '#EC4899', teal: '#14B8A6',
  indigo: '#6366F1', red: '#EF4444',
  pie: ['#06B6D4', '#F43F5E', '#F59E0B', '#10B981', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#6366F1', '#EF4444'],
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #DDE3EF', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(15,30,64,0.08)', fontSize: 13 }}>
      {label && <p style={{ margin: 0, fontWeight: 600, color: '#091127', marginBottom: 4 }}>{label}</p>}
      {payload.map((e, i) => (
        <p key={i} style={{ margin: '2px 0', color: e.color || e.payload?.color, fontWeight: 500 }}>{e.name}: {e.value}</p>
      ))}
    </div>
  )
}

export default function KPIMaterialsAnalytics({ data }) {
  const [materialIdx, setMaterialIdx] = useState(-1)
  const [materialSearch, setMaterialSearch] = useState('')
  const [materialPage, setMaterialPage] = useState(0)
  const MATERIAL_PAGE_SIZE = 8
  const [selectedMaterialAnalysis, setSelectedMaterialAnalysis] = useState(-1)
  const [materialAnalysisSearch, setMaterialAnalysisSearch] = useState('')

  if (!data) return null

  const kpis = data.client_kpis || {}
  const materialsByClient = kpis.materials_by_client || []
  const materialAnalytics = kpis.material_analytics || {}
  const materialSummary = materialAnalytics.summary || []

  return (
    <div className="kpi-section">
      <div className="kpi-section-header">
        <div>
          <span className="kpi-section-kicker">Panel de Materiales</span>
          <h2 className="kpi-section-title">Análisis de Materiales</h2>
          <p className="kpi-section-subtitle">Ranking, uso y tendencias de materiales en órdenes.</p>
        </div>
      </div>

      {materialsByClient.length > 0 && (() => {
        const filteredMaterials = materialsByClient.filter(cl => cl.client_name?.toLowerCase().includes(materialSearch.toLowerCase()))
        const isAllMaterials = materialIdx === -1

        if (isAllMaterials) {
          const globalMaterials = {}
          materialsByClient.forEach(cl => {
            cl.materials.forEach(m => {
              globalMaterials[m.name] = (globalMaterials[m.name] || 0) + m.count
            })
          })
          const globalBar = Object.entries(globalMaterials)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
          const globalTotal = globalBar.reduce((s, m) => s + m.count, 0)

          return (
            <div className="kpi-section">
              <div className="kpi-section-header">
                <div>
                  <span className="kpi-section-kicker">Patrones</span>
                  <h2 className="kpi-section-title">Materiales Más Utilizados</h2>
                  <p className="kpi-section-subtitle">Ranking global de materiales y preferencia por cliente.</p>
                </div>
                <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                  <label>
                    <span>Buscar</span>
                    <input type="text" placeholder="Nombre del cliente..." value={materialSearch} onChange={e => { setMaterialSearch(e.target.value); setMaterialIdx(-1); setMaterialPage(0) }} />
                  </label>
                  <label>
                    <span>Cliente</span>
                    <select value={materialIdx} onChange={e => { setMaterialIdx(+e.target.value); setMaterialPage(0) }}>
                      <option value={-1}>Todos</option>
                      {filteredMaterials.map((cl, i) => <option key={i} value={materialsByClient.indexOf(cl)}>{cl.client_name}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
                <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                  <div style={{ width: '100%', height: 260, position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={globalBar} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                          {globalBar.map((_, i) => <Cell key={i} fill={PALETTE.pie[i % PALETTE.pie.length]} />)}
                        </Pie>
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                              <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                              <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.count} usos — {globalTotal > 0 ? Math.round((d.count / globalTotal) * 100) : 0}%</p>
                            </div>
                          )
                        }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}>{globalTotal}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>usos totales</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
                    {globalBar.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: PALETTE.pie[i % PALETTE.pie.length] }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{e.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#091127' }}>{e.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Vista</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>Todos los clientes</div>
                    </div>
                    {Math.ceil(globalBar.length / MATERIAL_PAGE_SIZE) > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={() => setMaterialPage(p => Math.max(0, p - 1))} disabled={materialPage === 0} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: materialPage === 0 ? '#F8FAFC' : '#fff', color: materialPage === 0 ? '#CBD5E1' : '#475569', cursor: materialPage === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>{materialPage + 1} / {Math.ceil(globalBar.length / MATERIAL_PAGE_SIZE)}</span>
                        <button onClick={() => setMaterialPage(p => Math.min(Math.ceil(globalBar.length / MATERIAL_PAGE_SIZE) - 1, p + 1))} disabled={materialPage >= Math.ceil(globalBar.length / MATERIAL_PAGE_SIZE) - 1} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: materialPage >= Math.ceil(globalBar.length / MATERIAL_PAGE_SIZE) - 1 ? '#F8FAFC' : '#fff', color: materialPage >= Math.ceil(globalBar.length / MATERIAL_PAGE_SIZE) - 1 ? '#CBD5E1' : '#475569', cursor: materialPage >= Math.ceil(globalBar.length / MATERIAL_PAGE_SIZE) - 1 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {globalBar.slice(materialPage * MATERIAL_PAGE_SIZE, (materialPage + 1) * MATERIAL_PAGE_SIZE).map((m, i) => {
                      const pct = globalTotal > 0 ? Math.round((m.count / globalTotal) * 100) : 0
                      const rank = materialPage * MATERIAL_PAGE_SIZE + i + 1
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', width: 20, textAlign: 'center', flexShrink: 0 }}>{rank}</div>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: PALETTE.pie[(rank - 1) % PALETTE.pie.length], flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{m.name}</div>
                            <div style={{ marginTop: 4, height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: PALETTE.pie[(rank - 1) % PALETTE.pie.length], borderRadius: 2 }} />
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#091127' }}>{m.count}</div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8' }}>{pct}%</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        }

        const selectedClient = materialsByClient[materialIdx] || materialsByClient[0]
        const clientMaterials = selectedClient.materials || []
        const clientTotal = clientMaterials.reduce((s, m) => s + m.count, 0)

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Patrones</span>
                <h2 className="kpi-section-title">Materiales Más Utilizados</h2>
                <p className="kpi-section-subtitle">Materiales preferidos por cliente seleccionado.</p>
              </div>
              <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                <label>
                  <span>Buscar</span>
                    <input type="text" placeholder="Nombre del cliente..." value={materialSearch} onChange={e => { setMaterialSearch(e.target.value); setMaterialIdx(-1); setMaterialPage(0) }} />
                </label>
                <label>
                  <span>Cliente</span>
                  <select value={materialIdx} onChange={e => { setMaterialIdx(+e.target.value); setMaterialPage(0) }}>
                    <option value={-1}>Todos</option>
                    {filteredMaterials.map((cl, i) => <option key={i} value={materialsByClient.indexOf(cl)}>{cl.client_name}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={clientMaterials} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                        {clientMaterials.map((_, i) => <Cell key={i} fill={PALETTE.pie[i % PALETTE.pie.length]} />)}
                      </Pie>
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.count} usos — {clientTotal > 0 ? Math.round((d.count / clientTotal) * 100) : 0}%</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}>{clientTotal}</div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>usos</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
                  {clientMaterials.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: PALETTE.pie[i % PALETTE.pie.length] }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{e.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#091127' }}>{e.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Cliente</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>{selectedClient.client_name}</div>
                  </div>
                  {Math.ceil(clientMaterials.length / MATERIAL_PAGE_SIZE) > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => setMaterialPage(p => Math.max(0, p - 1))} disabled={materialPage === 0} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: materialPage === 0 ? '#F8FAFC' : '#fff', color: materialPage === 0 ? '#CBD5E1' : '#475569', cursor: materialPage === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>{materialPage + 1} / {Math.ceil(clientMaterials.length / MATERIAL_PAGE_SIZE)}</span>
                      <button onClick={() => setMaterialPage(p => Math.min(Math.ceil(clientMaterials.length / MATERIAL_PAGE_SIZE) - 1, p + 1))} disabled={materialPage >= Math.ceil(clientMaterials.length / MATERIAL_PAGE_SIZE) - 1} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0', background: materialPage >= Math.ceil(clientMaterials.length / MATERIAL_PAGE_SIZE) - 1 ? '#F8FAFC' : '#fff', color: materialPage >= Math.ceil(clientMaterials.length / MATERIAL_PAGE_SIZE) - 1 ? '#CBD5E1' : '#475569', cursor: materialPage >= Math.ceil(clientMaterials.length / MATERIAL_PAGE_SIZE) - 1 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {clientMaterials.slice(materialPage * MATERIAL_PAGE_SIZE, (materialPage + 1) * MATERIAL_PAGE_SIZE).map((m, i) => {
                    const pct = clientTotal > 0 ? Math.round((m.count / clientTotal) * 100) : 0
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                        <div style={{ width: 4, background: PALETTE.pie[i % PALETTE.pie.length], flexShrink: 0 }} />
                        <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#091127', color: '#fff', alignSelf: 'flex-start' }}>{m.name}</span>
                            <span style={{ fontSize: 24, fontWeight: 800, color: '#091127', lineHeight: 1, marginTop: 4 }}>{m.count}</span>
                          </div>
                          <span style={{ fontSize: 20, fontWeight: 800, color: PALETTE.pie[i % PALETTE.pie.length] }}>{pct}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 4, padding: '10px 14px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>Total de usos</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#091127' }}>{clientTotal}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {materialSummary.length > 0 && (() => {
        const filteredMatList = materialSummary.filter(m => m.name?.toLowerCase().includes(materialAnalysisSearch.toLowerCase()))
        const isAllMat = selectedMaterialAnalysis === -1
        let matData, matName
        if (isAllMat) {
          const allClients = {}
          materialSummary.forEach(m => {
            m.top_clients.forEach(c => {
              allClients[c.client_name] = (allClients[c.client_name] || 0) + c.count
            })
          })
          const topClientsAll = Object.entries(allClients).map(([name, count]) => ({ client_name: name, count })).sort((a, b) => b.count - a.count).slice(0, 8)
          const matPie = materialSummary.slice(0, 10).map((m, i) => ({ name: m.name, value: m.total_orders, color: PALETTE.pie[i % PALETTE.pie.length] }))
          const totalAll = materialSummary.reduce((s, m) => s + m.total_orders, 0)
          matData = { name: 'Todos los materiales', total_orders: totalAll, top_clients: topClientsAll, pie: matPie, trend: [] }
          matName = 'Todos los materiales'
        } else {
          const sel = materialSummary[selectedMaterialAnalysis] || materialSummary[0]
          matData = sel
          matName = sel.name
        }

        return (
          <div className="kpi-section">
            <div className="kpi-section-header">
              <div>
                <span className="kpi-section-kicker">Materiales</span>
                <h2 className="kpi-section-title">Análisis de Material</h2>
                <p className="kpi-section-subtitle">Uso, tendencia y clientes principales por material.</p>
              </div>
              <div className="kpi-filter-row" style={{ flex: '0 0 auto' }}>
                <label>
                  <span>Buscar</span>
                  <input type="text" placeholder="Nombre del material..." value={materialAnalysisSearch} onChange={e => { setMaterialAnalysisSearch(e.target.value); setSelectedMaterialAnalysis(-1) }} />
                </label>
                <label>
                  <span>Material</span>
                  <select value={selectedMaterialAnalysis} onChange={e => setSelectedMaterialAnalysis(+e.target.value)}>
                    <option value={-1}>Todos</option>
                    {filteredMatList.map((m, i) => <option key={i} value={materialSummary.indexOf(m)}>{m.name}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div style={{ width: '100%', height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={isAllMat ? matData.pie : [{ name: matData.name, value: matData.total_orders, color: PALETTE.cyan }, { name: 'Otros', value: Math.max(0, materialSummary.reduce((s, m) => s + m.total_orders, 0) - matData.total_orders), color: '#E2E8F0' }]} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={100} paddingAngle={4} stroke="none">
                        {(isAllMat ? matData.pie : [{ name: matData.name, value: matData.total_orders, color: PALETTE.cyan }, { name: 'Otros', value: Math.max(0, materialSummary.reduce((s, m) => s + m.total_orders, 0) - matData.total_orders), color: '#E2E8F0' }]).map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.1)', fontSize: 13 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: '#091127' }}>{d.name}</p>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>{d.value} órdenes</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: '#091127', lineHeight: 1 }}>{matData.total_orders}</div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>órdenes</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
                  {(isAllMat ? matData.pie.slice(0, 6) : [{ name: matData.name, color: PALETTE.cyan }, { name: 'Otros', color: '#E2E8F0' }]).map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: e.color }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>{e.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="kpi-card" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', maxHeight: 420 }}>
                <div style={{ paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Ranking</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#091127' }}>Clientes que más usan{!isAllMat ? ` ${matName}` : ''}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {matData.top_clients?.map((c, i) => {
                    const maxCount = matData.top_clients[0]?.count || 1
                    const pct = Math.round((c.count / maxCount) * 100)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', width: 20, textAlign: 'center', flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#091127' }}>{c.client_name}</div>
                          <div style={{ marginTop: 4, height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: PALETTE.pie[i % PALETTE.pie.length], borderRadius: 2 }} />
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#091127', flexShrink: 0 }}>{c.count}</div>
                      </div>
                    )
                  })}
                  {(!matData.top_clients || matData.top_clients.length === 0) && (
                    <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8', fontSize: 13 }}>Sin datos de clientes</div>
                  )}
                </div>
              </div>
            </div>

            {!isAllMat && matData.monthly_trend?.length > 0 && (
              <div className="kpi-card" style={{ padding: 24, marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>Tendencia de Uso Mensual</div>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={matData.monthly_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF8" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" name="Órdenes" fill={PALETTE.cyan} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
