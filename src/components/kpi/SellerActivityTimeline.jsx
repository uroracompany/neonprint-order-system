import { useState, useEffect, useCallback, useMemo } from 'react'
import { Icons } from '../../utils/icons'
import { adminApiFetch } from '../../utils/adminApi'

const EVENT_CONFIG = {
  order_created:                   { icon: Icons.Orders,     color: '#10B981', label: 'Creó la orden' },
  order_updated:                   { icon: Icons.Edit,       color: '#06B6D4', label: 'Editó la orden' },
  order_cancelled:                 { icon: Icons.X,          color: '#EF4444', label: 'Canceló la orden' },
  order_completed:                 { icon: Icons.CheckCircle, color: '#10B981', label: 'Completó la orden' },
  order_returned:                  { icon: Icons.Refresh,    color: '#F59E0B', label: 'Devolvió la orden' },
  admin_intervention:              { icon: Icons.AlertCircle, color: '#F59E0B', label: 'Intervención admin' },
  admin_edited_order:              { icon: Icons.Edit,       color: '#8B5CF6', label: 'Editó la orden' },
  credit_granted:                  { icon: Icons.Money,      color: '#F59E0B', label: 'Aprobó crédito' },
  credit_settled:                  { icon: Icons.CheckCircle, color: '#10B981', label: 'Crédito liquidado' },
  client_credit_payment_applied:   { icon: Icons.Money,      color: '#10B981', label: 'Pago registrado' },
  client_created:                  { icon: Icons.Users,      color: '#8B5CF6', label: 'Registró cliente' },
  production_file_added:           { icon: Icons.Package,    color: '#06B6D4', label: 'Agregó archivo' },
  production_file_removed:         { icon: Icons.Package,    color: '#EF4444', label: 'Quitó archivo' },
  production_file_status_changed:  { icon: Icons.Package,    color: '#F59E0B', label: 'Cambió estado de archivo' },
  default:                         { icon: Icons.Activity,   color: '#94A3B8', label: 'Acción' },
}

