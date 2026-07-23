import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from '../../utils/icons'
import { adminApiFetch } from '../../utils/adminApi'

const SEVERITY_META = {
  critical: { label: 'Critica', column: 'Criticas', icon: Icons.AlertCircle, tone: 'critical' },
  high: { label: 'Alta', column: 'Altas', icon: Icons.AlertCircle, tone: 'high' },
  medium: { label: 'Media', column: 'Medias', icon: Icons.Clock, tone: 'medium' },
  info: { label: 'Informativa', column: 'Informativas', icon: Icons.CheckCircle, tone: 'info' },
}

const STATUS_META = {
  nueva: { label: 'Nueva Alerta', tone: 'new', icon: Icons.Bell },
  revisada: { label: 'Revisada', tone: 'reviewed', icon: Icons.Eye },
  descartada: { label: 'Descartada', tone: 'dismissed', icon: Icons.X },
  resuelta: { label: 'Atendida', tone: 'resolved', icon: Icons.CheckCircle },
}

const MODULE_LABELS = {
  Ordenes: 'Ordenes',
  Produccion: 'Produccion',
  Entrega: 'Entrega',
  Creditos: 'Creditos',
  Clientes: 'Clientes',
  Empleados: 'Empleados',
  Materiales: 'Materiales',
  Ventas: 'Ventas',
  Calidad: 'Calidad',
  Flujo: 'Flujo',
  Responsables: 'Responsables',
  Sistema: 'Sistema',
}

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Todo' },
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: '7 dias' },
  { value: 'month', label: '30 dias' },
]

function normalizeSeverity(severity) {
  const value = String(severity || '').toLowerCase()
  if (value === 'critical') return 'critical'
  if (value === 'high') return 'high'
  if (value === 'medium' || value === 'warning') return 'medium'
  return 'info'
}

function normalizeLegacySeverity(severity) {
  const value = String(severity || '').toLowerCase()
  if (value === 'high') return 'critical'
  if (value === 'medium' || value === 'warning') return 'medium'
  return 'info'
}

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase()
  return STATUS_META[value] ? value : 'nueva'
}

