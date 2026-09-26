export default function KPITooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
      padding: '10px 14px', boxShadow: '0 4px 16px rgba(15,30,64,0.10)', fontSize: 13,
    }}>
      {label && <p style={{ margin: 0, fontWeight: 600, color: '#0f1e40' }}>{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: label ? '4px 0 0' : 0, color: entry.color || '#64748b', fontWeight: 500 }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  )
}