function getRelativeTime(dateStr) {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'Ahora mismo'
  if (diffMin < 60) return `Hace ${diffMin} min`
  if (diffHrs < 24) return `Hace ${diffHrs}h`
  if (diffDays === 1) return 'Ayer'
  if (diffDays < 7) return `Hace ${diffDays} días`
  return date.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getFullDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getEventDescription(event) {
  const config = EVENT_CONFIG[event.type] || EVENT_CONFIG.default
  const shortId = event.order_id ? `#${String(event.order_id).slice(0, 8)}` : ''

  if (event.type === 'client_created') {
    return { ...config, desc: `${config.label}: ${event.client_name}` }
  }

  if (event.type === 'order_created') {
    const parts = [`${config.label} ${shortId}`]
    if (event.order_client) parts.push(event.order_client)
    if (event.order_type) parts.push(event.order_type === 'orden 911' ? '911' : 'Normal')
    return { ...config, desc: parts.join(' · ') }
  }

  if (event.type === 'order_cancelled') {
    const reason = event.changes?.reason || event.changes?.cancellation_reason
    return { ...config, desc: `${config.label} ${shortId}${reason ? ` — ${reason}` : ''}` }
  }

  if (event.type === 'admin_intervention') {
    const action = event.changes?.action || event.changes?.kind || ''
    const actionLabels = {
      assign_seller: 'Asignó vendedor',
      route_design: 'Envió a Diseño',
      route_quote: 'Envió a Cotización',
      route_production: 'Envió a Producción',
      route_completed: 'Marcó como completada',
      mark_delivered: 'Marcó como entregada',
      return_to_design: 'Regresó a Diseño',
      return_to_quote: 'Regresó a Cotización',
      block_order: 'Bloqueó la orden',
      resume_order: 'Reactivó la orden',
      set_priority: 'Cambió prioridad',
      cancel_order: 'Canceló la orden',
      reopen_cancelled: 'Reabrió la orden',
      register_payment: 'Registró pago',
    }
    return { ...config, desc: `${actionLabels[action] || config.label} ${shortId}` }
  }

  if (event.type === 'admin_edited_order') {
    const fields = event.changes?.changed_fields
    const fieldNames = Array.isArray(fields) ? fields.join(', ') : ''
    return { ...config, desc: `${config.label} ${shortId}${fieldNames ? `: ${fieldNames}` : ''}` }
  }

  if (event.type?.startsWith('credit_') || event.type === 'client_credit_payment_applied') {
    return { ...config, desc: `${config.label} — orden ${shortId}` }
  }

  if (event.type?.startsWith('production_file_')) {
    return { ...config, desc: `${config.label} en orden ${shortId}` }
  }

  if (event.source === 'order') {
    return { ...config, desc: `${config.label} ${shortId}${event.order_client ? ` — ${event.order_client}` : ''}` }
  }

  return { ...config, desc: config.label }
}

function TimelineSkeleton() {
  return (
    <div style={{ marginTop: 16 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="kpi-seller-timeline-item" style={{ opacity: 0.4 }}>
          <div className="kpi-seller-timeline-dot" style={{ background: '#e2e8f0' }} />
          <div className="kpi-seller-timeline-line" />
          <div className="kpi-seller-timeline-content">
            <div style={{ background: '#e2e8f0', width: 70, height: 11, borderRadius: 4 }} />
            <div style={{ background: '#e2e8f0', width: `${60 + (i % 3) * 15}%`, height: 13, borderRadius: 4, marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TimelineItem({ event }) {
  const { icon: Icon, color, desc } = getEventDescription(event)

  return (
    <div className="kpi-seller-timeline-item">
      <div className="kpi-seller-timeline-dot" style={{ background: color }}>
        <Icon size={12} color="#fff" />
      </div>
      <div className="kpi-seller-timeline-line" />
      <div className="kpi-seller-timeline-content">
        <div className="kpi-seller-timeline-time" title={getFullDate(event.created_at)}>
          {getRelativeTime(event.created_at)}
        </div>
        <div className="kpi-seller-timeline-desc">{desc}</div>
      </div>
    </div>
  )
}

export default function SellerActivityTimeline({ sellerId, getDateBounds }) {
  const [events, setEvents] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const LIMIT = 10

  const availableEventTypes = useMemo(() => {
    const types = [...new Set(events.map(e => e.type))]
    return types.map(t => ({ value: t, label: (EVENT_CONFIG[t] || EVENT_CONFIG.default).label }))
  }, [events])

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      if (eventTypeFilter !== 'all' && event.type !== eventTypeFilter) return false
      if (!searchText) return true
      const term = searchText.toLowerCase()
      const { desc } = getEventDescription(event)
      return (
        desc.toLowerCase().includes(term) ||
        String(event.order_id || '').toLowerCase().includes(term) ||
        (event.order_client || '').toLowerCase().includes(term) ||
        (event.client_name || '').toLowerCase().includes(term)
      )
    })
  }, [events, searchText, eventTypeFilter])

  const fetchEvents = useCallback(async (isLoadMore = false) => {
    if (isLoadMore) setLoadingMore(true)
    else setLoading(true)

    try {
      const bounds = getDateBounds()
      const res = await adminApiFetch('/api/kpi-data', {
        action: 'seller_activity',
        seller_id: sellerId,
        ...bounds,
        offset: isLoadMore ? offset + LIMIT : 0,
        limit: LIMIT,
      })
      if (res.response.ok) {
        if (isLoadMore) {
          setEvents(prev => [...prev, ...res.result.events])
          setOffset(prev => prev + LIMIT)
        } else {
          setEvents(res.result.events)
          setTotal(res.result.total)
          setOffset(0)
        }
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [sellerId, getDateBounds, offset])

  useEffect(() => { fetchEvents() }, [sellerId, getDateBounds]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = searchText || eventTypeFilter !== 'all'

  return (
    <div className="kpi-card" style={{ padding: 24, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h3 className="kpi-card-subtitle" style={{ margin: 0 }}>Actividad Reciente</h3>
        {total > 0 && <span style={{ fontSize: 12, color: '#94A3B8' }}>{filteredEvents.length} de {total} evento{total !== 1 ? 's' : ''}</span>}
      </div>

      {total > 0 && (
        <div className="kpi-seller-timeline-filters">
          <div className="kpi-seller-timeline-search">
            <Icons.Search size={14} color="#94A3B8" />
            <input
              type="text"
              placeholder="Buscar actividad..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
            {searchText && (
              <button className="kpi-seller-timeline-clear" onClick={() => setSearchText('')} title="Limpiar búsqueda">
                <Icons.X size={12} />
              </button>
            )}
          </div>
          <select
            className="kpi-seller-timeline-select"
            value={eventTypeFilter}
            onChange={e => setEventTypeFilter(e.target.value)}
          >
            <option value="all">Todos los tipos</option>
            {availableEventTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <TimelineSkeleton />
      ) : filteredEvents.length === 0 ? (
        <div className="kpi-empty-state" style={{ padding: 30 }}>
          <div className="kpi-empty-title">
            {hasFilters ? 'Sin resultados' : 'Sin actividad reciente'}
          </div>
          <div className="kpi-empty-message">
            {hasFilters
              ? 'No se encontraron eventos que coincidan con la búsqueda.'
              : 'No hay eventos registrados para este vendedor en el período seleccionado.'}
          </div>
        </div>
      ) : (
        <div className="kpi-seller-timeline" style={{ marginTop: 16, maxHeight: 400, overflowY: 'auto' }}>
          {filteredEvents.map((event, i) => (
            <TimelineItem key={`${event.id}-${i}`} event={event} />
          ))}
        </div>
      )}

      {!loading && events.length < total && (
        <button
          className="kpi-pipeline-view-btn"
          onClick={() => fetchEvents(true)}
          disabled={loadingMore}
          style={{ width: '100%', marginTop: 16, height: 36, fontSize: 12, fontWeight: 600 }}
        >
          {loadingMore ? <div className="kpi-spinner-sm" /> : 'Cargar más actividad'}
        </button>
      )}
    </div>
  )
}