function formatDateTime(value) {
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return date.toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildLocalSummary(alerts = [], generatedAt = new Date().toISOString()) {
  const active = alerts.filter(alert => !['descartada', 'resuelta'].includes(alert.status))
  const counts = active.reduce((acc, alert) => {
    acc[alert.severity] = (acc[alert.severity] || 0) + 1
    return acc
  }, {})
  const modules = Object.entries(active.reduce((acc, alert) => {
    acc[alert.category] = (acc[alert.category] || 0) + 1
    return acc
  }, {}))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return {
    health_score: Math.max(0, 100 - (counts.critical || 0) * 16 - (counts.high || 0) * 9 - (counts.medium || 0) * 4 - (counts.info || 0)),
    active_count: active.length,
    total_count: alerts.length,
    critical_count: counts.critical || 0,
    high_count: counts.high || 0,
    medium_count: counts.medium || 0,
    info_count: counts.info || 0,
    affected_modules: modules,
    root_causes: modules.slice(0, 6).map(module => ({ label: `Riesgo en ${module.name}`, count: module.count })),
    next_action: active.length > 0 ? 'Atender primero las columnas de mayor prioridad y documentar el estado.' : 'Operacion bajo control. Mantener monitoreo regular.',
    last_scan_at: generatedAt,
  }
}

function normalizeAlert(alert, index = 0, legacy = false) {
  const severity = legacy ? normalizeLegacySeverity(alert.severity) : normalizeSeverity(alert.severity)
  const category = alert.category || 'Sistema'
  return {
    alert_key: alert.alert_key || `${alert.type || 'legacy'}:${alert.entity_id || index}`,
    type: alert.type || 'legacy_alert',
    category,
    severity,
    status: normalizeStatus(alert.status),
    title: alert.title || 'Alerta operativa',
    description: alert.description || alert.message || 'Situacion detectada por el monitoreo KPI.',
    affected_area: alert.affected_area || MODULE_LABELS[category] || category,
    entity_type: alert.entity_type || 'system',
    entity_id: alert.entity_id || null,
    detected_at: alert.detected_at || alert.created_at || new Date().toISOString(),
    impact: alert.impact || 'Puede afectar la continuidad operativa si no se revisa.',
    possible_cause: alert.possible_cause || 'Regla automatica de monitoreo detecto una condicion fuera de lo esperado.',
    recommended_action: alert.recommended_action || alert.action || 'Revisar el modulo relacionado.',
    action_target: alert.action_target || { module: category.toLowerCase() },
    evidence: alert.evidence || {},
  }
}

function getInitialCenter(data) {
  if (data?.alerts_center?.alerts) return data.alerts_center
  const alerts = (data?.smart_alerts || []).map((alert, index) => normalizeAlert(alert, index, true))
  return { alerts, summary: buildLocalSummary(alerts), generated_at: new Date().toISOString() }
}

function isInsidePeriod(alert, period) {
  if (period === 'all') return true
  const detected = new Date(alert.detected_at)
  if (Number.isNaN(detected.getTime())) return true
  const now = new Date()
  const diffDays = (now - detected) / 86400000
  if (period === 'today') return diffDays <= 1
  if (period === 'week') return diffDays <= 7
  return diffDays <= 30
}

function getActionLabel(target = {}) {
  const module = String(target.module || '').toLowerCase()
  if (module === 'orders') return 'Ver ordenes'
  if (module === 'production') return 'Ver produccion'
  if (module === 'delivery') return 'Ver entrega'
  if (module === 'clients') return 'Ver clientes'
  if (module === 'users') return 'Ver empleados'
  if (module === 'materials') return 'Ver materiales'
  if (module === 'credits') return 'Ver creditos'
  return 'Abrir modulo'
}

function formatEvidenceValue(value) {
  if (value == null || value === '') return 'Sin dato'
  if (typeof value === 'boolean') return value ? 'Si' : 'No'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Sin datos'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getEvidenceEntries(evidence = {}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return []
  return Object.entries(evidence)
    .filter(([, value]) => value != null && value !== '')
    .slice(0, 6)
}

function AlertStatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.nueva
  const Icon = meta.icon
  return (
    <span className={`kpi-alert-center-status ${meta.tone}`}>
      <Icon aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function AlertRow({ alert, selected, opened, onSelect, registerButton }) {
  const meta = SEVERITY_META[alert.severity] || SEVERITY_META.info
  const Icon = meta.icon

  return (
    <button
      type="button"
      className={`kpi-alert-center-row ${meta.tone} ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(alert.alert_key)}
      aria-haspopup="dialog"
      aria-expanded={opened}
      ref={node => registerButton(alert.alert_key, node)}
    >
      <span className="kpi-alert-center-row-priority">
        <span className={`kpi-alert-center-icon ${meta.tone}`}>
          <Icon />
        </span>
        <small>{meta.label}</small>
      </span>
      <span className="kpi-alert-center-row-main">
        <span className="kpi-alert-center-module">{alert.category}</span>
        <strong>{alert.title}</strong>
        <em>{alert.description}</em>
      </span>
      <span className="kpi-alert-center-row-meta">
        <AlertStatusBadge status={alert.status} />
        <small>{formatDateTime(alert.detected_at)}</small>
      </span>
    </button>
  )
}

function AlertDetailContent({ alert, summary, showEvidence = false }) {
  const evidenceEntries = showEvidence ? getEvidenceEntries(alert.evidence) : []

  return (
    <>
      <p className="kpi-alert-center-description">{alert.description}</p>

      <dl className="kpi-alert-center-context">
        <div>
          <dt>Area</dt>
          <dd>{alert.affected_area || 'Sistema'}</dd>
        </div>
        <div>
          <dt>Detectada</dt>
          <dd>{formatDateTime(alert.detected_at)}</dd>
        </div>
        <div>
          <dt>Modulo</dt>
          <dd>{MODULE_LABELS[alert.category] || alert.category}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{alert.entity_type || alert.type || 'Incidente'}</dd>
        </div>
      </dl>

      <div className="kpi-alert-center-insight">
        <strong>Impacto</strong>
        <span>{alert.impact}</span>
      </div>

      <div className="kpi-alert-center-cause">
        <span>Causa probable</span>
        <strong>{alert.possible_cause}</strong>
      </div>

      <div className="kpi-alert-center-insight muted">
        <strong>Accion recomendada</strong>
        <span>{alert.recommended_action}</span>
      </div>

      {showEvidence && evidenceEntries.length > 0 && (
        <div className="kpi-alert-modal-evidence">
          <span className="kpi-section-kicker">Evidencia</span>
          <dl>
            {evidenceEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll('_', ' ')}</dt>
                <dd>{formatEvidenceValue(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="kpi-alert-center-detail-diagnostic">
        <span className="kpi-section-kicker">Diagnostico</span>
        <p>{summary.next_action}</p>
      </div>
    </>
  )
}

function AlertDetailPanel({ alert, updating, onChangeStatus, onNavigateTarget, summary }) {
  if (!alert) {
    return (
      <aside className="kpi-alert-center-detail-panel empty">
        <span className="kpi-alert-center-detail-icon"><Icons.CheckCircle /></span>
        <h3>Selecciona una alerta</h3>
        <p>El detalle operativo aparecera aqui con impacto, causa probable y accion recomendada.</p>
      </aside>
    )
  }

  const meta = SEVERITY_META[alert.severity] || SEVERITY_META.info
  const Icon = meta.icon

  return (
    <aside className="kpi-alert-center-detail-panel">
      <div className="kpi-alert-center-detail-head">
        <span className={`kpi-alert-center-icon ${meta.tone}`}>
          <Icon />
        </span>
        <div>
          <span className="kpi-alert-center-module">{alert.category}</span>
          <h4>{alert.title}</h4>
        </div>
        <AlertStatusBadge status={alert.status} />
      </div>

      <AlertDetailContent alert={alert} summary={summary} />

      <div className="kpi-alert-center-card-actions">
        <div className="kpi-alert-center-secondary-actions">
          {alert.status === 'nueva' && (
            <button type="button" onClick={() => onChangeStatus(alert, 'revisada')} disabled={updating}>
              Marcar revisada
            </button>
          )}
          {alert.status !== 'resuelta' && (
            <button type="button" onClick={() => onChangeStatus(alert, 'resuelta')} disabled={updating}>
              Marcar atendida
            </button>
          )}
          {alert.status !== 'descartada' && (
            <button type="button" onClick={() => onChangeStatus(alert, 'descartada')} disabled={updating}>
              Descartar
            </button>
          )}
        </div>
        <button type="button" className="primary" onClick={() => onNavigateTarget?.(alert.action_target)}>
          {getActionLabel(alert.action_target)}
          <Icons.ArrowRight />
        </button>
      </div>

    </aside>
  )
}

function IncidentDetailModal({ alert, summary, updating, onClose, onChangeStatus, onNavigateTarget }) {
  const modalRef = useRef(null)
  const closeButtonRef = useRef(null)

  useEffect(() => {
    if (!alert) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus()
    }, 0)

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = modalRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const items = Array.from(focusable || [])
      if (!items.length) return

      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [alert, onClose])

  if (!alert) return null

  const meta = SEVERITY_META[alert.severity] || SEVERITY_META.info
  const Icon = meta.icon

  return (
    <div
      className="kpi-alert-modal-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`kpi-alert-modal ${meta.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-alert-modal-title"
        aria-describedby="kpi-alert-modal-description"
        ref={modalRef}
      >
        <header className="kpi-alert-modal-header">
          <span className={`kpi-alert-center-icon ${meta.tone}`}>
            <Icon />
          </span>
          <div className="kpi-alert-modal-titleblock">
            <span className="kpi-section-kicker">Detalle de incidente</span>
            <h2 id="kpi-alert-modal-title">{alert.title}</h2>
            <p id="kpi-alert-modal-description">
              {MODULE_LABELS[alert.category] || alert.category} - {alert.affected_area || 'Sistema'}
            </p>
          </div>
          <button
            type="button"
            className="kpi-alert-modal-close"
            onClick={onClose}
            aria-label="Cerrar detalle del incidente"
            ref={closeButtonRef}
          >
            <Icons.Close />
          </button>
        </header>

        <div className="kpi-alert-modal-badges" aria-label="Estado y prioridad del incidente">
          <span className={`kpi-alert-modal-priority ${meta.tone}`}>
            <Icon aria-hidden="true" />
            {meta.label}
          </span>
          <AlertStatusBadge status={alert.status} />
          {alert.entity_id && (
            <>
              <span className="kpi-alert-modal-entity">
                <Icons.FileText aria-hidden="true" />
                ID
              </span>
              <span className="kpi-alert-modal-entity">
                <Icons.Clock aria-hidden="true" />
                {alert.entity_id}
              </span>
            </>
          )}
        </div>

        <div className="kpi-alert-modal-body">
          <AlertDetailContent alert={alert} summary={summary} showEvidence />
        </div>

        <footer className="kpi-alert-modal-footer">
          <button type="button" className="kpi-alert-modal-secondary" onClick={onClose}>
            Cerrar
          </button>
          {alert.status !== 'resuelta' && (
            <button
              type="button"
              className="kpi-alert-modal-attend"
              onClick={() => onChangeStatus?.(alert, 'resuelta')}
              disabled={updating}
            >
              <Icons.Check aria-hidden="true" />
              Marcar atendida
            </button>
          )}
          <button type="button" className="kpi-alert-modal-primary" onClick={() => onNavigateTarget?.(alert.action_target)}>
            {getActionLabel(alert.action_target)}
            <Icons.ArrowRight />
          </button>
        </footer>
      </section>
    </div>
  )
}

export default function KPIAlertsPanel({ data, onNavigateTarget }) {
  const [centerData, setCenterData] = useState(() => getInitialCenter(data))
  const [loadingCenter, setLoadingCenter] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [status, setStatus] = useState('active')
  const [period, setPeriod] = useState('all')
  const [updatingKey, setUpdatingKey] = useState('')
  const [selectedAlertKey, setSelectedAlertKey] = useState('')
  const [modalAlertKey, setModalAlertKey] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const alertButtonRefs = useRef(new Map())

  const ITEMS_PER_PAGE = 7

  useEffect(() => {
    setCenterData(getInitialCenter(data))
  }, [data])

  useEffect(() => {
    if (data?.alerts_center?.alerts) return undefined
    let active = true
    setLoadingCenter(true)
    adminApiFetch('/api/kpi-data', { action: 'smart_alerts_center' })
      .then(({ response, result }) => {
        if (!active) return
        if (!response.ok) throw new Error(result?.error || 'No se pudo cargar el centro de alertas.')
        setCenterData(result)
        setError('')
      })
      .catch(err => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoadingCenter(false)
      })
    return () => { active = false }
  }, [data?.alerts_center])

  const alerts = useMemo(() => (centerData?.alerts || []).map((alert, index) => normalizeAlert(alert, index)), [centerData])
  const summary = centerData?.summary || buildLocalSummary(alerts, centerData?.generated_at)

  const categories = useMemo(() => (
    Array.from(new Set(alerts.map(alert => alert.category).filter(Boolean))).sort()
  ), [alerts])

  const filteredAlerts = useMemo(() => {
    const text = query.trim().toLowerCase()
    return alerts.filter(alert => {
      const haystack = [
        alert.title,
        alert.description,
        alert.affected_area,
        alert.category,
        alert.impact,
        alert.recommended_action,
      ].join(' ').toLowerCase()
      if (text && !haystack.includes(text)) return false
      if (category !== 'all' && alert.category !== category) return false
      if (severity !== 'all' && alert.severity !== severity) return false
      if (status === 'active' && ['descartada', 'resuelta'].includes(alert.status)) return false
      if (status !== 'active' && status !== 'all' && alert.status !== status) return false
      if (!isInsidePeriod(alert, period)) return false
      return true
    })
  }, [alerts, category, period, query, severity, status])

  const severitySummary = useMemo(() => (
    Object.keys(SEVERITY_META).reduce((acc, key) => {
      acc[key] = filteredAlerts.filter(alert => alert.severity === key).length
      return acc
    }, {})
  ), [filteredAlerts])

  const totalPages = Math.ceil(filteredAlerts.length / ITEMS_PER_PAGE)
  const paginatedAlerts = filteredAlerts.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  )

  const selectedAlert = useMemo(() => (
    filteredAlerts.find(alert => alert.alert_key === selectedAlertKey) || filteredAlerts[0] || null
  ), [filteredAlerts, selectedAlertKey])

  const modalAlert = useMemo(() => (
    alerts.find(alert => alert.alert_key === modalAlertKey) || null
  ), [alerts, modalAlertKey])

  useEffect(() => {
    if (!filteredAlerts.length) {
      if (selectedAlertKey) setSelectedAlertKey('')
      return
    }
    if (!filteredAlerts.some(alert => alert.alert_key === selectedAlertKey)) {
      setSelectedAlertKey(filteredAlerts[0].alert_key)
    }
  }, [filteredAlerts, selectedAlertKey])

  useEffect(() => {
    setCurrentPage(1)
  }, [query, category, severity, status, period])

  const clearFilters = useCallback(() => {
    setQuery('')
    setCategory('all')
    setSeverity('all')
    setStatus('active')
    setPeriod('all')
  }, [])

  const registerAlertButton = useCallback((alertKey, node) => {
    if (node) alertButtonRefs.current.set(alertKey, node)
    else alertButtonRefs.current.delete(alertKey)
  }, [])

  const handleOpenAlertModal = useCallback(alertKey => {
    setSelectedAlertKey(alertKey)
    setModalAlertKey(alertKey)
  }, [])

  const handleCloseAlertModal = useCallback(() => {
    const alertKey = modalAlertKey
    setModalAlertKey('')
    const scheduleFocus = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0))
    scheduleFocus(() => {
      alertButtonRefs.current.get(alertKey)?.focus()
    })
  }, [modalAlertKey])

  const handleChangeStatus = useCallback(async (alert, nextStatus) => {
    const previous = centerData
    setUpdatingKey(alert.alert_key)
    setCenterData(current => {
      const nextAlerts = (current?.alerts || []).map(item => (
        item.alert_key === alert.alert_key ? { ...item, status: nextStatus } : item
      ))
      return { ...current, alerts: nextAlerts, summary: buildLocalSummary(nextAlerts, current?.generated_at) }
    })

    try {
      const { response, result } = await adminApiFetch('/api/kpi-data', {
        action: 'update_alert_state',
        alert_key: alert.alert_key,
        status: nextStatus,
      })
      if (!response.ok) throw new Error(result?.error || 'No se pudo actualizar la alerta.')
      setError('')
    } catch (err) {
      setCenterData(previous)
      setError(err.message)
    } finally {
      setUpdatingKey('')
    }
  }, [centerData])

  const hasAlerts = alerts.length > 0
  const healthScore = Math.max(0, Math.min(100, Number(summary.health_score ?? 100)))
  const dominantModule = summary.affected_modules?.[0]
  const diagnosticTitle = summary.critical_count > 0
    ? 'Operacion requiere atencion.'
    : summary.active_count > 0
      ? 'Operacion en monitoreo activo.'
      : 'Operacion bajo control.'
  const diagnosticTone = summary.critical_count > 0 ? 'critical' : summary.high_count > 0 ? 'high' : 'stable'
  const diagnosticText = summary.active_count > 0
    ? `${summary.active_count} alertas activas requieren seguimiento. ${dominantModule ? `${dominantModule.name} concentra ${dominantModule.count} senales operativas.` : 'Prioriza los incidentes de mayor severidad.'}`
    : 'No se detectaron riesgos activos en el ultimo escaneo del sistema.'

  if (!data) return null

  return (
    <div className="kpi-alert-center">
      <section className="kpi-alert-center-hero">
        <div className="kpi-alert-center-titleblock">
          <span className="kpi-alert-center-title-icon"><Icons.AlertCircle /></span>
          <div>
            <span className="kpi-section-kicker">Panel de Alertas</span>
            <h2>Centro de Alertas Inteligentes</h2>
            <p>Monitoreo operativo de riesgos, prioridades y acciones recomendadas.</p>
          </div>
        </div>
        <div className="kpi-alert-center-health">
          <div className="kpi-alert-center-health-ring" style={{ '--score': `${healthScore * 3.6}deg` }}>
            <strong>{healthScore}%</strong>
          </div>
          <div>
            <span>Salud operativa</span>
            <small>Ultimo escaneo: {formatDateTime(summary.last_scan_at || centerData?.generated_at)}</small>
          </div>
        </div>
      </section>

      <section className="kpi-alert-executive-grid" aria-label="Resumen ejecutivo de alertas">
        <article className={`kpi-alert-executive-card ${diagnosticTone}`}>
          <span className="kpi-alert-executive-icon"><Icons.Dashboard /></span>
          <div className="kpi-alert-executive-copy">
            <span className="kpi-section-kicker">Diagnostico ejecutivo</span>
            <h3>{diagnosticTitle}</h3>
            <p>{diagnosticText}</p>
          </div>
        </article>

        <section className="kpi-alert-center-metrics" aria-label="Resumen de alertas">
          <div className="active"><span><Icons.Bell /> Activas</span><strong>{summary.active_count || 0}</strong><small>Requieren seguimiento</small></div>
          <div className="critical"><span><Icons.AlertCircle /> Criticas</span><strong>{summary.critical_count || 0}</strong><small>Atencion inmediata</small></div>
          <div className="high"><span><Icons.Clock /> Altas</span><strong>{summary.high_count || 0}</strong><small>Prioridad operativa</small></div>
          <div className="modules"><span><Icons.Dashboard /> Modulos</span><strong>{summary.affected_modules?.length || 0}</strong><small>Afectados</small></div>
        </section>
      </section>

      <section className="kpi-alert-center-toolbar">
        <label className="kpi-alert-center-search">
          <Icons.Search />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar alerta, area o impacto..."
          />
          {query && (
            <button type="button" className="kpi-alert-center-search-clear" onClick={() => setQuery('')} aria-label="Limpiar busqueda">
              <Icons.X />
            </button>
          )}
        </label>
        <div className="kpi-alert-center-filter-grid">
          <label>
            <span>Modulo</span>
            <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filtrar por modulo">
              <option value="all">Todos</option>
              {categories.map(item => <option key={item} value={item}>{MODULE_LABELS[item] || item}</option>)}
            </select>
          </label>
          <label>
            <span>Prioridad</span>
            <select value={severity} onChange={event => setSeverity(event.target.value)} aria-label="Filtrar por prioridad">
              <option value="all">Todas</option>
              {Object.entries(SEVERITY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
            </select>
          </label>
          <label>
            <span>Estado</span>
            <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filtrar por estado">
              <option value="active">Solo activas</option>
              <option value="all">Todos</option>
              {Object.entries(STATUS_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
            </select>
          </label>
          <label>
            <span>Periodo</span>
            <select value={period} onChange={event => setPeriod(event.target.value)} aria-label="Filtrar por periodo">
              {PERIOD_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" className="kpi-alert-center-clear" onClick={clearFilters}>
            Limpiar filtros
          </button>
          <span className="kpi-alert-center-filter-count">
            {filteredAlerts.length} de {alerts.length}
          </span>
        </div>
      </section>

      {(error || loadingCenter) && (
        <div className={`kpi-alert-center-feedback ${error ? 'error' : ''}`}>
          {error || 'Actualizando monitoreo inteligente...'}
        </div>
      )}

      {!hasAlerts ? (
        <section className="kpi-alert-center-empty">
          <span><Icons.CheckCircle /></span>
          <h3>Operacion bajo control</h3>
          <p>No se detectaron riesgos activos en el ultimo escaneo. El sistema seguira monitoreando produccion, entregas, clientes, pagos, empleados y materiales.</p>
        </section>
      ) : (
        <section className="kpi-alert-center-inbox">
          <div className="kpi-alert-center-inbox-main">
            <div className="kpi-alert-center-priority-strip" aria-label="Filtro de prioridad">
              <button type="button" className={severity === 'all' ? 'active' : ''} onClick={() => setSeverity('all')}>
                <Icons.Bell /> Todas <strong>{filteredAlerts.length}</strong>
              </button>
              {Object.entries(SEVERITY_META).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  className={`${severity === key ? 'active' : ''} ${meta.tone}`}
                  onClick={() => setSeverity(key)}
                >
                  <meta.icon /> {meta.column} <strong>{severitySummary[key] || 0}</strong>
                </button>
              ))}
            </div>

            <div className="kpi-alert-center-feed">
              <div className="kpi-alert-center-feed-head">
                <div>
                  <span className="kpi-section-kicker">Cola priorizada</span>
                  <h3>Bandeja de incidentes</h3>
                  <p>Selecciona una alerta para ver impacto, causa y accion.</p>
                </div>
                <strong>{filteredAlerts.length}</strong>
              </div>
              <div className="kpi-alert-center-feed-list">
                {paginatedAlerts.map(alert => (
                  <AlertRow
                    key={alert.alert_key}
                    alert={alert}
                    selected={selectedAlert?.alert_key === alert.alert_key}
                    opened={modalAlertKey === alert.alert_key}
                    onSelect={handleOpenAlertModal}
                    registerButton={registerAlertButton}
                  />
                ))}
                {filteredAlerts.length === 0 && (
                  <div className="kpi-alert-center-column-empty">
                    No hay alertas con los filtros actuales.
                  </div>
                )}
              </div>
              {totalPages > 1 && (
                <div className="kpi-alert-center-pagination">
                  <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                    ← Anterior
                  </button>
                  <span>{currentPage} / {totalPages}</span>
                  <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                    Siguiente →
                  </button>
                </div>
              )}
            </div>
          </div>

          <AlertDetailPanel
            alert={selectedAlert}
            updating={selectedAlert ? updatingKey === selectedAlert.alert_key : false}
            onChangeStatus={handleChangeStatus}
            onNavigateTarget={onNavigateTarget}
            summary={summary}
          />
        </section>
      )}
      <IncidentDetailModal
        alert={modalAlert}
        summary={summary}
        updating={modalAlert ? updatingKey === modalAlert.alert_key : false}
        onClose={handleCloseAlertModal}
        onChangeStatus={handleChangeStatus}
        onNavigateTarget={onNavigateTarget}
      />
    </div>
  )
}
