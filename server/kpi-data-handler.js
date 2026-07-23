import { requireAdmin } from './auth-middleware.js'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const PRODUCTION_STATUSES = ['pending', 'in_production', 'in_termination', 'completed']
const ACTIVE_PRODUCTION_STATUSES = ['pending', 'in_production', 'in_termination']
const PRODUCTION_ROLES = ['digital_producer', 'dtf_producer', 'ploteo_producer']
const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function roundMetric(value, decimals = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return +number.toFixed(decimals)
}

function safeChangePct(current, previous) {
  const curr = Number(current) || 0
  const prev = Number(previous) || 0
  if (prev === 0) return curr > 0 ? 100 : 0
  return roundMetric(((curr - prev) / prev) * 100, 1)
}

function daysBetween(start, end) {
  if (!start || !end) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  const diff = endDate - startDate
  return Number.isFinite(diff) && diff >= 0 ? diff / 86400000 : null
}

function average(values) {
  const clean = values.filter(value => Number.isFinite(value))
  if (clean.length === 0) return 0
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function createStatusCounts() {
  return {
    pending: 0,
    in_production: 0,
    in_termination: 0,
    completed: 0,
    total: 0,
  }
}

function getPriorityKey(order) {
  return order?.order_type === 'orden 911' ? 'urgent_911' : 'normal'
}

function getStageStart(file) {
  if (file.status === 'in_termination') return file.in_termination_at || file.started_at || file.created_at
  if (file.status === 'in_production') return file.started_at || file.created_at
  return file.created_at
}

function getMonthKey(dateValue) {
  if (!dateValue) return null
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function buildPriorityBreakdown(files, orderMap) {
  const breakdown = { normal: 0, urgent_911: 0, total: 0, urgent_pct: 0 }
  files.forEach(file => {
    const priority = getPriorityKey(orderMap.get(file.order_id))
    breakdown[priority] += 1
    breakdown.total += 1
  })
  breakdown.urgent_pct = breakdown.total > 0 ? roundMetric((breakdown.urgent_911 / breakdown.total) * 100, 1) : 0
  return breakdown
}

function summarizeAreas(files, areaItems, orderMap) {
  const areaMap = new Map(areaItems.map(area => [area.code, area]))
  files.forEach(file => {
    if (file.production_area_code && !areaMap.has(file.production_area_code)) {
      areaMap.set(file.production_area_code, { code: file.production_area_code, label: file.production_area_code })
    }
  })

  return Array.from(areaMap.values()).map(area => {
    const areaFiles = files.filter(file => file.production_area_code === area.code)
    const areaCompleted = areaFiles.filter(file => file.status === 'completed')
    const completedTimes = areaCompleted.map(file => daysBetween(file.started_at, file.completed_at)).filter(value => value !== null)
    const counts = createStatusCounts()
    let normal = 0
    let urgent911 = 0

    areaFiles.forEach(file => {
      if (PRODUCTION_STATUSES.includes(file.status)) counts[file.status] += 1
      counts.total += 1
      if (getPriorityKey(orderMap.get(file.order_id)) === 'urgent_911') urgent911 += 1
      else normal += 1
    })

    const areaReversions = areaFiles.filter(file => file.status === 'in_production' && file.in_termination_at).length

    return {
      code: area.code,
      label: area.label || area.code,
      total_files: areaFiles.length,
      active_files: areaFiles.filter(file => ACTIVE_PRODUCTION_STATUSES.includes(file.status)).length,
      completed: areaCompleted.length,
      pending: counts.pending,
      in_production: counts.in_production,
      in_termination: counts.in_termination,
      completion_rate: areaFiles.length > 0 ? roundMetric((areaCompleted.length / areaFiles.length) * 100, 1) : 0,
      avg_time_days: roundMetric(average(completedTimes), 1),
      reversions: areaReversions,
      reversion_rate: areaFiles.length > 0 ? roundMetric((areaReversions / areaFiles.length) * 100, 1) : 0,
      normal,
      urgent_911: urgent911,
      urgent_pct: areaFiles.length > 0 ? roundMetric((urgent911 / areaFiles.length) * 100, 1) : 0,
    }
  })
}

function buildPeriodPayload({ key, label, files, areaItems, orderMap }) {
  return {
    key,
    label,
    total_files: files.length,
    areas: summarizeAreas(files, areaItems, orderMap),
    priority_breakdown: buildPriorityBreakdown(files, orderMap),
  }
}

const ALERT_STATUS_VALUES = new Set(['nueva', 'revisada', 'descartada', 'resuelta'])
const ACTIVE_ORDER_STATUSES = new Set(['pending', 'in_design', 'in_quote', 'in_production', 'in_termination'])
const DONE_ORDER_STATUSES = new Set(['cancelled', 'in_completed', 'in_delivered'])

function normalizeOrderStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function normalizeAlertSeverity(severity) {
  const value = String(severity || '').toLowerCase()
  if (value === 'critical') return 'critical'
  if (value === 'high') return 'high'
  if (value === 'medium' || value === 'warning') return 'medium'
  return 'info'
}

function normalizeAlertStatus(status) {
  const value = String(status || '').toLowerCase()
  return ALERT_STATUS_VALUES.has(value) ? value : 'nueva'
}

function isValidAlertStatus(status) {
  return ALERT_STATUS_VALUES.has(String(status || '').trim().toLowerCase())
}

function safeDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysSince(value, now = new Date()) {
  const date = safeDate(value)
  if (!date) return 0
  return Math.max(0, (now - date) / 86400000)
}

function formatAlertDays(value) {
  const num = Number(value) || 0
  if (num < 1) return `${Math.round(num * 24)}h`
  return `${num.toFixed(1)}d`
}

function buildAlertKey(type, entityType = 'system', entityId = 'global') {
  return [type, entityType, entityId].map(part => String(part || 'global').replace(/\s+/g, '_').toLowerCase()).join(':')
}

function buildEvidenceAlertKey(type, entityType, entityId, evidence) {
  const signature = createHash('sha1')
    .update(JSON.stringify(evidence))
    .digest('hex')
    .slice(0, 10)
  return buildAlertKey(type, entityType, `${entityId}:${signature}`)
}

function normalizeAssignmentArea(value) {
  return String(value || 'sin_area').trim().toLowerCase()
}

function buildAssignmentKey(orderId, areaCode) {
  return `${orderId || 'sin_orden'}:${normalizeAssignmentArea(areaCode)}`
}

function getDeliveryDueDate(value) {
  if (!value) return null
  const raw = String(value)
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999)
  }
  return safeDate(value)
}

function getOrderResponsibleMissing(order) {
  const status = normalizeOrderStatus(order.status)
  if (status === 'pending') return !order.seller_id
  if (status === 'in_design') return !order.designer_id
  if (status === 'in_quote') return !order.quote_id
  if (status === 'in_production' || status === 'in_termination') return !order.production_id
  if (status === 'in_delivered') return !order.delivery_id
  return false
}

async function safeDataQuery(label, queryPromise, fallback = []) {
  try {
    const { data, error, count } = await queryPromise
    if (error) {
      console.error(`${label}:`, error.message)
      return Array.isArray(fallback) ? fallback : { ...fallback, count: fallback.count || 0 }
    }
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && 'count' in fallback) {
      return { data: data || [], count: count || 0 }
    }
    return data || fallback
  } catch (error) {
    console.error(`${label}:`, error.message)
    return fallback
  }
}

async function getPersistedAlertStates(supabase, alertKeys = []) {
  if (!alertKeys.length) return new Map()
  try {
    const { data, error } = await supabase
      .from('kpi_alert_states')
      .select('alert_key,status,note,reviewed_at,dismissed_at,resolved_at,updated_at')
      .in('alert_key', alertKeys)
    if (error) {
      if (!/kpi_alert_states|does not exist|schema cache/i.test(error.message || '')) {
        console.error('kpi_alert_states:', error.message)
      }
      return new Map()
    }
    return new Map((data || []).map(row => [row.alert_key, row]))
  } catch (error) {
    if (!/kpi_alert_states|does not exist|schema cache/i.test(error.message || '')) {
      console.error('kpi_alert_states:', error.message)
    }
    return new Map()
  }
}

function withAlertState(alert, stateMap) {
  const persisted = stateMap.get(alert.alert_key)
  const status = normalizeAlertStatus(persisted?.status || alert.status)
  return {
    ...alert,
    state_note: persisted?.note || '',
    reviewed_at: persisted?.reviewed_at || null,
    dismissed_at: persisted?.dismissed_at || null,
    resolved_at: persisted?.resolved_at || null,
    status,
  }
}

function summarizeAlerts(alerts, now = new Date()) {
  const activeAlerts = alerts.filter(alert => !['descartada', 'resuelta'].includes(alert.status))
  const severityCounts = { critical: 0, high: 0, medium: 0, info: 0 }
  const categoryCounts = {}
  const causeCounts = {}

  activeAlerts.forEach(alert => {
    severityCounts[alert.severity] = (severityCounts[alert.severity] || 0) + 1
    categoryCounts[alert.category] = (categoryCounts[alert.category] || 0) + 1
    const cause = alert.possible_cause || alert.title
    causeCounts[cause] = (causeCounts[cause] || 0) + 1
  })

  const healthScore = Math.max(0, Math.round(
    100
    - (severityCounts.critical || 0) * 16
    - (severityCounts.high || 0) * 9
    - (severityCounts.medium || 0) * 4
    - (severityCounts.info || 0) * 1
  ))

  const modules = Object.entries(categoryCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const rootCauses = Object.entries(causeCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  const nextAction = severityCounts.critical > 0
    ? 'Atender alertas criticas antes de continuar con el flujo operativo.'
    : severityCounts.high > 0
      ? 'Revisar alertas altas y reasignar responsables si aplica.'
      : activeAlerts.length > 0
        ? 'Monitorear alertas medias e informativas durante el dia.'
        : 'Operacion bajo control. Mantener monitoreo regular.'

  return {
    health_score: healthScore,
    active_count: activeAlerts.length,
    total_count: alerts.length,
    critical_count: severityCounts.critical || 0,
    high_count: severityCounts.high || 0,
    medium_count: severityCounts.medium || 0,
    info_count: severityCounts.info || 0,
    affected_modules: modules,
    root_causes: rootCauses,
    next_action: nextAction,
    last_scan_at: now.toISOString(),
  }
}

async function buildSmartAlertsCenter(supabase, { date_from = null, date_to = null } = {}) {
  const now = new Date()
  const alerts = []

  const [
    orders,
    productionFiles,
    assignments,
    profiles,
    events,
  ] = await Promise.all([
    safeDataQuery('alerts.orders', supabase.from('orders').select('id,client_id,client_name,status,operational_status,status_changed_at,created_at,order_type,seller_id,designer_id,quote_id,production_id,delivery_id,delivery_date,payment_status,material,return_reason,price,invoice_number')),
    safeDataQuery('alerts.production_files', supabase.from('order_production_files').select('id,order_id,production_area_code,status,assigned_to,created_at,started_at,in_termination_at,completed_at,updated_at')),
    safeDataQuery('alerts.production_assignments', supabase.from('order_production_assignments').select('order_id,production_area_code,assigned_to')),
    safeDataQuery('alerts.profiles', supabase.from('profiles').select('id,name,role,employment_status')),
    safeDataQuery('alerts.order_events', supabase.from('order_events').select('actor_id,created_at')),
  ])

  const orderMap = new Map((orders || []).map(order => [order.id, order]))
  const activeOrders = (orders || []).filter(order => {
    const status = normalizeOrderStatus(order.status)
    return !DONE_ORDER_STATUSES.has(status) && order.operational_status !== 'blocked'
  })
  const activeOrderIds = new Set(activeOrders.map(order => order.id).filter(Boolean))
  const assignmentByWork = new Map()
  ;(assignments || []).forEach(assignment => {
    if (!assignment.assigned_to) return
    const parentOrder = orderMap.get(assignment.order_id)
    if (parentOrder && (!activeOrderIds.has(parentOrder.id) || parentOrder.operational_status === 'blocked')) return
    assignmentByWork.set(buildAssignmentKey(assignment.order_id, assignment.production_area_code), assignment.assigned_to)
  })

  const isOperationalProductionFile = file => {
    if (!ACTIVE_PRODUCTION_STATUSES.includes(file.status)) return false
    const parentOrder = orderMap.get(file.order_id)
    if (!parentOrder) return true
    return activeOrderIds.has(parentOrder.id)
  }

  function addAlert(input) {
    const alert = {
      alert_key: input.alert_key || buildAlertKey(input.type, input.entity_type, input.entity_id),
      type: input.type,
      category: input.category || 'Sistema',
      severity: normalizeAlertSeverity(input.severity),
      status: normalizeAlertStatus(input.status),
      title: input.title,
      description: input.description || input.message || '',
      affected_area: input.affected_area || input.category || 'Sistema',
      entity_type: input.entity_type || 'system',
      entity_id: input.entity_id || null,
      detected_at: input.detected_at || now.toISOString(),
      impact: input.impact || 'Puede afectar la continuidad operativa.',
      possible_cause: input.possible_cause || 'Requiere revision administrativa.',
      recommended_action: input.recommended_action || input.action || 'Revisar el modulo relacionado.',
      action_target: input.action_target || { module: input.category || 'overview' },
      evidence: input.evidence || {},
    }
    alerts.push(alert)
  }

  const staleOrders = activeOrders
    .map(order => ({ order, days: daysSince(order.status_changed_at || order.created_at, now) }))
    .filter(item => item.days > 7)
  if (staleOrders.length > 0) {
    const maxDays = Math.max(...staleOrders.map(item => item.days))
    const evidence = {
      count: staleOrders.length,
      max_days: roundMetric(maxDays, 1),
      order_ids: staleOrders.map(item => item.order.id).filter(Boolean).sort(),
    }
    addAlert({
      alert_key: buildEvidenceAlertKey('stalled_orders', 'orders', 'stalled', evidence),
      type: 'stalled_orders',
      category: 'Ordenes',
      severity: staleOrders.length > 8 || maxDays > 14 ? 'critical' : 'high',
      title: 'Ordenes estancadas',
      description: `${staleOrders.length} orden${staleOrders.length === 1 ? '' : 'es'} sin movimiento por mas de 7 dias.`,
      affected_area: 'Flujo operativo',
      entity_type: 'orders',
      entity_id: 'stalled',
      impact: 'Retrasa el flujo entre departamentos y puede afectar fechas comprometidas.',
      possible_cause: 'Estados sin actualizacion o responsables sin seguimiento.',
      recommended_action: 'Revisar estados bloqueados y priorizar las ordenes mas antiguas.',
      action_target: { module: 'orders', filter: 'stalled' },
      evidence: { count: evidence.count, max_days: evidence.max_days, sample_order_ids: evidence.order_ids.slice(0, 5) },
    })
  }

  const unassignedOrders = activeOrders.filter(getOrderResponsibleMissing)
  const unassignedFiles = (productionFiles || []).filter(file => (
    isOperationalProductionFile(file)
    && !file.assigned_to
    && !assignmentByWork.has(buildAssignmentKey(file.order_id, file.production_area_code))
  ))
  if (unassignedOrders.length + unassignedFiles.length > 0) {
    const evidence = {
      unassigned_order_ids: unassignedOrders.map(order => order.id).filter(Boolean).sort(),
      unassigned_file_ids: unassignedFiles.map(file => file.id).filter(Boolean).sort(),
    }
    addAlert({
      alert_key: buildEvidenceAlertKey('unassigned_work', 'assignment', 'unassigned', evidence),
      type: 'unassigned_work',
      category: 'Responsables',
      severity: unassignedOrders.length + unassignedFiles.length > 6 ? 'high' : 'medium',
      title: 'Trabajo sin responsable asignado',
      description: `${unassignedOrders.length} ordenes y ${unassignedFiles.length} archivos de produccion no tienen responsable claro.`,
      affected_area: 'Asignacion operativa',
      entity_type: 'assignment',
      entity_id: 'unassigned',
      impact: 'El trabajo puede quedar detenido sin un dueno operativo.',
      possible_cause: 'Ordenes avanzadas sin asignacion o archivos creados sin productor.',
      recommended_action: 'Asignar responsables desde el modulo correspondiente.',
      action_target: { module: 'orders', filter: 'unassigned' },
      evidence: { unassigned_orders: evidence.unassigned_order_ids.length, unassigned_files: evidence.unassigned_file_ids.length },
    })
  }

  const allActiveProductionFiles = (productionFiles || []).filter(file => ACTIVE_PRODUCTION_STATUSES.includes(file.status))
  const activeProductionFiles = (productionFiles || []).filter(isOperationalProductionFile)
  const staleFiles = activeProductionFiles
    .map(file => ({ file, order: orderMap.get(file.order_id), days: daysSince(getStageStart(file), now) }))
    .filter(item => item.days > 3)
  if (staleFiles.length > 0) {
    const maxDays = Math.max(...staleFiles.map(item => item.days))
    const evidence = {
      count: staleFiles.length,
      max_days: roundMetric(maxDays, 1),
      file_ids: staleFiles.map(item => item.file.id).filter(Boolean).sort(),
    }
    addAlert({
      alert_key: buildEvidenceAlertKey('production_files_stalled', 'production_files', 'stalled', evidence),
      type: 'production_files_stalled',
      category: 'Produccion',
      severity: staleFiles.length > 6 || maxDays > 7 ? 'critical' : 'high',
      title: 'Archivos de produccion detenidos',
      description: `${staleFiles.length} archivo${staleFiles.length === 1 ? '' : 's'} llevan mas de 3 dias sin avanzar.`,
      affected_area: 'Produccion',
      entity_type: 'production_files',
      entity_id: 'stalled',
      impact: 'Puede generar cuellos de botella y retrasos en cascada.',
      possible_cause: 'Carga detenida en una etapa o falta de reasignacion.',
      recommended_action: 'Abrir produccion y priorizar los archivos con mayor antiguedad.',
      action_target: { module: 'production', filter: 'bottlenecks' },
      evidence: { count: evidence.count, max_days: evidence.max_days, sample_file_ids: evidence.file_ids.slice(0, 5) },
    })
  }

  const productionGroups = {}
  activeProductionFiles.forEach(file => {
    const key = `${file.production_area_code || 'sin_area'}:${file.status || 'sin_estado'}`
    if (!productionGroups[key]) productionGroups[key] = { area: file.production_area_code || 'Sin area', status: file.status || 'sin_estado', count: 0 }
    productionGroups[key].count += 1
  })
  Object.values(productionGroups)
    .filter(group => group.count > 5)
    .forEach(group => addAlert({
      alert_key: buildEvidenceAlertKey('production_bottleneck', 'production_area', group.area, group),
      type: 'production_bottleneck',
      category: 'Produccion',
      severity: group.count > 10 ? 'critical' : 'high',
      title: `Cuello de botella en ${group.area}`,
      description: `${group.count} archivos acumulados en la etapa ${group.status}.`,
      affected_area: group.area,
      entity_type: 'production_area',
      entity_id: group.area,
      impact: 'La capacidad del area puede estar superada.',
      possible_cause: 'Demanda acumulada en una misma etapa.',
      recommended_action: 'Reasignar capacidad o priorizar ordenes urgentes.',
      action_target: { module: 'production', area_code: group.area },
      evidence: group,
    }))

  const activeByArea = {}
  activeProductionFiles.forEach(file => {
    const area = file.production_area_code || 'Sin area'
    activeByArea[area] = (activeByArea[area] || 0) + 1
  })
  const areaCounts = Object.entries(activeByArea)
  const avgAreaLoad = areaCounts.length > 0 ? areaCounts.reduce((sum, [, count]) => sum + count, 0) / areaCounts.length : 0
  areaCounts
    .filter(([, count]) => count >= 4 && avgAreaLoad > 0 && count >= avgAreaLoad * 1.8)
    .forEach(([area, count]) => addAlert({
      alert_key: buildEvidenceAlertKey('production_area_overload', 'production_area', area, { active_files: count, avg_area_load: roundMetric(avgAreaLoad, 1) }),
      type: 'production_area_overload',
      category: 'Produccion',
      severity: count >= avgAreaLoad * 2.5 ? 'high' : 'medium',
      title: `Sobrecarga en ${area}`,
      description: `${area} tiene ${count} archivos activos, por encima del promedio del departamento.`,
      affected_area: area,
      entity_type: 'production_area',
      entity_id: area,
      impact: 'Puede deteriorar tiempos de ciclo y cumplimiento.',
      possible_cause: 'Distribucion desigual de carga entre areas.',
      recommended_action: 'Balancear asignaciones o reprogramar prioridades.',
      action_target: { module: 'production', area_code: area },
      evidence: { active_files: count, avg_area_load: roundMetric(avgAreaLoad, 1) },
    }))

  const activeUrgent = activeOrders.filter(order => order.order_type === 'orden 911')
  const urgentPct = activeOrders.length > 0 ? (activeUrgent.length / activeOrders.length) * 100 : 0
  if (activeUrgent.length >= 3 || urgentPct > 25) {
    const evidence = {
      urgent_order_ids: activeUrgent.map(order => order.id).filter(Boolean).sort(),
      active_count: activeOrders.length,
      urgent_pct: roundMetric(urgentPct, 1),
    }
    addAlert({
      alert_key: buildEvidenceAlertKey('urgent_911_pressure', 'orders', 'urgent_911', evidence),
      type: 'urgent_911_pressure',
      category: 'Ordenes',
      severity: urgentPct > 35 ? 'critical' : 'high',
      title: 'Presion por ordenes 911',
      description: `${activeUrgent.length} ordenes urgentes representan ${roundMetric(urgentPct, 1)}% del flujo activo.`,
      affected_area: 'Operacion general',
      entity_type: 'orders',
      entity_id: 'urgent_911',
      impact: 'Puede desplazar ordenes normales y tensionar produccion/entrega.',
      possible_cause: 'Incremento inusual de prioridad urgente.',
      recommended_action: 'Revisar capacidad y confirmar compromisos de entrega.',
      action_target: { module: 'orders', filter: '911' },
      evidence: { urgent_count: evidence.urgent_order_ids.length, urgent_pct: evidence.urgent_pct },
    })
  }

  const deliveryOrders = activeOrders.filter(order => order.delivery_date)
  const overdueDeliveries = deliveryOrders.filter(order => {
    const dueDate = getDeliveryDueDate(order.delivery_date)
    return dueDate && dueDate < now
  })
  const upcomingDeliveries = deliveryOrders.filter(order => {
    const date = getDeliveryDueDate(order.delivery_date)
    if (!date) return false
    const diffDays = (date - now) / 86400000
    return diffDays >= 0 && diffDays <= 2
  })
  if (overdueDeliveries.length > 0) {
    const evidence = { order_ids: overdueDeliveries.map(order => order.id).filter(Boolean).sort() }
    addAlert({
      alert_key: buildEvidenceAlertKey('delivery_overdue', 'delivery', 'overdue', evidence),
      type: 'delivery_overdue',
      category: 'Entrega',
      severity: overdueDeliveries.length > 3 ? 'critical' : 'high',
      title: 'Entregas vencidas',
      description: `${overdueDeliveries.length} entrega${overdueDeliveries.length === 1 ? '' : 's'} ya superaron la fecha comprometida.`,
      affected_area: 'Entrega',
      entity_type: 'delivery',
      entity_id: 'overdue',
      impact: 'Riesgo directo de incumplimiento con clientes.',
      possible_cause: 'Ordenes activas con fecha de entrega vencida.',
      recommended_action: 'Contactar responsables y actualizar promesas al cliente.',
      action_target: { module: 'delivery', filter: 'overdue' },
      evidence: { count: evidence.order_ids.length, sample_order_ids: evidence.order_ids.slice(0, 5) },
    })
  } else if (upcomingDeliveries.length > 0) {
    const evidence = { order_ids: upcomingDeliveries.map(order => order.id).filter(Boolean).sort() }
    addAlert({
      alert_key: buildEvidenceAlertKey('delivery_due_soon', 'delivery', 'due_soon', evidence),
      type: 'delivery_due_soon',
      category: 'Entrega',
      severity: upcomingDeliveries.length > 5 ? 'medium' : 'info',
      title: 'Entregas proximas a vencer',
      description: `${upcomingDeliveries.length} entrega${upcomingDeliveries.length === 1 ? '' : 's'} vencen en las proximas 48 horas.`,
      affected_area: 'Entrega',
      entity_type: 'delivery',
      entity_id: 'due_soon',
      impact: 'Requiere seguimiento para evitar retrasos.',
      possible_cause: 'Carga proxima al compromiso de entrega.',
      recommended_action: 'Confirmar avance y ruta de entrega.',
      action_target: { module: 'delivery', filter: 'due_soon' },
      evidence: { count: evidence.order_ids.length },
    })
  }

  const creditRiskOrders = activeOrders
    .filter(order => ['credito', 'parcial', 'pending_payment'].includes(String(order.payment_status || '').toLowerCase()))
    .map(order => ({ order, days: daysSince(order.created_at, now), amount: Number(order.price) || 0 }))
    .filter(item => item.days > 7)
  if (creditRiskOrders.length > 0) {
    const totalAmount = creditRiskOrders.reduce((sum, item) => sum + item.amount, 0)
    const evidence = {
      order_ids: creditRiskOrders.map(item => item.order.id).filter(Boolean).sort(),
      amount: roundMetric(totalAmount, 2),
    }
    addAlert({
      alert_key: buildEvidenceAlertKey('aged_payment_risk', 'payment', 'aged', evidence),
      type: 'aged_payment_risk',
      category: 'Creditos',
      severity: creditRiskOrders.length > 8 || totalAmount > 50000 ? 'high' : 'medium',
      title: 'Pagos pendientes antiguos',
      description: `${creditRiskOrders.length} ordenes con credito/pago pendiente superan 7 dias.`,
      affected_area: 'Caja / Creditos',
      entity_type: 'payment',
      entity_id: 'aged',
      impact: 'Puede afectar flujo de efectivo y seguimiento administrativo.',
      possible_cause: 'Facturas sin liquidar o pagos parciales sin cierre.',
      recommended_action: 'Abrir gestion de creditos y contactar clientes.',
      action_target: { module: 'credits', filter: 'open' },
      evidence: { count: evidence.order_ids.length, amount: evidence.amount },
    })
  }

  const delayedByClient = {}
  staleOrders.forEach(({ order }) => {
    const key = order.client_id || order.client_name || 'sin_cliente'
    if (!delayedByClient[key]) delayedByClient[key] = { client_id: order.client_id, client_name: order.client_name || 'Sin cliente', count: 0 }
    delayedByClient[key].count += 1
  })
  Object.values(delayedByClient)
    .filter(client => client.count >= 2)
    .slice(0, 5)
    .forEach(client => addAlert({
      alert_key: buildEvidenceAlertKey('client_delayed_orders', 'client', client.client_id || client.client_name, client),
      type: 'client_delayed_orders',
      category: 'Clientes',
      severity: client.count >= 4 ? 'high' : 'medium',
      title: 'Cliente con ordenes retrasadas',
      description: `${client.client_name} tiene ${client.count} ordenes estancadas.`,
      affected_area: 'Clientes',
      entity_type: 'client',
      entity_id: client.client_id || client.client_name,
      impact: 'Riesgo de insatisfaccion o perdida de cliente.',
      possible_cause: 'Varias ordenes del mismo cliente acumuladas en flujo.',
      recommended_action: 'Revisar cuenta del cliente y coordinar seguimiento.',
      action_target: { module: 'clients', client_id: client.client_id },
      evidence: client,
    }))

  const byClientOrders = {}
  ;(orders || []).forEach(order => {
    if (!order.client_id && !order.client_name) return
    const key = order.client_id || order.client_name
    if (!byClientOrders[key]) byClientOrders[key] = { client_id: order.client_id, client_name: order.client_name || 'Sin cliente', count: 0, latest: null }
    byClientOrders[key].count += 1
    const created = safeDate(order.created_at)
    if (created && (!byClientOrders[key].latest || created > byClientOrders[key].latest)) byClientOrders[key].latest = created
  })
  Object.values(byClientOrders)
    .filter(client => client.count >= 5 && client.latest && daysSince(client.latest, now) > 60)
    .slice(0, 5)
    .forEach(client => addAlert({
      alert_key: buildEvidenceAlertKey('vip_client_inactive', 'client', client.client_id || client.client_name, { total_orders: client.count, latest: client.latest?.toISOString?.() || client.latest }),
      type: 'vip_client_inactive',
      category: 'Clientes',
      severity: 'high',
      title: 'Cliente importante inactivo',
      description: `${client.client_name} no registra ordenes recientes hace ${formatAlertDays(daysSince(client.latest, now))}.`,
      affected_area: 'Clientes',
      entity_type: 'client',
      entity_id: client.client_id || client.client_name,
      impact: 'Riesgo comercial por perdida de recurrencia.',
      possible_cause: 'Cliente historico sin recompra reciente.',
      recommended_action: 'Contactar y revisar oportunidades de reactivacion.',
      action_target: { module: 'clients', client_id: client.client_id },
      evidence: { total_orders: client.count, days_inactive: roundMetric(daysSince(client.latest, now), 1) },
    }))

  const lastActivityByUser = new Map()
  ;(events || []).forEach(event => {
    if (!event.actor_id) return
    const created = safeDate(event.created_at)
    if (created && (!lastActivityByUser.has(event.actor_id) || created > lastActivityByUser.get(event.actor_id))) {
      lastActivityByUser.set(event.actor_id, created)
    }
  })
  const inactiveUsers = (profiles || [])
    .filter(profile => profile.role !== 'admin' && profile.employment_status === true)
    .filter(profile => {
      const last = lastActivityByUser.get(profile.id)
      return !last || daysSince(last, now) > 7
    })
  if (inactiveUsers.length > 0) {
    const evidence = { user_ids: inactiveUsers.map(profile => profile.id).filter(Boolean).sort() }
    addAlert({
      alert_key: buildEvidenceAlertKey('inactive_employees', 'employees', 'inactive', evidence),
      type: 'inactive_employees',
      category: 'Empleados',
      severity: inactiveUsers.length > 4 ? 'medium' : 'info',
      title: 'Empleados sin actividad reciente',
      description: `${inactiveUsers.length} empleado${inactiveUsers.length === 1 ? '' : 's'} activo${inactiveUsers.length === 1 ? '' : 's'} no registra${inactiveUsers.length === 1 ? '' : 'n'} actividad en 7 dias.`,
      affected_area: 'Equipo',
      entity_type: 'employees',
      entity_id: 'inactive',
      impact: 'Puede indicar ausencia, baja adopcion o asignaciones sin seguimiento.',
      possible_cause: 'Usuarios activos sin eventos operativos recientes.',
      recommended_action: 'Verificar disponibilidad y carga asignada.',
      action_target: { module: 'users', filter: 'inactive' },
      evidence: { count: evidence.user_ids.length, sample_user_ids: evidence.user_ids.slice(0, 5) },
    })
  }

  const workloadKeysByUser = new Map()
  const addWorkload = (userId, orderId, areaCode) => {
    if (!userId) return
    if (!workloadKeysByUser.has(userId)) workloadKeysByUser.set(userId, new Set())
    workloadKeysByUser.get(userId).add(buildAssignmentKey(orderId, areaCode))
  }
  ;(activeProductionFiles || []).forEach(file => addWorkload(file.assigned_to, file.order_id, file.production_area_code))
  ;(assignments || []).forEach(assignment => {
    const parentOrder = orderMap.get(assignment.order_id)
    if (parentOrder && (!activeOrderIds.has(parentOrder.id) || parentOrder.operational_status === 'blocked')) return
    addWorkload(assignment.assigned_to, assignment.order_id, assignment.production_area_code)
  })
  const userLoads = Array.from(workloadKeysByUser.entries()).map(([userId, keys]) => [userId, keys.size])
  const avgUserLoad = userLoads.length > 0 ? userLoads.reduce((sum, [, count]) => sum + count, 0) / userLoads.length : 0
  const overloadedUsers = userLoads.filter(([, count]) => count >= 6 && avgUserLoad > 0 && count >= avgUserLoad * 2)
  if (overloadedUsers.length > 0) {
    const evidence = { user_ids: overloadedUsers.map(([userId]) => userId).sort(), avg_load: roundMetric(avgUserLoad, 1) }
    addAlert({
      alert_key: buildEvidenceAlertKey('employee_overload', 'employees', 'overload', evidence),
      type: 'employee_overload',
      category: 'Empleados',
      severity: overloadedUsers.length > 2 ? 'high' : 'medium',
      title: 'Carga excesiva por empleado',
      description: `${overloadedUsers.length} empleado${overloadedUsers.length === 1 ? '' : 's'} supera${overloadedUsers.length === 1 ? '' : 'n'} el doble de la carga promedio.`,
      affected_area: 'Equipo de produccion',
      entity_type: 'employees',
      entity_id: 'overload',
      impact: 'Riesgo de retrasos, errores o saturacion operativa.',
      possible_cause: 'Distribucion desigual de asignaciones.',
      recommended_action: 'Redistribuir carga o apoyar a los perfiles saturados.',
      action_target: { module: 'users', filter: 'overload' },
      evidence: { overloaded_count: evidence.user_ids.length, avg_load: evidence.avg_load },
    })
  }

  const materialCounts = {}
  activeOrders.forEach(order => {
    String(order.material || '').split(',').map(item => item.trim()).filter(Boolean).forEach(material => {
      if (!materialCounts[material]) materialCounts[material] = { total: 0, urgent: 0, delayed: 0 }
      materialCounts[material].total += 1
      if (order.order_type === 'orden 911') materialCounts[material].urgent += 1
      if (daysSince(order.status_changed_at || order.created_at, now) > 7) materialCounts[material].delayed += 1
    })
  })
  Object.entries(materialCounts)
    .filter(([, item]) => item.total >= 4 && (item.urgent >= 2 || item.delayed >= 2))
    .slice(0, 3)
    .forEach(([material, item]) => addAlert({
      alert_key: buildEvidenceAlertKey('material_operational_risk', 'material', material, item),
      type: 'material_operational_risk',
      category: 'Materiales',
      severity: item.delayed >= 3 ? 'high' : 'medium',
      title: 'Material con riesgo operativo',
      description: `${material} aparece en ${item.total} ordenes activas, con ${item.urgent} urgentes y ${item.delayed} retrasadas.`,
      affected_area: 'Materiales',
      entity_type: 'material',
      entity_id: material,
      impact: 'Puede indicar dependencia critica de material o riesgo de abastecimiento.',
      possible_cause: 'Alta concentracion de ordenes usando el mismo material.',
      recommended_action: 'Verificar disponibilidad y priorizar compras si aplica.',
      action_target: { module: 'materials', material },
      evidence: item,
    }))

  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const prevWeekStart = new Date(weekStart)
  prevWeekStart.setDate(weekStart.getDate() - 7)
  const prevWeekEnd = new Date(weekStart)
  const currentWeekOrders = (orders || []).filter(order => {
    const created = safeDate(order.created_at)
    return created && created >= weekStart
  }).length
  const previousWeekOrders = (orders || []).filter(order => {
    const created = safeDate(order.created_at)
    return created && created >= prevWeekStart && created < prevWeekEnd
  }).length
  if (previousWeekOrders > 0) {
    const dropPct = ((currentWeekOrders - previousWeekOrders) / previousWeekOrders) * 100
    if (dropPct < -15) {
      addAlert({
        alert_key: buildEvidenceAlertKey('orders_drop', 'sales', 'weekly_drop', { current_week: currentWeekOrders, previous_week: previousWeekOrders, week_start: weekStart.toISOString() }),
        type: 'orders_drop',
        category: 'Ventas',
        severity: dropPct < -30 ? 'high' : 'medium',
        title: 'Caida significativa de ordenes',
        description: `Las ordenes de esta semana bajaron ${Math.abs(roundMetric(dropPct, 1))}% vs la semana anterior.`,
        affected_area: 'Ventas',
        entity_type: 'sales',
        entity_id: 'weekly_drop',
        impact: 'Puede anticipar una baja de ingresos o menor demanda.',
        possible_cause: 'Menor entrada comercial respecto a la semana previa.',
        recommended_action: 'Revisar embudo de ventas y clientes recurrentes.',
        action_target: { module: 'orders', filter: 'week' },
        evidence: { current_week: currentWeekOrders, previous_week: previousWeekOrders, drop_pct: roundMetric(dropPct, 1) },
      })
    }
  }

  const periodOrders = (orders || []).filter(order => {
    const created = safeDate(order.created_at)
    if (!created) return false
    if (date_from && created < new Date(date_from)) return false
    if (date_to && created >= new Date(date_to)) return false
    return true
  })
  const cancelledCount = periodOrders.filter(order => normalizeOrderStatus(order.status) === 'cancelled').length
  if (periodOrders.length >= 10 && cancelledCount / periodOrders.length > 0.1) {
    const evidence = { period_from: date_from || null, period_to: date_to || null, cancelled: cancelledCount, total: periodOrders.length }
    addAlert({
      alert_key: buildEvidenceAlertKey('high_cancellation_rate', 'quality', 'cancellation', evidence),
      type: 'high_cancellation_rate',
      category: 'Calidad',
      severity: cancelledCount / periodOrders.length > 0.15 ? 'high' : 'medium',
      title: 'Tasa de cancelacion elevada',
      description: `${roundMetric((cancelledCount / periodOrders.length) * 100, 1)}% de las ordenes del periodo fueron canceladas.`,
      affected_area: 'Calidad operativa',
      entity_type: 'quality',
      entity_id: 'cancellation',
      impact: 'Puede indicar problemas de expectativas, precio, diseno o entrega.',
      possible_cause: 'Cancelaciones por encima del umbral normal.',
      recommended_action: 'Analizar causas de cancelacion y clientes afectados.',
      action_target: { module: 'orders', filter: 'cancelled' },
      evidence: { cancelled: evidence.cancelled, total: evidence.total },
    })
  }

  const returnedCount = periodOrders.filter(order => Boolean(order.return_reason)).length
  if (periodOrders.length >= 10 && returnedCount / periodOrders.length > 0.12) {
    const evidence = { period_from: date_from || null, period_to: date_to || null, returned: returnedCount, total: periodOrders.length }
    addAlert({
      alert_key: buildEvidenceAlertKey('high_return_rate', 'quality', 'returns', evidence),
      type: 'high_return_rate',
      category: 'Calidad',
      severity: returnedCount / periodOrders.length > 0.18 ? 'critical' : 'high',
      title: 'Devoluciones por encima de lo esperado',
      description: `${roundMetric((returnedCount / periodOrders.length) * 100, 1)}% de las ordenes del periodo tienen devolucion.`,
      affected_area: 'Calidad',
      entity_type: 'quality',
      entity_id: 'returns',
      impact: 'Afecta reputacion, costos y retrabajo.',
      possible_cause: 'Errores de diseno, produccion, calidad o expectativa del cliente.',
      recommended_action: 'Revisar ordenes devueltas y causas raiz.',
      action_target: { module: 'orders', filter: 'returned' },
      evidence: { returned: evidence.returned, total: evidence.total },
    })
  }

  const activeOrdersInProduction = activeOrders.filter(order => ['in_production', 'in_termination'].includes(normalizeOrderStatus(order.status)))
  const productionOrderIdsWithFiles = new Set((productionFiles || []).map(file => file.order_id).filter(Boolean))
  const productionWithoutFiles = activeOrdersInProduction.filter(order => !productionOrderIdsWithFiles.has(order.id))
  const completedOrdersWithActiveFiles = (orders || []).filter(order => ['in_completed', 'in_delivered'].includes(normalizeOrderStatus(order.status)))
    .filter(order => allActiveProductionFiles.some(file => file.order_id === order.id))
  if (productionWithoutFiles.length > 0 || completedOrdersWithActiveFiles.length > 0) {
    const evidence = {
      production_without_file_order_ids: productionWithoutFiles.map(order => order.id).filter(Boolean).sort(),
      completed_with_active_file_order_ids: completedOrdersWithActiveFiles.map(order => order.id).filter(Boolean).sort(),
    }
    addAlert({
      alert_key: buildEvidenceAlertKey('workflow_state_inconsistency', 'workflow', 'state_inconsistency', evidence),
      type: 'workflow_state_inconsistency',
      category: 'Flujo',
      severity: productionWithoutFiles.length + completedOrdersWithActiveFiles.length > 3 ? 'high' : 'medium',
      title: 'Inconsistencia en estados del flujo',
      description: `${productionWithoutFiles.length} ordenes en produccion sin archivos y ${completedOrdersWithActiveFiles.length} completadas con archivos activos.`,
      affected_area: 'Flujo entre departamentos',
      entity_type: 'workflow',
      entity_id: 'state_inconsistency',
      impact: 'Puede confundir responsabilidades, reportes y tiempos de ciclo.',
      possible_cause: 'Transiciones incompletas entre ordenes y archivos de produccion.',
      recommended_action: 'Auditar las ordenes afectadas y corregir estados.',
      action_target: { module: 'orders', filter: 'inconsistent' },
      evidence: { production_without_files: evidence.production_without_file_order_ids.length, completed_with_active_files: evidence.completed_with_active_file_order_ids.length },
    })
  }

  const legacyAlerts = await safeDataQuery('alerts.legacy_smart_alerts', supabase.rpc('kpi_smart_alerts'), [])
  ;(legacyAlerts || []).forEach((alert, index) => {
    const type = alert.type || `legacy_${index}`
    const key = buildAlertKey(type, 'legacy', alert.type || index)
    if (alerts.some(item => item.alert_key === key || item.type === type)) return
    addAlert({
      alert_key: key,
      type,
      category: 'Sistema',
      severity: normalizeAlertSeverity(alert.severity),
      title: alert.title || 'Alerta operativa',
      description: alert.message || '',
      affected_area: 'Sistema',
      entity_type: 'legacy',
      entity_id: alert.type || index,
      impact: 'Alerta generada por reglas KPI existentes.',
      possible_cause: alert.title || 'Regla existente de KPI.',
      recommended_action: alert.action || 'Revisar informacion relacionada.',
      action_target: { module: 'overview' },
      detected_at: alert.created_at || now.toISOString(),
    })
  })

  const uniqueAlerts = Array.from(new Map(alerts.map(alert => [alert.alert_key, alert])).values())
  const stateMap = await getPersistedAlertStates(supabase, uniqueAlerts.map(alert => alert.alert_key))
  const enrichedAlerts = uniqueAlerts
    .map(alert => withAlertState(alert, stateMap))
    .sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, info: 3 }
      return (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
        || new Date(b.detected_at) - new Date(a.detected_at)
    })

  return {
    alerts: enrichedAlerts,
    summary: summarizeAlerts(enrichedAlerts, now),
    generated_at: now.toISOString(),
  }
}

async function buildProductionDepartmentInsights(supabase, { date_from, date_to, compare_from, compare_to }) {
  const from = date_from || '1970-01-01'
  const to = date_to || new Date().toISOString()
  const now = new Date()
  const nowIso = now.toISOString()
  const calendarYearStart = new Date(now.getFullYear(), 0, 1)
  const rollingYearStart = new Date(now)
  rollingYearStart.setFullYear(rollingYearStart.getFullYear() - 1)
  const historyFrom = new Date(Math.min(calendarYearStart.getTime(), rollingYearStart.getTime())).toISOString()

  const [{ data: areas }, { data: allFiles }, { data: assignments }, { data: orders }, { data: profiles }, { data: historicalFiles }, { data: historicalOrders }] = await Promise.all([
    supabase.from('production_areas').select('code, label, producer_role').eq('is_active', true),
    supabase.from('order_production_files')
      .select('id, order_id, production_area_code, status, assigned_to, created_by, started_at, in_termination_at, completed_at, created_at')
      .gte('created_at', from).lt('created_at', to),
    supabase.from('order_production_assignments')
      .select('order_id, production_area_code, assigned_to'),
    supabase.from('orders')
      .select('*')
      .gte('created_at', from).lt('created_at', to),
    supabase.from('profiles').select('id, name, role').in('role', PRODUCTION_ROLES),
    supabase.from('order_production_files')
      .select('id, order_id, production_area_code, status, assigned_to, created_by, started_at, in_termination_at, completed_at, created_at')
      .gte('created_at', historyFrom).lt('created_at', nowIso),
    supabase.from('orders')
      .select('id, order_type, created_at')
      .gte('created_at', historyFrom).lt('created_at', nowIso),
  ])

  const areaList = areas || []
  const files = allFiles || []
  const assignList = assignments || []
  const orderList = orders || []
  const orderMap = new Map(orderList.map(order => [order.id, order]))
  const profileList = profiles || []
  const historyFiles = historicalFiles || []
  const historyOrderMap = new Map((historicalOrders || []).map(order => [order.id, order]))
  const totalFiles = files.length
  const completedFiles = files.filter(file => file.status === 'completed')
  const activeFiles = files.filter(file => ACTIVE_PRODUCTION_STATUSES.includes(file.status))
  const reversions = files.filter(file => file.status === 'in_production' && file.in_termination_at).length

  const areaMap = new Map(areaList.map(area => [area.code, area]))
  files.forEach(file => {
    if (file.production_area_code && !areaMap.has(file.production_area_code)) {
      areaMap.set(file.production_area_code, { code: file.production_area_code, label: file.production_area_code })
    }
  })

  const areaMetrics = Array.from(areaMap.values()).map(area => {
    const areaFiles = files.filter(file => file.production_area_code === area.code)
    const areaCompleted = areaFiles.filter(file => file.status === 'completed')
    const completedTimes = areaCompleted.map(file => daysBetween(file.started_at, file.completed_at)).filter(value => value !== null)
    const areaReversions = areaFiles.filter(file => file.status === 'in_production' && file.in_termination_at).length
    const normalFiles = areaFiles.filter(file => getPriorityKey(orderMap.get(file.order_id)) === 'normal').length
    const urgentFiles = areaFiles.length - normalFiles
    const assignedUsers = new Set(
      assignList
        .filter(assignment => assignment.production_area_code === area.code && assignment.assigned_to)
        .map(assignment => assignment.assigned_to)
    )

    return {
      code: area.code,
      label: area.label || area.code,
      total_files: areaFiles.length,
      active_files: areaFiles.filter(file => ACTIVE_PRODUCTION_STATUSES.includes(file.status)).length,
      completed: areaCompleted.length,
      pending: areaFiles.filter(file => file.status === 'pending').length,
      in_production: areaFiles.filter(file => file.status === 'in_production').length,
      in_termination: areaFiles.filter(file => file.status === 'in_termination').length,
      completion_rate: areaFiles.length > 0 ? roundMetric((areaCompleted.length / areaFiles.length) * 100, 1) : 0,
      avg_time_days: roundMetric(average(completedTimes), 1),
      reversions: areaReversions,
      reversion_rate: areaFiles.length > 0 ? roundMetric((areaReversions / areaFiles.length) * 100, 1) : 0,
      normal: normalFiles,
      urgent_911: urgentFiles,
      urgent_pct: areaFiles.length > 0 ? roundMetric((urgentFiles / areaFiles.length) * 100, 1) : 0,
      active_employees: assignedUsers.size,
      pct_of_total: totalFiles > 0 ? roundMetric((areaFiles.length / totalFiles) * 100, 1) : 0,
    }
  })

  const areaLoad = {}
  areaMetrics.forEach(area => {
    areaLoad[area.code] = {
      pending: area.pending,
      in_production: area.in_production,
      in_termination: area.in_termination,
      completed: area.completed,
      total: area.total_files,
      active: area.active_files,
      completion_rate: area.completion_rate,
      avg_time_days: area.avg_time_days,
      reversions: area.reversions,
      reversion_rate: area.reversion_rate,
      normal: area.normal,
      urgent_911: area.urgent_911,
      urgent_pct: area.urgent_pct,
    }
  })

  const fileStatus = createStatusCounts()
  files.forEach(file => {
    if (PRODUCTION_STATUSES.includes(file.status)) fileStatus[file.status] += 1
    fileStatus.total += 1
  })

  const orderDesignToQuote = orderList
    .filter(order => order.status === 'in_Quote')
    .map(order => daysBetween(order.created_at, order.status_changed_at))
    .filter(value => value !== null)
  const quoteToProduction = files
    .map(file => daysBetween(file.created_at, file.started_at))
    .filter(value => value !== null)
  const productionToTermination = files
    .map(file => daysBetween(file.started_at, file.in_termination_at))
    .filter(value => value !== null)
  const terminationToCompletion = files
    .map(file => daysBetween(file.in_termination_at, file.completed_at))
    .filter(value => value !== null)
  const cycleTimes = completedFiles
    .map(file => daysBetween(file.created_at, file.completed_at))
    .filter(value => value !== null)

  const stageTiming = {
    design_to_quote: roundMetric(average(orderDesignToQuote), 1),
    quote_to_production: roundMetric(average(quoteToProduction), 1),
    production_to_termination: roundMetric(average(productionToTermination), 1),
    termination_to_completion: roundMetric(average(terminationToCompletion), 1),
    total_cycle_time: roundMetric(average(cycleTimes), 1),
  }

  const bottlenecks = activeFiles
    .map(file => {
      const order = orderMap.get(file.order_id)
      const daysInStage = daysBetween(getStageStart(file), nowIso) || 0
      return {
        file_id: file.id,
        order_id: file.order_id,
        client_name: order?.client_name || 'Sin nombre',
        area_code: file.production_area_code,
        stage: file.status,
        days_in_stage: roundMetric(daysInStage, 1),
      }
    })
    .filter(item => item.days_in_stage > 3)
    .sort((a, b) => b.days_in_stage - a.days_in_stage)
    .slice(0, 20)

  const bottlenecksByArea = bottlenecks.reduce((acc, item) => {
    const key = item.area_code || 'sin_area'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const trendMap = {}
  files.forEach(file => {
    const day = (file.created_at || '').slice(0, 10)
    if (!day) return
    if (!trendMap[day]) trendMap[day] = { date: day, total: 0, completed: 0, active: 0 }
    trendMap[day].total += 1
    if (file.status === 'completed') trendMap[day].completed += 1
    if (ACTIVE_PRODUCTION_STATUSES.includes(file.status)) trendMap[day].active += 1
    const area = file.production_area_code || 'sin_area'
    trendMap[day][area] = (trendMap[day][area] || 0) + 1
  })
  const trend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date))

  let comparison = null
  if (compare_from && compare_to) {
    const { data: prevFiles } = await supabase.from('order_production_files')
      .select('id, status, started_at, in_termination_at, completed_at, created_at')
      .gte('created_at', compare_from).lt('created_at', compare_to)
    const previous = prevFiles || []
    const previousCompleted = previous.filter(file => file.status === 'completed')
    const previousActive = previous.filter(file => ACTIVE_PRODUCTION_STATUSES.includes(file.status))
    const previousCycleTimes = previousCompleted.map(file => daysBetween(file.created_at, file.completed_at)).filter(value => value !== null)
    comparison = {
      total_files: { prev: previous.length, curr: totalFiles, change_pct: safeChangePct(totalFiles, previous.length) },
      completed: { prev: previousCompleted.length, curr: completedFiles.length, change_pct: safeChangePct(completedFiles.length, previousCompleted.length) },
      active_files: { prev: previousActive.length, curr: activeFiles.length, change_pct: safeChangePct(activeFiles.length, previousActive.length) },
      avg_cycle_time_days: { prev: roundMetric(average(previousCycleTimes), 1), curr: stageTiming.total_cycle_time, change_pct: safeChangePct(stageTiming.total_cycle_time, average(previousCycleTimes)) },
    }
  }

  const completionRate = totalFiles > 0 ? roundMetric((completedFiles.length / totalFiles) * 100, 1) : 0
  const reversionRate = totalFiles > 0 ? roundMetric((reversions / totalFiles) * 100, 1) : 0
  const priorityBreakdown = buildPriorityBreakdown(files, orderMap)
  const areaPriorityBreakdown = areaMetrics.map(area => ({
    code: area.code,
    label: area.label,
    normal: area.normal,
    urgent_911: area.urgent_911,
    total: area.total_files,
    urgent_pct: area.urgent_pct,
  }))
  const areaComparison = areaMetrics.map(area => ({
    ...area,
    bottlenecks: bottlenecksByArea[area.code] || 0,
    pct_of_total: totalFiles > 0 ? roundMetric((area.total_files / totalFiles) * 100, 1) : 0,
    wip_pressure: area.total_files > 0 ? roundMetric((area.active_files / area.total_files) * 100, 1) : 0,
  }))

  const profileMap = new Map(profileList.map(profile => [profile.id, profile]))
  const capacityMap = new Map()
  files.forEach(file => {
    const userId = file.assigned_to || null
    const areaCode = file.production_area_code || 'sin_area'
    const key = `${userId || 'unassigned'}:${areaCode}`
    if (!capacityMap.has(key)) {
      const profile = userId ? profileMap.get(userId) : null
      const area = areaMap.get(areaCode)
      capacityMap.set(key, {
        user_id: userId,
        name: profile?.name || 'Sin asignar',
        area_code: areaCode,
        area_label: area?.label || areaCode,
        assigned_count: 0,
        active_count: 0,
        orders: [],
        _orderIds: new Set(),
      })
    }
    const entry = capacityMap.get(key)
    entry.assigned_count += 1
    if (ACTIVE_PRODUCTION_STATUSES.includes(file.status)) entry.active_count += 1
    const order = orderMap.get(file.order_id)
    if (order && !entry._orderIds.has(order.id)) {
      entry._orderIds.add(order.id)
      entry.orders.push({
        ...order,
        production_area_code: file.production_area_code,
        production_file_id: file.id,
        production_file_status: file.status,
        production_stage_days: roundMetric(daysBetween(getStageStart(file), nowIso) || 0, 1),
      })
    }
  })
  const capacityDistribution = Array.from(capacityMap.values())
    .map(entry => {
      const { _orderIds, ...cleanEntry } = entry
      return {
        ...cleanEntry,
        orders: cleanEntry.orders
          .sort((a, b) => (Number(b.production_stage_days) || 0) - (Number(a.production_stage_days) || 0))
          .slice(0, 4),
      }
    })
    .sort((a, b) => (b.active_count - a.active_count) || (b.assigned_count - a.assigned_count) || a.name.localeCompare(b.name))
    .slice(0, 8)

  const agingBuckets = [
    { key: '0-1d', label: '0-1 dias', count: 0 },
    { key: '2-3d', label: '2-3 dias', count: 0 },
    { key: '4-7d', label: '4-7 dias', count: 0 },
    { key: '8d+', label: '8+ dias', count: 0 },
  ]
  activeFiles.forEach(file => {
    const age = daysBetween(getStageStart(file), nowIso) || 0
    if (age <= 1) agingBuckets[0].count += 1
    else if (age <= 3) agingBuckets[1].count += 1
    else if (age <= 7) agingBuckets[2].count += 1
    else agingBuckets[3].count += 1
  })

  const historyMonths = MONTH_LABELS.map((label, index) => {
    const key = `${now.getFullYear()}-${String(index + 1).padStart(2, '0')}`
    const monthFiles = historyFiles.filter(file => getMonthKey(file.created_at) === key)
    return buildPeriodPayload({ key: `month-${String(index + 1).padStart(2, '0')}`, label, files: monthFiles, areaItems: Array.from(areaMap.values()), orderMap: historyOrderMap })
  })
  const buildRollingPeriod = (monthsBack, key, label) => {
    const start = new Date(now)
    start.setMonth(start.getMonth() - monthsBack)
    const rollingFiles = historyFiles.filter(file => {
      const createdAt = new Date(file.created_at)
      return !Number.isNaN(createdAt.getTime()) && createdAt >= start && createdAt < now
    })
    return buildPeriodPayload({ key, label, files: rollingFiles, areaItems: Array.from(areaMap.values()), orderMap: historyOrderMap })
  }
  const history = {
    current: buildPeriodPayload({ key: 'current', label: 'Actual', files, areaItems: Array.from(areaMap.values()), orderMap }),
    months: historyMonths,
    rolling: [
      buildRollingPeriod(3, 'rolling-3', 'Ultimos 3 meses'),
      buildRollingPeriod(6, 'rolling-6', 'Ultimos 6 meses'),
      buildRollingPeriod(12, 'rolling-12', 'Ultimo ano'),
    ],
  }

  const nonEmptyAreas = areaComparison.filter(area => area.total_files > 0)
  const dominantArea = [...nonEmptyAreas].sort((a, b) => b.total_files - a.total_files)[0] || null
  const highest911Area = [...nonEmptyAreas].sort((a, b) => b.urgent_911 - a.urgent_911)[0] || null
  const fastestArea = nonEmptyAreas.filter(area => area.completed > 0 && area.avg_time_days > 0).sort((a, b) => a.avg_time_days - b.avg_time_days)[0] || null
  const pressureArea = [...nonEmptyAreas].sort((a, b) => (b.bottlenecks - a.bottlenecks) || (b.active_files - a.active_files))[0] || null
  const operationalInsights = {
    dominant_area: dominantArea ? { code: dominantArea.code, label: dominantArea.label, value: dominantArea.total_files, pct: dominantArea.pct_of_total } : null,
    highest_911_area: highest911Area ? { code: highest911Area.code, label: highest911Area.label, value: highest911Area.urgent_911, pct: highest911Area.urgent_pct } : null,
    fastest_area: fastestArea ? { code: fastestArea.code, label: fastestArea.label, value: fastestArea.avg_time_days } : null,
    pressure_area: pressureArea ? { code: pressureArea.code, label: pressureArea.label, bottlenecks: pressureArea.bottlenecks, active_files: pressureArea.active_files } : null,
    inflow_outflow: {
      incoming: totalFiles,
      completed: completedFiles.length,
      net_wip: totalFiles - completedFiles.length,
      throughput_rate: totalFiles > 0 ? roundMetric((completedFiles.length / totalFiles) * 100, 1) : 0,
    },
  }

  return {
    areas: areaMetrics,
    area_load: areaLoad,
    file_status: fileStatus,
    stage_timing: stageTiming,
    bottlenecks,
    trend,
    total_files: totalFiles,
    total_completed: completedFiles.length,
    totals: {
      total_files: totalFiles,
      active_files: activeFiles.length,
      completed: completedFiles.length,
      pending: fileStatus.pending,
      in_production: fileStatus.in_production,
      in_termination: fileStatus.in_termination,
      completion_rate: completionRate,
      bottleneck_count: bottlenecks.length,
      avg_cycle_time_days: stageTiming.total_cycle_time,
    },
    quality: {
      reversions,
      reversion_rate: reversionRate,
      first_time_right: completedFiles.length > 0 ? roundMetric(((completedFiles.length - reversions) / completedFiles.length) * 100, 1) : 100,
    },
    history,
    priority_breakdown: priorityBreakdown,
    area_priority_breakdown: areaPriorityBreakdown,
    area_comparison: areaComparison,
    capacity_distribution: capacityDistribution,
    aging_buckets: agingBuckets,
    operational_insights: operationalInsights,
    comparison,
  }
}

export async function handleKpiData(body, env) {
  const authResult = await requireAdmin(env.authHeader, env)
  if (!authResult.authorized) {
    return { status: 401, body: { error: authResult.error } }
  }

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return { status: 500, body: { error: 'Configuración de Supabase incompleta' } }
  }

  const accessToken = String(env.authHeader || '').replace(/^Bearer\s+/i, '').trim()
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })

  try {
    const {
      action = 'business_summary',
      date_from = null,
      date_to = null,
      compare_from = null,
      compare_to = null,
    } = body

    let result

    switch (action) {
      case 'business_summary': {
        const { data, error } = await supabase.rpc('kpi_business_summary', {
          p_date_from: date_from, p_date_to: date_to,
          p_compare_from: compare_from, p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'orders_analytics': {
        const { data, error } = await supabase.rpc('kpi_orders_analytics', {
          p_date_from: date_from, p_date_to: date_to,
          p_compare_from: compare_from, p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'client_analytics': {
        const { data, error } = await supabase.rpc('kpi_client_analytics', {
          p_date_from: date_from, p_date_to: date_to,
          p_compare_from: compare_from, p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'user_analytics': {
        const { data, error } = await supabase.rpc('kpi_user_analytics', {
          p_date_from: date_from, p_date_to: date_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'production_insights': {
        result = await buildProductionDepartmentInsights(supabase, { date_from, date_to, compare_from, compare_to })
        break
      }

      case 'smart_alerts': {
        const { data, error } = await supabase.rpc('kpi_smart_alerts')
        if (error) throw error
        result = data
        break
      }

      case 'smart_alerts_center': {
        result = await buildSmartAlertsCenter(supabase, { date_from, date_to })
        break
      }

      case 'update_alert_state': {
        const { alert_key, status, note = '' } = body
        if (!alert_key) return { status: 400, body: { error: 'alert_key es requerido' } }

        if (!isValidAlertStatus(status)) {
          return { status: 400, body: { error: 'Estado de alerta invalido.' } }
        }
        const normalizedStatus = String(status || '').trim().toLowerCase()

        const timestamp = new Date().toISOString()
        const payload = {
          alert_key,
          status: normalizedStatus,
          note: String(note || '').slice(0, 500),
          updated_by: authResult.user.id,
          updated_at: timestamp,
        }

        if (normalizedStatus === 'revisada') payload.reviewed_at = timestamp
        if (normalizedStatus === 'descartada') payload.dismissed_at = timestamp
        if (normalizedStatus === 'resuelta') payload.resolved_at = timestamp

        const { data, error } = await supabase
          .from('kpi_alert_states')
          .upsert(payload, { onConflict: 'alert_key' })
          .select()
          .single()

        if (error) {
          if (/kpi_alert_states|does not exist|schema cache/i.test(error.message || '')) {
            result = { ok: true, persisted: false, alert_key, status: normalizedStatus }
            break
          }
          throw error
        }

        result = { ok: true, persisted: true, state: data }
        break
      }

      case 'orders_trend': {
        const { data, error } = await supabase.rpc('kpi_orders_trend', { p_days: 30 })
        if (error) throw error
        result = data
        break
      }

      case 'sales_overview': {
        const { data, error } = await supabase.rpc('kpi_sales_overview', {
          p_date_from: date_from,
          p_date_to: date_to,
          p_compare_from: compare_from,
          p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'seller_detail': {
        const { seller_id } = body
        if (!seller_id) return { status: 400, body: { error: 'seller_id es requerido' } }
        const { data, error } = await supabase.rpc('kpi_seller_detail', {
          p_seller_id: seller_id,
          p_date_from: date_from,
          p_date_to: date_to,
          p_compare_from: compare_from,
          p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'seller_daily_trend': {
        const { metric = 'orders' } = body
        const { data, error } = await supabase.rpc('kpi_seller_daily_trend', {
          p_metric: metric,
          p_date_from: date_from,
          p_date_to: date_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'seller_profile': {
        const { seller_id } = body
        if (!seller_id) return { status: 400, body: { error: 'seller_id es requerido' } }

        let ordersQuery = supabase.from('orders')
          .select('client_id, client_name, material, status, payment_status, created_at')
          .or(`seller_id.eq.${seller_id},created_by.eq.${seller_id}`)
        if (date_from) ordersQuery = ordersQuery.gte('created_at', date_from)
        if (date_to) ordersQuery = ordersQuery.lt('created_at', date_to)

        const { data: ordersData, error: ordersError } = await ordersQuery
        if (ordersError) throw ordersError

        const clientMap = {}
        ;(ordersData || []).forEach(o => {
          const name = (o.client_name || '').trim()
          if (!name) return
          if (!clientMap[name]) clientMap[name] = { client_id: o.client_id, client_name: name, total: 0, completed: 0, cancelled: 0 }
          clientMap[name].total++
          const st = (o.status || '').toLowerCase()
          if (st === 'in_completed' || st === 'in_delivered') clientMap[name].completed++
          if (st === 'cancelled') clientMap[name].cancelled++
        })

        const top_clients = Object.values(clientMap)
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
          .map(c => ({
            client_id: c.client_id,
            client_name: c.client_name,
            total_orders: c.total,
            completed_orders: c.completed,
            cancel_rate: c.total > 0 ? Math.round(c.cancelled / c.total * 1000) / 10 : 0,
          }))

        const matMap = {}
        let totalMatCount = 0
        ;(ordersData || []).forEach(o => {
          if (!o.material) return
          o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
            matMap[m] = (matMap[m] || 0) + 1
            totalMatCount++
          })
        })

        const materials = Object.entries(matMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([name, count]) => ({
            name,
            count,
            pct: totalMatCount > 0 ? Math.round(count / totalMatCount * 1000) / 10 : 0,
          }))

        const days = (date_from && date_to) ? Math.max((new Date(date_to) - new Date(date_from)) / 86400000, 1) : 30
        const totalOrders = (ordersData || []).length

        const lastOrderDate = totalOrders > 0
          ? new Date(Math.max(...ordersData.map(o => new Date(o.created_at))))
          : null
        const daysSinceLastOrder = lastOrderDate
          ? Math.floor((Date.now() - lastOrderDate.getTime()) / 86400000)
          : null

        const activeOrders = (ordersData || []).filter(o => {
          const st = (o.status || '').toLowerCase()
          return st !== 'cancelled' && st !== 'in_completed' && st !== 'in_delivered'
        })
        const pendingPaymentOrders = activeOrders.filter(o => {
          const ps = (o.payment_status || '').toLowerCase()
          return ps === 'credito' || ps === 'parcial' || ps === 'pending_payment'
        })
        const pendingPaymentPct = activeOrders.length > 0
          ? Math.round(pendingPaymentOrders.length / activeOrders.length * 1000) / 10
          : 0

        let clientsRegistered = 0
        try {
          const { count } = await supabase.from('clients')
            .select('id', { count: 'exact', head: true })
            .eq('created_by', seller_id)
            .gte('created_at', date_from || '1970-01-01')
            .lt('created_at', date_to || new Date().toISOString())
          clientsRegistered = count || 0
        } catch { /* ignore */ }

        result = {
          top_clients,
          materials,
          order_frequency: {
            per_day: totalOrders > 0 ? Math.round(totalOrders / days * 100) / 100 : 0,
            per_week: totalOrders > 0 ? Math.round(totalOrders / (days / 7) * 100) / 100 : 0,
            per_month: totalOrders > 0 ? Math.round(totalOrders / (days / 30) * 100) / 100 : 0,
          },
          days_since_last_order: daysSinceLastOrder,
          pending_payment_pct: pendingPaymentPct,
          clients_registered: clientsRegistered,
        }
        break
      }

      case 'seller_activity': {
        const { seller_id, offset = 0, limit = 10 } = body
        if (!seller_id) return { status: 400, body: { error: 'seller_id es requerido' } }

        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: orderEvents } = await supabase
          .from('order_events')
          .select(`
            id, event_type, old_status, new_status,
            old_payment_status, new_payment_status,
            changes, created_at,
            order_id,
            orders!inner (id, client_name, order_type, seller_id, created_by)
          `)
          .or(`orders.seller_id.eq.${seller_id},orders.created_by.eq.${seller_id}`)
          .gte('created_at', from)
          .lt('created_at', to)
          .order('created_at', { ascending: false })

        const { data: clientEvents } = await supabase
          .from('clients')
          .select('id, name, created_at')
          .eq('created_by', seller_id)
          .gte('created_at', from)
          .lt('created_at', to)

        const events = [
          ...(orderEvents || []).map(e => ({
            id: e.id,
            type: e.event_type,
            order_id: e.order_id,
            order_client: e.orders?.client_name,
            order_type: e.orders?.order_type,
            old_status: e.old_status,
            new_status: e.new_status,
            old_payment: e.old_payment_status,
            new_payment: e.new_payment_status,
            changes: e.changes,
            created_at: e.created_at,
            source: 'order',
          })),
          ...(clientEvents || []).map(c => ({
            id: c.id,
            type: 'client_created',
            client_name: c.name,
            created_at: c.created_at,
            source: 'client',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = events.length
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      case 'seller_metrics': {
        const { metric = 'orders' } = body
        const { data, error } = await supabase.rpc('kpi_seller_metrics', {
          p_metric: metric,
          p_date_from: date_from,
          p_date_to: date_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'sla_violations': {
        const { data, error } = await supabase.rpc('kpi_sla_violations')
        if (error) throw error
        result = data
        break
      }

      case 'payment_summary': {
        const now = new Date()
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

        const [credito, parcial, pendingPayment, pendingAged] = await Promise.all([
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'credito').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'parcial').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'Pending_Payment').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id, client_name, created_at').eq('payment_status', 'Pending_Payment').not('status', 'in', '(cancelled,in_completed,in_delivered)').lt('created_at', threeDaysAgo.toISOString()).order('created_at', { ascending: true }),
        ])

        if (credito.error) console.error('credito:', credito.error.message)
        if (parcial.error) console.error('parcial:', parcial.error.message)
        if (pendingPayment.error) console.error('pendingPayment:', pendingPayment.error.message)
        if (pendingAged.error) console.error('pendingAged:', pendingAged.error.message)

        const agedOrders = (pendingAged.data || []).map(o => ({
          id: o.id,
          client_name: o.client_name,
          days_pending: (now - new Date(o.created_at)) / (1000 * 60 * 60 * 24),
        }))

        const paymentByClientRaw = await supabase.from('orders')
          .select('client_id, client_name, payment_status, price, id, created_at, invoice_number')
          .in('payment_status', ['credito', 'parcial'])
          .not('status', 'in', '(cancelled,in_completed,in_delivered)')

        if (paymentByClientRaw.error) console.error('paymentByClient:', paymentByClientRaw.error.message)

        const byClientMap = {}
        ;(paymentByClientRaw.data || []).forEach(o => {
          if (!o.client_id) return
          if (!byClientMap[o.client_id]) {
            byClientMap[o.client_id] = {
              client_id: o.client_id,
              client_name: o.client_name,
              credito_count: 0,
              parcial_count: 0,
              total_pending: 0,
              orders: [],
            }
          }
          if (o.payment_status === 'credito') byClientMap[o.client_id].credito_count++
          if (o.payment_status === 'parcial') byClientMap[o.client_id].parcial_count++
          const price = parseFloat(o.price) || 0
          byClientMap[o.client_id].total_pending += price
          byClientMap[o.client_id].orders.push({
            id: o.id,
            price,
            payment_status: o.payment_status,
            created_at: o.created_at,
            invoice_number: o.invoice_number || '',
          })
        })

        result = {
          credito: credito.count || 0,
          parcial: parcial.count || 0,
          pending_payment: pendingPayment.count || 0,
          pending_payment_aged: {
            count: agedOrders.length,
            orders: agedOrders,
          },
          by_client: Object.values(byClientMap)
            .filter(c => c.credito_count + c.parcial_count > 0)
            .sort((a, b) => b.total_pending - a.total_pending),
        }
        break
      }

      case 'order_counts': {
        const mkBase = () => supabase.from('orders').select('id', { count: 'exact', head: true })
        const mkActive = () => mkBase().not('status', 'in', '(cancelled,in_completed,in_delivered)')

        const [
          all, internal, external, normal, urgent911,
          internalNormal, internal911, externalNormal, external911,
          payPending, payPartial, payPaid, payCredit,
          wfPending, wfDesign, wfQuote, wfProduction, wfTermination, wfCompleted, wfDelivered,
          opActive, opBlocked,
        ] = await Promise.all([
          mkBase(),
          mkActive().eq('order_design_type', 'INTERNAL_DESING'),
          mkActive().eq('order_design_type', 'EXTERNAL_DESING'),
          mkActive().eq('order_type', 'orden normal'),
          mkActive().eq('order_type', 'orden 911'),
          mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden normal'),
          mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden 911'),
          mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden normal'),
          mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden 911'),
          mkActive().eq('payment_status', 'Pending_Payment'),
          mkActive().eq('payment_status', 'parcial'),
          mkActive().eq('payment_status', 'pagado'),
          mkActive().eq('payment_status', 'credito'),
          mkActive().eq('status', 'Pending'),
          mkActive().eq('status', 'in_Design'),
          mkActive().eq('status', 'in_Quote'),
          mkActive().eq('status', 'in_Production'),
          mkActive().eq('status', 'in_Termination'),
          mkActive().eq('status', 'in_Completed'),
          mkActive().eq('status', 'in_Delivered'),
          mkActive().eq('operational_status', 'active'),
          mkActive().eq('operational_status', 'blocked'),
        ])

        result = {
          totals: {
            all: all.count || 0,
            internal: internal.count || 0,
            external: external.count || 0,
            normal: normal.count || 0,
            urgent_911: urgent911.count || 0,
          },
          combinations: {
            internal_normal: internalNormal.count || 0,
            internal_911: internal911.count || 0,
            external_normal: externalNormal.count || 0,
            external_911: external911.count || 0,
          },
          payment: {
            pending: payPending.count || 0,
            partial: payPartial.count || 0,
            paid: payPaid.count || 0,
            credit: payCredit.count || 0,
          },
          workflow: {
            pending: wfPending.count || 0,
            design: wfDesign.count || 0,
            quote: wfQuote.count || 0,
            production: wfProduction.count || 0,
            termination: wfTermination.count || 0,
            completed: wfCompleted.count || 0,
            delivered: wfDelivered.count || 0,
          },
          operational: {
            active: opActive.count || 0,
            blocked: opBlocked.count || 0,
          },
        }
        break
      }

      // ─── Design Intelligence ────────────────────────────────────────────────

      case 'design_overview': {
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: designOrders }, { data: designers }, { count: totalDesigners }] = await Promise.all([
          supabase.from('orders')
            .select('id, designer_id, status, order_design_type, return_reason, status_changed_at, created_at, client_name, material, order_type', { count: 'exact' })
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id, name').eq('role', 'designer'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'designer'),
        ])

        const orders = designOrders || []
        const designerList = designers || []
        const activeDesignerIds = new Set(orders.filter(o => ['in_Design', 'in_Quote', 'in_Production', 'in_Termination'].includes(o.status)).map(o => o.designer_id).filter(Boolean))

        const total = orders.length
        const completed = orders.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
        const inDesign = orders.filter(o => o.status === 'in_Design').length
        const pending = orders.filter(o => o.status === 'Pending').length
        const returned = orders.filter(o => o.return_reason).length
        const cancelled = orders.filter(o => o.status === 'cancelled').length

        const completedOrders = orders.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
        const avgDays = completedOrders.length > 0
          ? completedOrders.reduce((sum, o) => {
              const created = new Date(o.created_at)
              const changed = new Date(o.status_changed_at)
              return sum + (changed - created) / 86400000
            }, 0) / completedOrders.length
          : 0

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrders } = await supabase.from('orders')
            .select('id, status, return_reason, status_changed_at, created_at')
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', compare_from).lt('created_at', compare_to)

          const prev = prevOrders || []
          const prevCompleted = prev.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
          const prevReturned = prev.filter(o => o.return_reason).length
          const prevCompletedOrders = prev.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
          const prevAvgDays = prevCompletedOrders.length > 0
            ? prevCompletedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / prevCompletedOrders.length
            : 0

          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100

          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            completed: { prev: prevCompleted, curr: completed, change_pct: safePct(completed, prevCompleted) },
            returned: { prev: prevReturned, curr: returned, change_pct: safePct(returned, prevReturned) },
            avg_days: { prev: +prevAvgDays.toFixed(1), curr: +avgDays.toFixed(1), change_pct: safePct(avgDays, prevAvgDays) },
          }
        }

        const alerts = []
        if (total > 0 && returned / total > 0.15) alerts.push({ type: 'high_return', title: 'Alta tasa de devolución', message: `${((returned / total) * 100).toFixed(0)}% de órdenes devueltas`, severity: 'critical' })
        if (inDesign > 5) alerts.push({ type: 'design_bottleneck', title: 'Cuello de botella en diseño', message: `${inDesign} órdenes en proceso de diseño`, severity: 'warning' })
        if (pending > 3) alerts.push({ type: 'pending_orders', title: 'Órdenes pendientes', message: `${pending} órdenes esperando ser asignadas`, severity: 'warning' })

        const statusBreakdown = { pending, in_design: inDesign, in_quote: orders.filter(o => o.status === 'in_Quote').length, in_production: orders.filter(o => o.status === 'in_Production').length, in_termination: orders.filter(o => o.status === 'in_Termination').length, completed: orders.filter(o => o.status === 'in_Completed').length, delivered: orders.filter(o => o.status === 'in_Delivered').length, cancelled }

        result = {
          summary: {
            total_orders: total, completed_orders: completed, in_design: inDesign, pending_orders: pending, returned_orders: returned, cancelled_orders: cancelled,
            completion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            return_rate: total > 0 ? +((returned / total) * 100).toFixed(1) : 0,
            avg_design_days: +avgDays.toFixed(1),
            total_designers: totalDesigners || 0,
            active_designers: activeDesignerIds.size,
          },
          status_breakdown: statusBreakdown,
          designers: designerList,
          alerts,
          comparison: cmp,
        }
        break
      }

      case 'designer_metrics': {
        const { metric = 'orders' } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: designers } = await supabase.from('profiles').select('id, name').eq('role', 'designer')
        const designerList = designers || []

        let values = []
        if (metric === 'files') {
          const { data: files } = await supabase.from('order_production_files')
            .select('created_by').gte('created_at', from).lt('created_at', to)
          const countByDesigner = {}
          ;(files || []).forEach(f => { if (f.created_by) countByDesigner[f.created_by] = (countByDesigner[f.created_by] || 0) + 1 })
          values = designerList.map(d => ({ id: d.id, name: d.name, value: countByDesigner[d.id] || 0 }))
        } else if (metric === 'avg_time') {
          const { data: orders } = await supabase.from('orders')
            .select('designer_id, status_changed_at, created_at')
            .eq('order_design_type', 'INTERNAL_DESING')
            .not('designer_id', 'is', null)
            .gte('created_at', from).lt('created_at', to)
          const timeByDesigner = {}
          const countByDesigner = {}
          ;(orders || []).forEach(o => {
            if (o.designer_id && o.status_changed_at) {
              const days = (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000
              timeByDesigner[o.designer_id] = (timeByDesigner[o.designer_id] || 0) + days
              countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            }
          })
          values = designerList.map(d => ({ id: d.id, name: d.name, value: countByDesigner[d.id] ? +(timeByDesigner[d.id] / countByDesigner[d.id]).toFixed(1) : 0 }))
        } else {
          const statusMap = { orders: null, completed: ['in_Completed', 'in_Delivered'], in_design: ['in_Design'], returned: null }
          const { data: orders } = await supabase.from('orders')
            .select('designer_id, status, return_reason')
            .eq('order_design_type', 'INTERNAL_DESING')
            .not('designer_id', 'is', null)
            .gte('created_at', from).lt('created_at', to)

          const countByDesigner = {}
          ;(orders || []).forEach(o => {
            if (!o.designer_id) return
            if (metric === 'returned') {
              if (o.return_reason) countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            } else if (statusMap[metric]) {
              if (statusMap[metric].includes(o.status)) countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            } else {
              countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            }
          })
          values = designerList.map(d => ({ id: d.id, name: d.name, value: countByDesigner[d.id] || 0 }))
        }

        const total = values.reduce((s, v) => s + v.value, 0)
        values.sort((a, b) => b.value - a.value)
        values.forEach((v, i) => {
          v.pct = total > 0 ? +((v.value / total) * 100).toFixed(1) : 0
          v.rank = i + 1
        })

        const metricLabels = { orders: 'Órdenes Totales', completed: 'Completadas', in_design: 'En Diseño', returned: 'Devueltas', files: 'Archivos Subidos', avg_time: 'Tiempo Prom. (días)' }
        result = { metric, metric_label: metricLabels[metric] || metric, total, designers: values }
        break
      }

      case 'designer_daily_trend': {
        const { metric = 'orders' } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: designers } = await supabase.from('profiles').select('id, name').eq('role', 'designer')
        const designerMap = {}
        ;(designers || []).forEach(d => { designerMap[d.id] = d.name })

        const trend = []
        if (metric === 'files') {
          const { data: files } = await supabase.from('order_production_files')
            .select('created_by, created_at').gte('created_at', from).lt('created_at', to)
          const byDateDesigner = {}
          ;(files || []).forEach(f => {
            if (!f.created_by || !designerMap[f.created_by]) return
            const day = f.created_at.slice(0, 10)
            const key = `${day}_${f.created_by}`
            byDateDesigner[key] = (byDateDesigner[key] || 0) + 1
          })
          Object.entries(byDateDesigner).forEach(([key, value]) => {
            const [date, designer_id] = key.split('_')
            trend.push({ date, designer_id, designer_name: designerMap[designer_id], value })
          })
        } else {
          const { data: orders } = await supabase.from('orders')
            .select('designer_id, status, return_reason, created_at')
            .eq('order_design_type', 'INTERNAL_DESING')
            .not('designer_id', 'is', null)
            .gte('created_at', from).lt('created_at', to)

          const byDateDesigner = {}
          ;(orders || []).forEach(o => {
            if (!designerMap[o.designer_id]) return
            const day = o.created_at.slice(0, 10)
            const key = `${day}_${o.designer_id}`
            let count = false
            if (metric === 'orders') count = true
            else if (metric === 'completed' && ['in_Completed', 'in_Delivered'].includes(o.status)) count = true
            else if (metric === 'in_design' && o.status === 'in_Design') count = true
            else if (metric === 'returned' && o.return_reason) count = true
            if (count) byDateDesigner[key] = (byDateDesigner[key] || 0) + 1
          })
          Object.entries(byDateDesigner).forEach(([key, value]) => {
            const [date, designer_id] = key.split('_')
            trend.push({ date, designer_id, designer_name: designerMap[designer_id], value })
          })
        }

        trend.sort((a, b) => a.date.localeCompare(b.date) || a.designer_id.localeCompare(b.designer_id))
        const metricLabels = { orders: 'Órdenes Totales', completed: 'Completadas', in_design: 'En Diseño', returned: 'Devueltas', files: 'Archivos Subidos' }
        result = { metric, metric_label: metricLabels[metric] || metric, trend }
        break
      }

      case 'designer_detail': {
        const { designer_id } = body
        if (!designer_id) return { status: 400, body: { error: 'designer_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: designer }, { data: orders }, { count: totalAll }, { count: designerCount }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', designer_id).single(),
          supabase.from('orders')
            .select('id, status, return_reason, order_design_type, order_type, client_name, material, status_changed_at, created_at')
            .eq('designer_id', designer_id)
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('orders').select('id', { count: 'exact', head: true })
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'designer'),
        ])

        const ords = orders || []
        const total = ords.length
        const completed = ords.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
        const inDesign = ords.filter(o => o.status === 'in_Design').length
        const pending = ords.filter(o => o.status === 'Pending').length
        const returned = ords.filter(o => o.return_reason).length
        const cancelled = ords.filter(o => o.status === 'cancelled').length
        const inQuote = ords.filter(o => o.status === 'in_Quote').length
        const inProduction = ords.filter(o => o.status === 'in_Production').length
        const delivered = ords.filter(o => o.status === 'in_Delivered').length

        const completedOrders = ords.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
        const avgDays = completedOrders.length > 0
          ? completedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / completedOrders.length
          : 0

        const normal = ords.filter(o => o.order_type !== 'orden 911').length
        const urgent = ords.filter(o => o.order_type === 'orden 911').length

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrders } = await supabase.from('orders')
            .select('id, status, return_reason, status_changed_at, created_at')
            .eq('designer_id', designer_id)
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', compare_from).lt('created_at', compare_to)

          const prev = prevOrders || []
          const prevCompleted = prev.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
          const prevReturned = prev.filter(o => o.return_reason).length
          const prevCompletedOrders = prev.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
          const prevAvgDays = prevCompletedOrders.length > 0
            ? prevCompletedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / prevCompletedOrders.length
            : 0

          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            completed: { prev: prevCompleted, curr: completed, change_pct: safePct(completed, prevCompleted) },
            returned: { prev: prevReturned, curr: returned, change_pct: safePct(returned, prevReturned) },
            avg_days: { prev: +prevAvgDays.toFixed(1), curr: +avgDays.toFixed(1), change_pct: safePct(avgDays, prevAvgDays) },
          }
        }

        const vsDept = {
          orders_vs_avg: totalAll > 0 && (designerCount || 1) > 0
            ? +((total / (totalAll / (designerCount || 1)) - 1) * 100).toFixed(1)
            : 0,
        }

        result = {
          designer: designer || { id: designer_id, name: 'Desconocido' },
          orders: { total, normal, urgent, completed, cancelled, pending, in_design: inDesign, in_quote: inQuote, in_production: inProduction, delivered, returned },
          rates: {
            completion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            return_rate: total > 0 ? +((returned / total) * 100).toFixed(1) : 0,
            avg_design_days: +avgDays.toFixed(1),
          },
          vs_department: vsDept,
          comparison: cmp,
        }
        break
      }

      case 'designer_profile': {
        const { designer_id } = body
        if (!designer_id) return { status: 400, body: { error: 'designer_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: orders }, { data: files }] = await Promise.all([
          supabase.from('orders')
            .select('id, client_id, client_name, material, status, created_at, status_changed_at')
            .eq('designer_id', designer_id)
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_production_files')
            .select('id, production_area_code, created_at, started_at, completed_at')
            .eq('created_by', designer_id)
            .gte('created_at', from).lt('created_at', to),
        ])

        const ords = orders || []
        const fils = files || []

        const clientCount = {}
        ords.forEach(o => {
          if (!o.client_name) return
          if (!clientCount[o.client_name]) clientCount[o.client_name] = { total: 0, completed: 0, cancelled: 0 }
          clientCount[o.client_name].total++
          if (['in_Completed', 'in_Delivered'].includes(o.status)) clientCount[o.client_name].completed++
          if (o.status === 'cancelled') clientCount[o.client_name].cancelled++
        })
        const topClients = Object.entries(clientCount)
          .map(([client_name, data]) => ({ client_name, total_orders: data.total, completed_orders: data.completed, cancel_rate: data.total > 0 ? Math.round(data.cancelled / data.total * 1000) / 10 : 0 }))
          .sort((a, b) => b.total_orders - a.total_orders).slice(0, 10)

        const materialCount = {}
        ords.forEach(o => { if (o.material) materialCount[o.material] = (materialCount[o.material] || 0) + 1 })
        const materials = Object.entries(materialCount)
          .map(([name, count]) => ({ name, count, pct: ords.length > 0 ? +((count / ords.length) * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count).slice(0, 10)

        const filesByArea = {}
        fils.forEach(f => { if (f.production_area_code) filesByArea[f.production_area_code] = (filesByArea[f.production_area_code] || 0) + 1 })

        const perDay = ords.length
        const daysSpan = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const orderFrequency = { per_day: +(perDay / daysSpan).toFixed(1), per_week: +((perDay / daysSpan) * 7).toFixed(1), per_month: +((perDay / daysSpan) * 30).toFixed(1) }

        let daysSinceLast = null
        if (ords.length > 0) {
          const lastDate = ords.reduce((max, o) => new Date(o.created_at) > new Date(max) ? o.created_at : max, ords[0].created_at)
          daysSinceLast = Math.floor((new Date() - new Date(lastDate)) / 86400000)
        }

        const avgFilesPerOrder = ords.length > 0 ? +(fils.length / ords.length).toFixed(1) : 0

        result = { top_clients: topClients, materials, order_frequency: orderFrequency, days_since_last_order: daysSinceLast, files_by_area: filesByArea, avg_files_per_order: avgFilesPerOrder, total_files: fils.length }
        break
      }

      case 'designer_activity': {
        const { designer_id, offset = 0, limit = 10 } = body
        if (!designer_id) return { status: 400, body: { error: 'designer_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: orderEvents }, { data: files }, { data: clientEvents }] = await Promise.all([
          supabase.from('order_events')
            .select('id, event_type, old_status, new_status, old_payment_status, new_payment_status, changes, created_at, order_id, orders!inner (id, client_name, order_type, designer_id, created_by)')
            .or(`orders.designer_id.eq.${designer_id},orders.created_by.eq.${designer_id}`)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('order_production_files')
            .select('id, order_id, filename, production_area_code, created_at')
            .eq('created_by', designer_id)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('clients')
            .select('id, name, created_at')
            .eq('created_by', designer_id)
            .gte('created_at', from).lt('created_at', to),
        ])

        const events = [
          ...(orderEvents || []).map(e => ({
            id: e.id, type: e.event_type, order_id: e.order_id,
            order_client: e.orders?.client_name, order_type: e.orders?.order_type,
            old_status: e.old_status, new_status: e.new_status,
            old_payment: e.old_payment_status, new_payment: e.new_payment_status,
            changes: e.changes, created_at: e.created_at, source: 'order',
          })),
          ...(files || []).map(f => ({
            id: f.id, type: 'design_file_added', order_id: f.order_id,
            filename: f.filename, production_area_code: f.production_area_code,
            created_at: f.created_at, source: 'file',
          })),
          ...(clientEvents || []).map(c => ({
            id: c.id, type: 'client_created', client_name: c.name,
            created_at: c.created_at, source: 'client',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = events.length
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      case 'quote_metrics': {
        const { metric = 'orders' } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: quotes }, { data: orders }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('role', 'quote').eq('employment_status', true),
          supabase.from('orders').select('id, quote_id, status, status_changed_at, payment_status, created_at')
            .not('quote_id', 'is', null)
            .gte('created_at', from).lt('created_at', to),
        ])

        const quoteList = quotes || []
        const ords = orders || []
        const total = ords.length

        const quoteMap = {}
        quoteList.forEach(q => { quoteMap[q.id] = q.name })

        const computeQuoteMetric = (qId, m) => {
          const userOrds = ords.filter(o => o.quote_id === qId)
          switch (m) {
            case 'completed':
              return userOrds.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
            case 'partial_payment':
              return userOrds.filter(o => o.payment_status === 'parcial').length
            case 'credit':
              return userOrds.filter(o => o.payment_status === 'credito').length
            case 'pending':
              return userOrds.filter(o => o.payment_status === 'Pending_Payment').length
            case 'converted': {
              const completed = userOrds.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
              return userOrds.length > 0 ? +((completed / userOrds.length) * 100).toFixed(1) : 0
            }
            case 'avg_time': {
              const done = userOrds.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
              return done.length > 0
                ? +(done.reduce((s, o) => s + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / done.length).toFixed(1)
                : 0
            }
            default:
              return userOrds.length
          }
        }

        const metricLabels = { orders: 'Órdenes Asignadas', completed: 'Completadas', converted: 'Conversión %', avg_time: 'Tiempo Prom. (días)', partial_payment: 'Pago Parcial', credit: 'Crédito', pending: 'Pendientes de Pago' }
        const enriched = quoteList
          .map(q => ({ id: q.id, name: q.name, value: computeQuoteMetric(q.id, metric) }))
          .filter(q => q.value > 0 || metric === 'orders')
          .sort((a, b) => b.value - a.value)

        const maxVal = enriched.length > 0 ? enriched[0].value : 1
        enriched.forEach((q, i) => {
          q.rank = i + 1
          q.pct = total > 0 ? +((q.value / (['converted', 'avg_time'].includes(metric) ? Math.max(maxVal, 1) : ords.filter(o => o.quote_id === q.id).length || 1)) * 100).toFixed(1) : 0
          if (['converted', 'avg_time'].includes(metric)) {
            q.pct = enriched.length > 0 ? +((q.value / maxVal) * 100).toFixed(1) : 0
          }
        })

        result = { metric, metric_label: metricLabels[metric] || metric, total, quotes: enriched }
        break
      }

      case 'quote_detail': {
        const { quote_id } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: quoteUser }, { data: orders }, { count: totalAll }, { count: quoteCount }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', quote_id).single(),
          supabase.from('orders')
            .select('id, status, return_reason, order_type, client_name, material, payment_status, status_changed_at, created_at')
            .eq('quote_id', quote_id)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('orders').select('id', { count: 'exact', head: true })
            .not('quote_id', 'is', null)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'quote'),
        ])

        const ords = orders || []
        const total = ords.length
        const completed = ords.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
        const inQuote = ords.filter(o => o.status === 'in_Quote').length
        const pending = ords.filter(o => o.status === 'Pending').length
        const returned = ords.filter(o => o.return_reason).length
        const cancelled = ords.filter(o => o.status === 'cancelled').length
        const inProduction = ords.filter(o => o.status === 'in_Production').length
        const delivered = ords.filter(o => o.status === 'in_Delivered').length
        const normal = ords.filter(o => o.order_type !== 'orden 911').length
        const urgent = ords.filter(o => o.order_type === 'orden 911').length

        const paymentPaid = ords.filter(o => o.payment_status === 'pagado').length
        const paymentPartial = ords.filter(o => o.payment_status === 'parcial').length
        const paymentCredit = ords.filter(o => o.payment_status === 'credito').length
        const paymentPending = ords.filter(o => o.payment_status === 'Pending_Payment').length

        const completedOrders = ords.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
        const avgDays = completedOrders.length > 0
          ? completedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / completedOrders.length
          : 0

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrders } = await supabase.from('orders')
            .select('id, status, return_reason, payment_status, status_changed_at, created_at')
            .eq('quote_id', quote_id)
            .gte('created_at', compare_from).lt('created_at', compare_to)

          const prev = prevOrders || []
          const prevCompleted = prev.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
          const prevCompletedOrders = prev.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
          const prevAvgDays = prevCompletedOrders.length > 0
            ? prevCompletedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / prevCompletedOrders.length
            : 0
          const prevCancelled = prev.filter(o => o.status === 'cancelled').length
          const prevPaid = prev.filter(o => o.payment_status === 'pagado').length
          const prevPartial = prev.filter(o => o.payment_status === 'parcial').length
          const prevCredit = prev.filter(o => o.payment_status === 'credito').length
          const prevPendingPay = prev.filter(o => o.payment_status === 'Pending_Payment').length

          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            completed: { prev: prevCompleted, curr: completed, change_pct: safePct(completed, prevCompleted) },
            avg_days: { prev: +prevAvgDays.toFixed(1), curr: +avgDays.toFixed(1), change_pct: safePct(avgDays, prevAvgDays) },
            cancelled: { prev: prevCancelled, curr: cancelled, change_pct: safePct(cancelled, prevCancelled) },
            payment_paid: { prev: prevPaid, curr: paymentPaid, change_pct: safePct(paymentPaid, prevPaid) },
            payment_partial: { prev: prevPartial, curr: paymentPartial, change_pct: safePct(paymentPartial, prevPartial) },
            payment_credit: { prev: prevCredit, curr: paymentCredit, change_pct: safePct(paymentCredit, prevCredit) },
            payment_pending: { prev: prevPendingPay, curr: paymentPending, change_pct: safePct(paymentPending, prevPendingPay) },
          }
        }

        const vsDept = {
          orders_vs_avg: totalAll > 0 && (quoteCount || 1) > 0
            ? +((total / (totalAll / (quoteCount || 1)) - 1) * 100).toFixed(1)
            : 0,
        }

        result = {
          quote: quoteUser || { id: quote_id, name: 'Desconocido' },
          orders: { total, normal, urgent, completed, cancelled, pending, in_quote: inQuote, in_production: inProduction, delivered, returned },
          payment: {
            paid: paymentPaid,
            partial: paymentPartial,
            credit: paymentCredit,
            pending: paymentPending,
            conversion_rate: total > 0 ? +((paymentPaid / total) * 100).toFixed(1) : 0,
            outstanding: paymentPartial + paymentCredit + paymentPending,
          },
          rates: {
            conversion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            completion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            avg_quote_days: +avgDays.toFixed(1),
          },
          vs_department: vsDept,
          comparison: cmp,
        }
        break
      }

      case 'quote_profile': {
        const { quote_id } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: orders } = await supabase.from('orders')
          .select('id, client_id, client_name, material, status, created_at, status_changed_at, order_type')
          .eq('quote_id', quote_id)
          .gte('created_at', from).lt('created_at', to)

        const ords = orders || []

        const clientCount = {}
        ords.forEach(o => {
          if (!o.client_name) return
          if (!clientCount[o.client_name]) clientCount[o.client_name] = { total: 0, completed: 0, cancelled: 0 }
          clientCount[o.client_name].total++
          if (['in_Completed', 'in_Delivered'].includes(o.status)) clientCount[o.client_name].completed++
          if (o.status === 'cancelled') clientCount[o.client_name].cancelled++
        })
        const topClients = Object.entries(clientCount)
          .map(([client_name, data]) => ({ client_name, total_orders: data.total, completed_orders: data.completed, cancel_rate: data.total > 0 ? Math.round(data.cancelled / data.total * 1000) / 10 : 0 }))
          .sort((a, b) => b.total_orders - a.total_orders).slice(0, 10)

        const materialCount = {}
        ords.forEach(o => { if (o.material) materialCount[o.material] = (materialCount[o.material] || 0) + 1 })
        const materials = Object.entries(materialCount)
          .map(([name, count]) => ({ name, count, pct: ords.length > 0 ? +((count / ords.length) * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count).slice(0, 10)

        const perDay = ords.length
        const daysSpan = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const orderFrequency = { per_day: +(perDay / daysSpan).toFixed(1), per_week: +((perDay / daysSpan) * 7).toFixed(1), per_month: +((perDay / daysSpan) * 30).toFixed(1) }

        let daysSinceLast = null
        if (ords.length > 0) {
          const lastDate = ords.reduce((max, o) => new Date(o.created_at) > new Date(max) ? o.created_at : max, ords[0].created_at)
          daysSinceLast = Math.floor((new Date() - new Date(lastDate)) / 86400000)
        }

        const normal = ords.filter(o => o.order_type !== 'orden 911').length
        const urgent = ords.filter(o => o.order_type === 'orden 911').length

        result = { top_clients: topClients, materials, order_frequency: orderFrequency, days_since_last_order: daysSinceLast, quotes_by_type: { normal, urgent } }
        break
      }

      case 'quote_daily_trend': {
        const { quote_id, metric = 'orders' } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: quoteUser }, { data: orders }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', quote_id).single(),
          supabase.from('orders')
            .select('id, quote_id, status, status_changed_at, created_at')
            .eq('quote_id', quote_id)
            .gte('created_at', from).lt('created_at', to),
        ])

        const ords = orders || []
        const quoteName = quoteUser?.name || 'Desconocido'
        const dailyMap = {}

        ords.forEach(o => {
          const date = o.created_at?.slice(0, 10)
          if (!date) return
          const key = `${date}_${quote_id}`
          if (!dailyMap[key]) dailyMap[key] = { date, quote_id, quote_name: quoteName, count: 0, completed: 0, converted: 0, totalDays: 0, completedCount: 0 }

          dailyMap[key].count++
          if (['in_Completed', 'in_Delivered'].includes(o.status)) {
            dailyMap[key].completed++
            dailyMap[key].converted++
          }
          if (o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status)) {
            const days = (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000
            dailyMap[key].totalDays += days
            dailyMap[key].completedCount++
          }
        })

        const metricLabels = { orders: 'Órdenes Totales', completed: 'Completadas', converted: 'Conversión %', avg_time: 'Tiempo Prom. (días)' }
        const trend = Object.values(dailyMap).map(d => {
          let value = d.count
          if (metric === 'completed') value = d.completed
          else if (metric === 'converted') value = d.count > 0 ? +((d.completed / d.count) * 100).toFixed(1) : 0
          else if (metric === 'avg_time') value = d.completedCount > 0 ? +(d.totalDays / d.completedCount).toFixed(1) : 0
          return { date: d.date, quote_id: d.quote_id, quote_name: d.quote_name, value }
        }).sort((a, b) => a.date.localeCompare(b.date))

        result = { metric, metric_label: metricLabels[metric] || metric, trend }
        break
      }

      case 'quote_activity': {
        const { quote_id, offset = 0, limit = 10 } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const fetchLimit = offset + limit + 50
        const [{ data: orderEvents, count: orderTotal }, { data: clientEvents, count: clientTotal }] = await Promise.all([
          supabase.from('order_events')
            .select('id, event_type, old_status, new_status, old_payment_status, new_payment_status, changes, created_at, order_id, orders!inner (id, client_name, order_type, quote_id, created_by)', { count: 'exact' })
            .eq('orders.quote_id', quote_id)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false })
            .range(0, Math.min(fetchLimit, 500) - 1),
          supabase.from('clients')
            .select('id, name, created_at', { count: 'exact' })
            .eq('created_by', quote_id)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false })
            .range(0, Math.min(fetchLimit, 100) - 1),
        ])

        const events = [
          ...(orderEvents || []).map(e => ({
            id: e.id, type: e.event_type, order_id: e.order_id,
            order_client: e.orders?.client_name, order_type: e.orders?.order_type,
            old_status: e.old_status, new_status: e.new_status,
            old_payment: e.old_payment_status, new_payment: e.new_payment_status,
            changes: e.changes, created_at: e.created_at, source: 'order',
          })),
          ...(clientEvents || []).map(c => ({
            id: c.id, type: 'client_created', client_name: c.name,
            created_at: c.created_at, source: 'client',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = (orderTotal || 0) + (clientTotal || 0)
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      // ═══════════════════════════════════════════════════════
      // PRODUCTION INTELLIGENCE
      // ═══════════════════════════════════════════════════════

      case 'production_overview': {
        result = await buildProductionDepartmentInsights(supabase, { date_from, date_to, compare_from, compare_to })
        break
      }

      case 'production_area_detail': {
        const { area_code } = body
        if (!area_code) return { status: 400, body: { error: 'area_code es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()
        const nowIso = new Date().toISOString()

        const [{ data: areaInfo }, { data: areaFiles }, { data: assignList }] = await Promise.all([
          supabase.from('production_areas').select('code, label, producer_role').eq('code', area_code).single(),
          supabase.from('order_production_files')
            .select('id, order_id, status, assigned_to, created_by, started_at, in_termination_at, completed_at, created_at')
            .eq('production_area_code', area_code)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_production_assignments')
            .select('order_id, assigned_to')
            .eq('production_area_code', area_code),
        ])

        const { data: profiles } = await supabase.from('profiles')
          .select('id, name').eq('role', areaInfo?.producer_role || 'admin')

        const files = areaFiles || []
        const assigns = assignList || []
        const orderIds = [...new Set(files.map(f => f.order_id).filter(Boolean))]
        const [{ data: orderRows }, { count: departmentFilesCount }] = await Promise.all([
          orderIds.length > 0
            ? supabase.from('orders').select('*').in('id', orderIds)
            : Promise.resolve({ data: [] }),
          supabase.from('order_production_files').select('id', { count: 'exact', head: true }).gte('created_at', from).lt('created_at', to),
        ])
        const orderMap = new Map((orderRows || []).map(order => [order.id, order]))
        const profileList = profiles || []
        const profileMap = {}
        profileList.forEach(p => { profileMap[p.id] = p.name })

        const userMetrics = []
        const userIds = new Set(assigns.map(a => a.assigned_to).filter(Boolean))
        files.forEach(f => {
          if (f.assigned_to) userIds.add(f.assigned_to)
          if (f.created_by) userIds.add(f.created_by)
        })

        const periodDays = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const totalEmployees = userIds.size || 1

        userIds.forEach(userId => {
          const userFiles = files.filter(f => f.assigned_to === userId || f.created_by === userId)
          const completed = userFiles.filter(f => f.status === 'completed')
          const times = completed
            .filter(f => f.started_at && f.completed_at)
            .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
          const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
          const reversions = userFiles.filter(f => f.status === 'in_production' && f.in_termination_at).length
          const currentLoad = userFiles.filter(f => ['in_production', 'in_termination', 'pending'].includes(f.status)).length
          const filesPerDay = periodDays > 0 ? +(completed.length / periodDays).toFixed(2) : 0
          const firstTimeRight = completed.length > 0 ? +(((completed.length - reversions) / completed.length) * 100).toFixed(1) : 100

          const efficiencyScore = Math.min(100, Math.round(
            (Math.min(filesPerDay * 20, 40)) +
            (Math.min(firstTimeRight * 0.3, 30)) +
            (Math.min(avgTime > 0 ? Math.max(0, 30 - avgTime * 3) : 15, 30))
          ))

          userMetrics.push({
            id: userId,
            name: profileMap[userId] || 'Desconocido',
            total_files: userFiles.length,
            completed: completed.length,
            in_production: userFiles.filter(f => f.status === 'in_production').length,
            in_termination: userFiles.filter(f => f.status === 'in_termination').length,
            pending: userFiles.filter(f => f.status === 'pending').length,
            avg_time_days: +avgTime.toFixed(1),
            reversions,
            reversion_rate: userFiles.length > 0 ? +((reversions / userFiles.length) * 100).toFixed(1) : 0,
            current_load: currentLoad,
            files_per_day: filesPerDay,
            first_time_right: firstTimeRight,
            efficiency_score: efficiencyScore,
          })
        })

        userMetrics.sort((a, b) => b.efficiency_score - a.efficiency_score || b.completed - a.completed)
        const topCompleted = userMetrics.length > 0 ? Math.max(userMetrics[0].completed, 1) : 1
        userMetrics.forEach((u, i) => {
          u.rank = i + 1
          u.pct = +((u.completed / topCompleted) * 100).toFixed(1)
          const prevUserTrend = userMetrics.find(p => p.id === u.id)
          if (prevUserTrend) {
            u.trend = u.efficiency_score >= 70 ? 'up' : u.efficiency_score >= 40 ? 'stable' : 'down'
          }
        })

        const bottlenecks = files
          .filter(f => f.status === 'in_production' && f.started_at)
          .map(f => {
            const days = (new Date() - new Date(f.started_at)) / 86400000
            return { file_id: f.id, order_id: f.order_id, days_in_stage: +days.toFixed(1) }
          })
          .filter(b => b.days_in_stage > 3)
          .sort((a, b) => b.days_in_stage - a.days_in_stage)

        const completedFiles = files.filter(f => f.status === 'completed')
        const pendingFiles = files.filter(f => f.status === 'pending')
        const inProductionFiles = files.filter(f => f.status === 'in_production')
        const inTerminationFiles = files.filter(f => f.status === 'in_termination')
        const completedTimes = completedFiles
          .filter(f => f.started_at && f.completed_at)
          .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
        const avgTime = completedTimes.length > 0 ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length : 0
        const reversions = files.filter(f => f.status === 'in_production' && f.in_termination_at).length

        const activeOrderIds = new Set(
          files
            .map(f => f.order_id)
            .filter(Boolean)
        )
        const total_orders = activeOrderIds.size
        const activeFiles = files.filter(f => ['pending', 'in_production', 'in_termination'].includes(f.status))

        const filesPerDay = periodDays > 0 ? +(files.length / periodDays).toFixed(2) : 0
        const filesPerHour = periodDays > 0 ? +((files.length / (periodDays * 24))).toFixed(3) : 0
        const avgResponseTime = (() => {
          const responseTimes = files
            .filter(f => f.started_at && f.created_at)
            .map(f => (new Date(f.started_at) - new Date(f.created_at)) / 3600000)
          return responseTimes.length > 0 ? +(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(1) : 0
        })()
        const slaCompliance = completedFiles.length > 0
          ? +((completedFiles.filter(f => f.started_at && f.completed_at).filter(f => {
            const cycleTime = (new Date(f.completed_at) - new Date(f.started_at)) / 86400000
            return cycleTime <= 7
          }).length / Math.max(completedFiles.filter(f => f.started_at && f.completed_at).length, 1)) * 100).toFixed(1)
          : 0
        const capacityUtilization = totalEmployees > 0
          ? +((files.length / Math.max(totalEmployees * 15, 1)) * 100).toFixed(1)
          : 0
        const firstTimeRight = completedFiles.length > 0
          ? +(((completedFiles.length - reversions) / completedFiles.length) * 100).toFixed(1)
          : 100

        const efficiencyMetrics = {
          files_per_day: filesPerDay,
          files_per_hour: filesPerHour,
          avg_response_time_hours: avgResponseTime,
          sla_compliance: slaCompliance,
          capacity_utilization: Math.min(100, capacityUtilization),
          first_time_right: firstTimeRight,
        }

        const loadDistribution = userMetrics.map(u => ({
          id: u.id,
          name: u.name,
          current_load: u.current_load,
          completed: u.completed,
          assigned_count: u.total_files,
          pending: u.pending,
          in_production: u.in_production,
          in_termination: u.in_termination,
          pct_of_total: files.length > 0 ? +((u.completed / Math.max(completedFiles.length, 1)) * 100).toFixed(1) : 0,
        }))

        const priorityBreakdown = files.reduce((acc, file) => {
          const order = orderMap.get(file.order_id)
          if (order?.order_type === 'orden 911') acc.urgent_911 += 1
          else acc.normal += 1
          acc.total += 1
          return acc
        }, { normal: 0, urgent_911: 0, total: 0, urgent_pct: 0 })
        priorityBreakdown.urgent_pct = priorityBreakdown.total > 0 ? +((priorityBreakdown.urgent_911 / priorityBreakdown.total) * 100).toFixed(1) : 0

        const agingBuckets = [
          { key: '0-1d', label: '0-1 dias', count: 0 },
          { key: '2-3d', label: '2-3 dias', count: 0 },
          { key: '4-7d', label: '4-7 dias', count: 0 },
          { key: '8d+', label: '8+ dias', count: 0 },
        ]
        activeFiles.forEach(file => {
          const age = daysBetween(getStageStart(file), nowIso) || 0
          if (age <= 1) agingBuckets[0].count += 1
          else if (age <= 3) agingBuckets[1].count += 1
          else if (age <= 7) agingBuckets[2].count += 1
          else agingBuckets[3].count += 1
        })

        const bottleneckBreakdownMap = {}
        bottlenecks.forEach(item => {
          const key = item.stage || 'sin_estado'
          if (!bottleneckBreakdownMap[key]) bottleneckBreakdownMap[key] = { key, label: key, count: 0, total_days: 0 }
          bottleneckBreakdownMap[key].count += 1
          bottleneckBreakdownMap[key].total_days += item.days_in_stage || 0
        })
        const bottleneckBreakdown = Object.values(bottleneckBreakdownMap).map(item => ({
          key: item.key,
          label: item.label,
          count: item.count,
          avg_days: item.count > 0 ? +(item.total_days / item.count).toFixed(1) : 0,
        }))

        const areaOrderRows = files
          .map(file => {
            const order = orderMap.get(file.order_id)
            if (!order) return null
            return {
              ...order,
              production_file_id: file.id,
              production_file_status: file.status,
              production_area_code: area_code,
              production_stage_days: +(daysBetween(getStageStart(file), nowIso) || 0).toFixed(1),
              assigned_to: file.assigned_to,
            }
          })
          .filter(Boolean)
          .sort((a, b) => (b.production_stage_days || 0) - (a.production_stage_days || 0))

        const operationalInsights = [
          priorityBreakdown.urgent_911 > 0 && {
            tone: 'warning',
            title: 'Carga 911 activa',
            detail: `${priorityBreakdown.urgent_911} archivo${priorityBreakdown.urgent_911 !== 1 ? 's' : ''} urgente${priorityBreakdown.urgent_911 !== 1 ? 's' : ''}, ${priorityBreakdown.urgent_pct}% del area.`,
          },
          bottlenecks.length > 0 && {
            tone: 'danger',
            title: 'Cuellos de botella detectados',
            detail: `${bottlenecks.length} archivo${bottlenecks.length !== 1 ? 's' : ''} con mas de 3 dias sin avanzar.`,
          },
          slaCompliance > 0 && slaCompliance < 80 && {
            tone: 'warning',
            title: 'SLA en riesgo',
            detail: `${slaCompliance}% de cumplimiento sobre archivos cerrados medibles.`,
          },
          activeFiles.length === 0 && {
            tone: 'stable',
            title: 'Sin carga activa',
            detail: 'El area no tiene archivos abiertos en este periodo.',
          },
          activeFiles.length > completedFiles.length && {
            tone: 'warning',
            title: 'Entrada mayor a salida',
            detail: `${activeFiles.length} archivos activos frente a ${completedFiles.length} completados.`,
          },
        ].filter(Boolean)

        const statusTimeBreakdown = [
          { key: 'completed', name: 'Completados', count: completedFiles.length, avg_days: completedTimes.length > 0 ? +(completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length).toFixed(1) : 0, color: '#10B981' },
          { key: 'in_production', name: 'En Produccion', count: inProductionFiles.length, avg_days: inProductionFiles.filter(f => f.started_at).length > 0 ? +(inProductionFiles.filter(f => f.started_at).reduce((sum, f) => sum + (new Date() - new Date(f.started_at)) / 86400000, 0) / inProductionFiles.filter(f => f.started_at).length).toFixed(1) : 0, color: '#F97316' },
          { key: 'in_termination', name: 'En Terminacion', count: inTerminationFiles.length, avg_days: inTerminationFiles.filter(f => f.started_at).length > 0 ? +(inTerminationFiles.filter(f => f.started_at).reduce((sum, f) => sum + (new Date() - new Date(f.started_at)) / 86400000, 0) / inTerminationFiles.filter(f => f.started_at).length).toFixed(1) : 0, color: '#0EA5E9' },
        ].filter(s => s.count > 0)

        const dailyMap = {}
        files.forEach(f => {
          const day = (f.completed_at || f.created_at || '').slice(0, 10)
          if (!day) return
          if (!dailyMap[day]) dailyMap[day] = { total: 0, completed: 0, in_production: 0, in_termination: 0, pending: 0 }
          dailyMap[day].total++
          if (f.status === 'completed') dailyMap[day].completed++
          if (f.status === 'in_production') dailyMap[day].in_production++
          if (f.status === 'in_termination') dailyMap[day].in_termination++
          if (f.status === 'pending') dailyMap[day].pending++
        })
        const trend = Object.entries(dailyMap).map(([date, values]) => ({ date, ...values })).sort((a, b) => a.date.localeCompare(b.date))

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevFiles } = await supabase.from('order_production_files')
            .select('id, status, started_at, in_termination_at, completed_at, created_at')
            .eq('production_area_code', area_code)
            .gte('created_at', compare_from).lt('created_at', compare_to)
          const prev = prevFiles || []
          const prevCompleted = prev.filter(f => f.status === 'completed')
          const prevTimes = prevCompleted
            .filter(f => f.started_at && f.completed_at)
            .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
          const prevAvgTime = prevTimes.length > 0 ? prevTimes.reduce((a, b) => a + b, 0) / prevTimes.length : 0
          const prevReversions = prev.filter(f => f.status === 'in_production' && f.in_termination_at).length
          const safePct = (curr, prevValue) => prevValue === 0 ? (curr > 0 ? 100 : 0) : ((curr - prevValue) / prevValue) * 100
          cmp = {
            total_files: { prev: prev.length, curr: files.length, change_pct: +safePct(files.length, prev.length).toFixed(1) },
            completed: { prev: prevCompleted.length, curr: completedFiles.length, change_pct: +safePct(completedFiles.length, prevCompleted.length).toFixed(1) },
            avg_time_days: { prev: +prevAvgTime.toFixed(1), curr: +avgTime.toFixed(1), change_pct: +safePct(avgTime, prevAvgTime).toFixed(1) },
            reversions: { prev: prevReversions, curr: reversions, change_pct: +safePct(reversions, prevReversions).toFixed(1) },
          }
        }

        result = {
          area: areaInfo || { code: area_code, label: area_code },
          total_files: files.length,
          total_orders,
          completed: completedFiles.length,
          pending: pendingFiles.length,
          in_production: inProductionFiles.length,
          in_termination: inTerminationFiles.length,
          completion_rate: files.length > 0 ? +((completedFiles.length / files.length) * 100).toFixed(1) : 0,
          avg_time_days: +avgTime.toFixed(1),
          reversions,
          reversion_rate: files.length > 0 ? +((reversions / files.length) * 100).toFixed(1) : 0,
          efficiency_metrics: efficiencyMetrics,
          load_distribution: loadDistribution,
          capacity_distribution: loadDistribution,
          total_employees: totalEmployees,
          orders: areaOrderRows,
          priority_breakdown: priorityBreakdown,
          aging_buckets: agingBuckets,
          sla_metrics: {
            target_days: 7,
            compliance_pct: slaCompliance,
            delayed_count: bottlenecks.length,
            avg_response_time_hours: avgResponseTime,
            avg_cycle_time_days: +avgTime.toFixed(1),
          },
          bottleneck_breakdown: bottleneckBreakdown,
          area_participation: {
            area_files: files.length,
            department_files: departmentFilesCount || 0,
            pct: departmentFilesCount > 0 ? +((files.length / departmentFilesCount) * 100).toFixed(1) : 0,
          },
          operational_insights: operationalInsights,
          status_breakdown: [
            { key: 'pending', name: 'Pendiente', value: pendingFiles.length, color: '#F59E0B' },
            { key: 'in_production', name: 'En Produccion', value: inProductionFiles.length, color: '#F97316' },
            { key: 'in_termination', name: 'En Terminacion', value: inTerminationFiles.length, color: '#0EA5E9' },
            { key: 'completed', name: 'Completado', value: completedFiles.length, color: '#10B981' },
          ],
          status_time_breakdown: statusTimeBreakdown,
          trend,
          comparison: cmp,
          users: userMetrics,
          bottlenecks,
        }
        break
      }

      case 'production_employee_detail': {
        const { employee_id, area_code: empAreaCode = null } = body
        if (!employee_id) return { status: 400, body: { error: 'employee_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: profileData }, { data: empFiles }] = await Promise.all([
          supabase.from('profiles').select('id, name, role').eq('id', employee_id).maybeSingle(),
          supabase.from('order_production_files')
            .select('id, order_id, production_area_code, status, started_at, in_termination_at, completed_at, created_at')
            .or(`assigned_to.eq.${employee_id},created_by.eq.${employee_id}`)
            .gte('created_at', from).lt('created_at', to),
        ])
        const profile = profileData

        const files = empFiles || []
        const completed = files.filter(f => f.status === 'completed')
        const times = completed
          .filter(f => f.started_at && f.completed_at)
          .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
        const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
        const reversions = files.filter(f => f.status === 'in_production' && f.in_termination_at).length
        const reversionRate = files.length > 0 ? +((reversions / files.length) * 100).toFixed(1) : 0

        const filesByArea = {}
        files.forEach(f => {
          const area = f.production_area_code || 'unknown'
          if (!filesByArea[area]) filesByArea[area] = { total: 0, completed: 0, in_production: 0, in_termination: 0 }
          filesByArea[area].total++
          if (f.status === 'completed') filesByArea[area].completed++
          if (f.status === 'in_production') filesByArea[area].in_production++
          if (f.status === 'in_termination') filesByArea[area].in_termination++
        })

        const dailyMap = {}
        files.forEach(f => {
          const day = f.created_at.slice(0, 10)
          if (!dailyMap[day]) dailyMap[day] = { total: 0, completed: 0 }
          dailyMap[day].total++
          if (f.status === 'completed') dailyMap[day].completed++
        })
        const trend = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date))

        let activityDays = 0
        let periodDaysCalc = 1
        let consistency = 0
        let efficiencyVsArea = null
        let lastActivityDate = null
        let daysSinceLastActivity = null
        let comparison = null
        let vsDepartment = null
        const insights = []
        const recommendations = []

        try {
          activityDays = Object.keys(dailyMap).length
          const diff = (new Date(to) - new Date(from)) / 86400000
          periodDaysCalc = Math.max(1, Math.ceil(diff))
          const dailyCompletions = trend.map(d => d.completed)
          const avgDaily = dailyCompletions.length > 0 ? dailyCompletions.reduce((a, b) => a + b, 0) / dailyCompletions.length : 0
          const variance = dailyCompletions.length > 1
            ? dailyCompletions.reduce((sum, v) => sum + Math.pow(v - avgDaily, 2), 0) / dailyCompletions.length
            : 0
          consistency = avgDaily > 0 ? Math.max(0, +((1 - Math.sqrt(variance) / Math.max(avgDaily, 0.1)) * 100).toFixed(0)) : 0

          lastActivityDate = trend.length > 0 ? trend[trend.length - 1].date : null
          daysSinceLastActivity = lastActivityDate
            ? Math.floor((new Date(to) - new Date(lastActivityDate)) / 86400000)
            : null

          if (empAreaCode && avgTime > 0) {
            const roleMap = { digital: 'digital_producer', dtf: 'dtf_producer', ploteo: 'ploteo_producer' }
            const role = roleMap[empAreaCode]
            if (role) {
              const { data: areaFiles } = await supabase.from('order_production_files')
                .select('id, status, started_at, completed_at')
                .eq('production_area_code', empAreaCode)
                .gte('created_at', from).lt('created_at', to)
              const areaDone = (areaFiles || []).filter(f => f.status === 'completed' && f.started_at && f.completed_at)
              if (areaDone.length > 0) {
                const areaTimes = areaDone.map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
                const areaAvg = areaTimes.reduce((a, b) => a + b, 0) / areaTimes.length
                efficiencyVsArea = areaAvg > 0 ? +((areaAvg / Math.max(avgTime, 0.1) - 1) * 100).toFixed(1) : 0
              }
            }
          }

          if (compare_from && compare_to) {
            const { data: prevFiles } = await supabase.from('order_production_files')
              .select('id, status, started_at, in_termination_at, completed_at')
              .or(`assigned_to.eq.${employee_id},created_by.eq.${employee_id}`)
              .gte('created_at', compare_from).lt('created_at', compare_to)
            const prev = prevFiles || []
            const prevDone = prev.filter(f => f.status === 'completed')
            const prevT = prevDone.filter(f => f.started_at && f.completed_at).map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
            const prevAvg = prevT.length > 0 ? prevT.reduce((a, b) => a + b, 0) / prevT.length : 0
            const prevRev = prev.filter(f => f.status === 'in_production' && f.in_termination_at).length
            const safePct = (c, p) => p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100
            comparison = {
              total_files: { prev: prev.length, curr: files.length, change_pct: +safePct(files.length, prev.length).toFixed(1) },
              completed: { prev: prevDone.length, curr: completed.length, change_pct: +safePct(completed.length, prevDone.length).toFixed(1) },
              avg_time_days: { prev: +prevAvg.toFixed(1), curr: +avgTime.toFixed(1), change_pct: +safePct(avgTime, prevAvg).toFixed(1) },
              reversions: { prev: prevRev, curr: reversions, change_pct: +safePct(reversions, prevRev).toFixed(1) },
            }
          }

          if (empAreaCode) {
            const roleMap2 = { digital: 'digital_producer', dtf: 'dtf_producer', ploteo: 'ploteo_producer' }
            const role2 = roleMap2[empAreaCode]
            if (role2) {
              const [{ count: areaTotal }, { count: empCount }] = await Promise.all([
                supabase.from('order_production_files').select('id', { count: 'exact', head: true }).eq('production_area_code', empAreaCode).gte('created_at', from).lt('created_at', to),
                supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', role2),
              ])
              const ec = empCount || 1
              const at = areaTotal || 0
              const avg = at / ec
              vsDepartment = {
                total_files: +((files.length / Math.max(avg, 1) - 1) * 100).toFixed(1),
                avg_per_employee: +avg.toFixed(1),
                total_employees: ec,
              }
            }
          }

          const cr = files.length > 0 ? +((completed.length / files.length) * 100).toFixed(0) : 0
          if (files.length > 0 && completed.length > 0) insights.push(`Completo ${completed.length} de ${files.length} archivos (${cr}% de finalizacion).`)
          if (efficiencyVsArea !== null) {
            const dir = efficiencyVsArea >= 0 ? 'mas rapido' : 'mas lento'
            insights.push(`Su tiempo promedio es ${Math.abs(efficiencyVsArea).toFixed(0)}% ${dir} que el promedio del area.`)
          }
          if (consistency >= 80) insights.push('Mantiene una productividad constante durante el periodo.')
          else if (consistency < 50 && trend.length > 3) insights.push('Su productividad es irregular con fluctuaciones significativas.')
          if (comparison) {
            if (comparison.completed.change_pct > 10) insights.push(`Completó ${comparison.completed.change_pct.toFixed(0)}% mas archivos que el periodo anterior.`)
            else if (comparison.completed.change_pct < -10) insights.push(`Completó ${Math.abs(comparison.completed.change_pct).toFixed(0)}% menos archivos que el periodo anterior.`)
          }

          const activeLoad = files.filter(f => ['pending', 'in_production', 'in_termination'].includes(f.status)).length
          if (cr < 50 && files.length > 3) recommendations.push({ type: 'attention', text: 'Revisar asignacion de carga — posible sobrecarga o dificultad con el flujo de trabajo.' })
          if (avgTime > 0 && efficiencyVsArea !== null && efficiencyVsArea < -20) recommendations.push({ type: 'training', text: 'Considerar capacitacion en flujo de trabajo — su tiempo promedio es significativamente mayor al del area.' })
          if (reversionRate > 15) recommendations.push({ type: 'quality', text: 'Revisar calidad del trabajo — tasa de reversiones elevada requiere atencion.' })
          if (daysSinceLastActivity !== null && daysSinceLastActivity > 5) recommendations.push({ type: 'availability', text: 'Verificar disponibilidad — sin actividad registrada en varios dias.' })
          if (cr >= 85 && avgTime > 0 && efficiencyVsArea !== null && efficiencyVsArea > 20) recommendations.push({ type: 'recognition', text: 'Candidato para reconocimiento o asignacion de tareas mas complejas.' })
          if (activeLoad > 10) recommendations.push({ type: 'balance', text: `${activeLoad} archivos activos — considerar redistribuir carga de trabajo.` })
        } catch (computeErr) {
          console.error('production_employee_detail compute error:', computeErr)
        }

        const alerts = []
        const pendingCount = files.filter(f => f.status === 'pending').length
        const inProductionCount = files.filter(f => f.status === 'in_production').length
        if (pendingCount > 5) alerts.push({ type: 'pending_files', title: 'Archivos sin iniciar', message: `${pendingCount} archivos pendientes`, severity: 'warning' })
        if (reversionRate > 15) alerts.push({ type: 'high_reversions', title: 'Alta tasa de reversiones', message: `${reversionRate}% de reversiones`, severity: 'critical' })
        if (avgTime > 7) alerts.push({ type: 'slow_processing', title: 'Tiempo promedio elevado', message: `${avgTime.toFixed(1)}d promedio de ciclo`, severity: 'warning' })
        if (inProductionCount > 10) alerts.push({ type: 'overload', title: 'Sobrecarga de trabajo', message: `${inProductionCount} archivos en produccion`, severity: 'warning' })
        if (daysSinceLastActivity !== null && daysSinceLastActivity > 3) alerts.push({ type: 'inactive', title: 'Inactividad prolongada', message: `Ultima actividad hace ${daysSinceLastActivity} dias`, severity: 'critical' })

        result = {
          profile: profile || { id: employee_id, name: 'Desconocido' },
          total_files: files.length,
          completed: completed.length,
          in_production: files.filter(f => f.status === 'in_production').length,
          in_termination: files.filter(f => f.status === 'in_termination').length,
          pending: files.filter(f => f.status === 'pending').length,
          avg_time_days: +avgTime.toFixed(1),
          reversions,
          reversion_rate: reversionRate,
          files_by_area: filesByArea,
          trend,
          activity_days: activityDays,
          period_days: periodDaysCalc,
          consistency,
          efficiency_vs_area: efficiencyVsArea,
          last_activity_date: lastActivityDate,
          days_since_last_activity: daysSinceLastActivity,
          comparison,
          vs_department: vsDepartment,
          alerts,
          insights,
          recommendations,
        }
        break
      }

      case 'production_employee_ranking': {
        const { area_code: rankAreaCode = null } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: allProfiles }, { data: files }, { data: assigns }] = await Promise.all([
          supabase.from('profiles').select('id, name, role').in('role', ['digital_producer', 'dtf_producer', 'ploteo_producer']),
          (() => {
            let q = supabase.from('order_production_files')
              .select('id, production_area_code, status, assigned_to, created_by, started_at, completed_at, in_termination_at, created_at')
              .gte('created_at', from).lt('created_at', to)
            if (rankAreaCode) q = q.eq('production_area_code', rankAreaCode)
            return q
          })(),
          (() => {
            let q = supabase.from('order_production_assignments').select('order_id, production_area_code, assigned_to')
            if (rankAreaCode) q = q.eq('production_area_code', rankAreaCode)
            return q
          })(),
        ])

        const profileMap = {}
        ;(allProfiles || []).forEach(p => { profileMap[p.id] = { name: p.name, role: p.role } })

        const empMap = {}
        ;(assigns || []).forEach(a => {
          if (!empMap[a.assigned_to]) empMap[a.assigned_to] = { area: a.production_area_code }
        })
        ;(files || []).forEach(f => {
          const uid = f.assigned_to || f.created_by
          if (uid && !empMap[uid]) empMap[uid] = { area: f.production_area_code }
        })

        const ranking = Object.keys(empMap).map(userId => {
          const userFiles = (files || []).filter(f => (f.assigned_to === userId || f.created_by === userId))
          const completed = userFiles.filter(f => f.status === 'completed')
          const times = completed
            .filter(f => f.started_at && f.completed_at)
            .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
          const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
          const reversions = userFiles.filter(f => f.status === 'in_production' && f.in_termination_at).length

          return {
            id: userId,
            name: profileMap[userId]?.name || 'Desconocido',
            area: empMap[userId]?.area || 'N/A',
            total_files: userFiles.length,
            completed: completed.length,
            avg_time_days: +avgTime.toFixed(1),
            reversions,
            reversion_rate: userFiles.length > 0 ? +((reversions / userFiles.length) * 100).toFixed(1) : 0,
            in_production: userFiles.filter(f => f.status === 'in_production').length,
          }
        }).filter(u => u.total_files > 0)

        ranking.sort((a, b) => b.completed - a.completed)
        ranking.forEach((u, i) => {
          u.rank = i + 1
          u.pct = ranking.length > 0 ? +((u.completed / Math.max(ranking[0].completed, 1)) * 100).toFixed(1) : 0
        })

        result = { users: ranking, total_users: ranking.length }
        break
      }

      case 'production_employee_activity': {
        const { employee_id: actEmpId } = body
        if (!actEmpId) return { status: 400, body: { error: 'employee_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()
        const offset = parseInt(body.offset || '0', 10)
        const limit = parseInt(body.limit || '20', 10)

        const [{ data: orderEvents }, { data: orderTotal }, { data: fileEvents }, { data: fileTotal }] = await Promise.all([
          supabase.from('order_events')
            .select('id, order_id, event_type, old_status, new_status, changes, created_at, actor_id')
            .eq('actor_id', actEmpId)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('order_events')
            .select('id', { count: 'exact', head: true })
            .eq('actor_id', actEmpId)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_production_files')
            .select('id, order_id, status, production_area_code, created_at')
            .or(`assigned_to.eq.${actEmpId},created_by.eq.${actEmpId}`)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('order_production_files')
            .select('id', { count: 'exact', head: true })
            .or(`assigned_to.eq.${actEmpId},created_by.eq.${actEmpId}`)
            .gte('created_at', from).lt('created_at', to),
        ])

        const events = [
          ...(orderEvents || []).map(e => {
            const detail = e.changes?.reason_detail
              ? `${e.old_status || '—'} → ${e.new_status || '—'} (${e.changes.reason_detail})`
              : `${e.old_status || '—'} → ${e.new_status || '—'}`
            return { id: e.id, type: 'status_change', order_id: e.order_id, detail, created_at: e.created_at, source: 'order' }
          }),
          ...(fileEvents || []).map(f => ({
            id: f.id, type: 'file_update', order_id: f.order_id,
            detail: `Archivo ${f.status} (${f.production_area_code || 'N/A'})`,
            created_at: f.created_at, source: 'file',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = (orderTotal || 0) + (fileTotal || 0)
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      case 'production_daily_trend': {
        const { area_code: trendAreaCode = null } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        let q = supabase.from('order_production_files')
          .select('production_area_code, status, completed_at, created_at')
          .gte('created_at', from).lt('created_at', to)
        if (trendAreaCode) q = q.eq('production_area_code', trendAreaCode)

        const { data: files } = await q
        const dailyMap = {}
        ;(files || []).forEach(f => {
          const day = (f.completed_at || f.created_at).slice(0, 10)
          const area = f.production_area_code || 'unknown'
          if (!dailyMap[day]) dailyMap[day] = {}
          if (trendAreaCode) {
            if (!dailyMap[day].total) dailyMap[day].total = 0
            if (!dailyMap[day].completed) dailyMap[day].completed = 0
            if (!dailyMap[day].in_production) dailyMap[day].in_production = 0
            if (!dailyMap[day].in_termination) dailyMap[day].in_termination = 0
            if (!dailyMap[day].pending) dailyMap[day].pending = 0
            dailyMap[day].total++
            if (f.status === 'completed') dailyMap[day].completed++
            if (f.status === 'in_production') dailyMap[day].in_production++
            if (f.status === 'in_termination') dailyMap[day].in_termination++
            if (f.status === 'pending') dailyMap[day].pending++
          } else {
            dailyMap[day][area] = (dailyMap[day][area] || 0) + 1
          }
        })
        const trend = Object.entries(dailyMap).map(([date, areas]) => ({ date, ...areas })).sort((a, b) => a.date.localeCompare(b.date))

        result = { trend }
        break
      }

      // ═══════════════════════════════════════════════════════
      // ADMIN EMPLOYEE PRODUCTION METRICS
      // ═══════════════════════════════════════════════════════

      case 'admin_employee_production_metrics': {
        const { employee_id: empId } = body
        if (!empId) return { status: 400, body: { error: 'employee_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: empProfile }, { data: empFiles }] = await Promise.all([
          supabase.from('profiles').select('id, name, role, created_at').eq('id', empId).single(),
          supabase.from('order_production_files')
            .select('id, order_id, production_area_code, status, started_at, in_termination_at, completed_at, created_at')
            .or(`assigned_to.eq.${empId},created_by.eq.${empId}`)
            .gte('created_at', from).lt('created_at', to),
        ])

        const files = empFiles || []
        const completed = files.filter(f => f.status === 'completed')
        const inProduction = files.filter(f => f.status === 'in_production')
        const inTermination = files.filter(f => f.status === 'in_termination')
        const pending = files.filter(f => f.status === 'pending')
        const reversions = files.filter(f => f.status === 'in_production' && f.in_termination_at).length

        const completedTimes = completed
          .filter(f => f.started_at && f.completed_at)
          .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
        const avgTime = completedTimes.length > 0 ? +(completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length).toFixed(1) : 0

        const periodDays = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const filesPerDay = +(completed.length / periodDays).toFixed(2)
        const firstTimeRight = completed.length > 0
          ? +(((completed.length - reversions) / completed.length) * 100).toFixed(1)
          : 100

        const efficiencyScore = Math.min(100, Math.round(
          (Math.min(filesPerDay * 20, 40)) +
          (Math.min(firstTimeRight * 0.3, 30)) +
          (Math.min(avgTime > 0 ? Math.max(0, 30 - avgTime * 3) : 15, 30))
        ))

        const filesByArea = {}
        files.forEach(f => {
          const area = f.production_area_code || 'unknown'
          if (!filesByArea[area]) filesByArea[area] = { total: 0, completed: 0, in_production: 0, in_termination: 0, pending: 0 }
          filesByArea[area].total++
          if (f.status === 'completed') filesByArea[area].completed++
          if (f.status === 'in_production') filesByArea[area].in_production++
          if (f.status === 'in_termination') filesByArea[area].in_termination++
          if (f.status === 'pending') filesByArea[area].pending++
        })

        const dailyMap = {}
        files.forEach(f => {
          const day = f.created_at.slice(0, 10)
          if (!dailyMap[day]) dailyMap[day] = { total: 0, completed: 0 }
          dailyMap[day].total++
          if (f.status === 'completed') dailyMap[day].completed++
        })
        const trend = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date))

        const lastActivityDate = trend.length > 0 ? trend[trend.length - 1].date : null
        const daysSinceLastActivity = lastActivityDate
          ? Math.floor((new Date(to) - new Date(lastActivityDate)) / 86400000)
          : null

        const alerts = []
        if (pending.length > 5) alerts.push({ type: 'pending_files', title: 'Archivos sin iniciar', message: `${pending.length} archivos pendientes`, severity: 'warning' })
        const reversionRate = files.length > 0 ? +((reversions / files.length) * 100).toFixed(1) : 0
        if (reversionRate > 15) alerts.push({ type: 'high_reversions', title: 'Alta tasa de reversiones', message: `${reversionRate}% de reversiones`, severity: 'critical' })
        if (avgTime > 7) alerts.push({ type: 'slow_processing', title: 'Tiempo promedio elevado', message: `${avgTime}d promedio de ciclo`, severity: 'warning' })
        if (inProduction.length > 10) alerts.push({ type: 'overload', title: 'Sobrecarga de trabajo', message: `${inProduction.length} archivos en produccion`, severity: 'warning' })
        if (daysSinceLastActivity !== null && daysSinceLastActivity > 3) alerts.push({ type: 'inactive', title: 'Inactividad prolongada', message: `Ultima actividad hace ${daysSinceLastActivity} dias`, severity: 'critical' })

        result = {
          profile: empProfile || { id: empId, name: 'Desconocido' },
          total_files: files.length,
          completed: completed.length,
          in_production: inProduction.length,
          in_termination: inTermination.length,
          pending: pending.length,
          avg_time_days: avgTime,
          reversions,
          reversion_rate: reversionRate,
          files_per_day: filesPerDay,
          first_time_right: firstTimeRight,
          efficiency_score: efficiencyScore,
          files_by_area: filesByArea,
          trend,
          last_activity_date: lastActivityDate,
          days_since_last_activity: daysSinceLastActivity,
          alerts,
        }
        break
      }

      // ═══════════════════════════════════════════════════════
      // DELIVERY INTELLIGENCE
      // ═══════════════════════════════════════════════════════

      case 'delivery_metrics': {
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: deliveryUsers }, { data: orders }, { data: events }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('role', 'delivery').eq('employment_status', true),
          supabase.from('orders')
            .select('id, delivery_id, status, delivery_date, completed_at, created_at, payment_status, client_name')
            .not('delivery_id', 'is', null)
            .in('status', ['in_Completed', 'in_Delivered', 'in_Termination'])
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_events')
            .select('order_id, old_status, new_status, created_at')
            .in('new_status', ['in_Delivered', 'in_Completed']),
        ])

        const userList = deliveryUsers || []
        const ords = orders || []
        const evts = events || []

        const users = userList.map(user => {
          const userOrds = ords.filter(o => o.delivery_id === user.id)
          const delivered = userOrds.filter(o => o.status === 'in_Delivered')

          const onTime = delivered.filter(o => {
            if (!o.delivery_date || !o.completed_at) return false
            return new Date(o.completed_at) <= new Date(o.delivery_date)
          }).length

          const deliveryTimes = delivered.map(o => {
            const deliverEvent = evts.find(e => e.order_id === o.id && e.new_status === 'in_Delivered')
            if (deliverEvent && o.completed_at) {
              return (new Date(deliverEvent.created_at) - new Date(o.completed_at)) / 86400000
            }
            return null
          }).filter(t => t !== null)

          const avgDeliveryTime = deliveryTimes.length > 0
            ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length : 0

          const pending = userOrds.filter(o => o.status === 'in_Completed' || o.status === 'in_Termination')

          return {
            id: user.id,
            name: user.name,
            total_delivered: delivered.length,
            on_time: onTime,
            on_time_rate: delivered.length > 0 ? +((onTime / delivered.length) * 100).toFixed(1) : 0,
            avg_delivery_time_days: +avgDeliveryTime.toFixed(1),
            pending_deliveries: pending.length,
            orders_total: userOrds.length,
            pct_of_total: ords.length > 0 ? +((delivered.length / ords.length) * 100).toFixed(1) : 0,
          }
        })

        users.sort((a, b) => b.total_delivered - a.total_delivered)
        users.forEach((u, i) => { u.rank = i + 1 })

        const totalDelivered = ords.filter(o => o.status === 'in_Delivered').length
        const totalPending = ords.filter(o => o.status === 'in_Completed' || o.status === 'in_Termination').length

        const dailyMap = {}
        ords.filter(o => o.status === 'in_Delivered').forEach(o => {
          const evt = evts.find(e => e.order_id === o.id && e.new_status === 'in_Delivered')
          if (evt) {
            const day = evt.created_at.slice(0, 10)
            dailyMap[day] = (dailyMap[day] || 0) + 1
          }
        })
        const trend = Object.entries(dailyMap).map(([date, count]) => ({ date, delivered: count })).sort((a, b) => a.date.localeCompare(b.date))

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrds } = await supabase.from('orders')
            .select('id, delivery_id, status, completed_at, delivery_date')
            .not('delivery_id', 'is', null)
            .in('status', ['in_Delivered'])
            .gte('created_at', compare_from).lt('created_at', compare_to)
          const prev = prevOrds || []
          const prevDelivered = prev.length
          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total_delivered: { prev: prevDelivered, curr: totalDelivered, change_pct: safePct(totalDelivered, prevDelivered) },
          }
        }

        result = { users, trend, total_delivered: totalDelivered, total_pending: totalPending, comparison: cmp }
        break
      }

      case 'delivery_detail': {
        const { delivery_user_id } = body
        if (!delivery_user_id) return { status: 400, body: { error: 'delivery_user_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: profile }, { data: orders }, { count: totalAll }, { count: deliveryCount }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', delivery_user_id).single(),
          supabase.from('orders')
            .select('id, status, delivery_date, completed_at, created_at, payment_status, client_name, material, order_type')
            .eq('delivery_id', delivery_user_id)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('orders').select('id', { count: 'exact', head: true })
            .not('delivery_id', 'is', null)
            .in('status', ['in_Delivered', 'in_Completed', 'in_Termination'])
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'delivery'),
        ])

        const orderIds = (orders || []).map(o => o.id)
        const { data: events } = orderIds.length > 0
          ? await supabase.from('order_events')
              .select('order_id, old_status, new_status, created_at')
              .in('order_id', orderIds)
              .in('new_status', ['in_Delivered', 'in_Completed'])
          : { data: [] }

        const ords = orders || []
        const evts = events || []
        const total = ords.length
        const delivered = ords.filter(o => o.status === 'in_Delivered')
        const pending = ords.filter(o => o.status === 'in_Completed' || o.status === 'in_Termination')

        const onTime = delivered.filter(o => {
          if (!o.delivery_date || !o.completed_at) return false
          return new Date(o.completed_at) <= new Date(o.delivery_date)
        }).length

        const deliveryTimes = delivered.map(o => {
          const evt = evts.find(e => e.order_id === o.id && e.new_status === 'in_Delivered')
          if (evt && o.completed_at) return (new Date(evt.created_at) - new Date(o.completed_at)) / 86400000
          return null
        }).filter(t => t !== null)
        const avgDeliveryTime = deliveryTimes.length > 0
          ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length : 0

        const paymentPaid = ords.filter(o => o.payment_status === 'pagado').length
        const paymentPartial = ords.filter(o => o.payment_status === 'parcial').length
        const paymentCredit = ords.filter(o => o.payment_status === 'credito').length
        const paymentPending = ords.filter(o => o.payment_status === 'Pending_Payment').length

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrds } = await supabase.from('orders')
            .select('id, status, completed_at, delivery_date')
            .eq('delivery_id', delivery_user_id)
            .gte('created_at', compare_from).lt('created_at', compare_to)
          const prev = prevOrds || []
          const prevDelivered = prev.filter(o => o.status === 'in_Delivered').length
          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            delivered: { prev: prevDelivered, curr: delivered.length, change_pct: safePct(delivered.length, prevDelivered) },
          }
        }

        const vsTeam = {
          orders_vs_avg: totalAll > 0 && (deliveryCount || 1) > 0
            ? +((total / (totalAll / (deliveryCount || 1)) - 1) * 100).toFixed(1) : 0,
        }

        result = {
          profile: profile || { id: delivery_user_id, name: 'Desconocido' },
          orders: { total, delivered: delivered.length, pending: pending.length, on_time: onTime },
          rates: {
            on_time_rate: delivered.length > 0 ? +((onTime / delivered.length) * 100).toFixed(1) : 0,
            avg_delivery_time_days: +avgDeliveryTime.toFixed(1),
          },
          payment: { paid: paymentPaid, partial: paymentPartial, credit: paymentCredit, pending: paymentPending },
          vs_team: vsTeam,
          comparison: cmp,
        }
        break
      }

      case 'delivery_profile': {
        const { delivery_user_id: profUserId } = body
        if (!profUserId) return { status: 400, body: { error: 'delivery_user_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: ords } = await supabase.from('orders')
          .select('id, client_name, material, status, created_at, completed_at, delivery_date')
          .eq('delivery_id', profUserId)
          .gte('created_at', from).lt('created_at', to)

        const orderList = ords || []

        const clientCount = {}
        orderList.forEach(o => {
          if (!o.client_name) return
          if (!clientCount[o.client_name]) clientCount[o.client_name] = { total: 0, delivered: 0 }
          clientCount[o.client_name].total++
          if (o.status === 'in_Delivered') clientCount[o.client_name].delivered++
        })
        const topClients = Object.entries(clientCount)
          .map(([client_name, data]) => ({ client_name, total_orders: data.total, delivered_orders: data.delivered }))
          .sort((a, b) => b.total_orders - a.total_orders).slice(0, 10)

        const materialCount = {}
        orderList.forEach(o => { if (o.material) materialCount[o.material] = (materialCount[o.material] || 0) + 1 })
        const materials = Object.entries(materialCount)
          .map(([name, count]) => ({ name, count, pct: orderList.length > 0 ? +((count / orderList.length) * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count).slice(0, 10)

        const daysSpan = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const orderFrequency = {
          per_day: +(orderList.length / daysSpan).toFixed(1),
          per_week: +((orderList.length / daysSpan) * 7).toFixed(1),
          per_month: +((orderList.length / daysSpan) * 30).toFixed(1),
        }

        let daysSinceLast = null
        const sortedDates = orderList.map(o => new Date(o.created_at)).sort((a, b) => b - a)
        if (sortedDates.length > 0) {
          daysSinceLast = Math.floor((new Date() - sortedDates[0]) / 86400000)
        }

        result = {
          top_clients: topClients,
          materials,
          order_frequency: orderFrequency,
          days_since_last_order: daysSinceLast,
          total_orders: orderList.length,
        }
        break
      }

      case 'delivery_daily_trend': {
        const { delivery_user_id: trendDeliveryUserId = null } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        let q = supabase.from('orders')
          .select('id, status, delivery_id, created_at')
          .not('delivery_id', 'is', null)
          .in('status', ['in_Delivered', 'in_Completed', 'in_Termination'])
          .gte('created_at', from).lt('created_at', to)
        if (trendDeliveryUserId) q = q.eq('delivery_id', trendDeliveryUserId)
        const { data: ords } = await q

        const dailyMap = {}
        ;(ords || []).forEach(o => {
          const day = o.created_at.slice(0, 10)
          if (!dailyMap[day]) dailyMap[day] = { delivered: 0, pending: 0 }
          if (o.status === 'in_Delivered') dailyMap[day].delivered++
          else dailyMap[day].pending++
        })

        const trend = Object.entries(dailyMap)
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date))

        result = { trend }
        break
      }

      case 'all': {
        const now = new Date()
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

        const [bs, oa, ca, ui, pi, sa, ot, sv, empCount, empCountAll, clientCount, credito, parcial, pendingPayment, pendingAged, materialsResult] = await Promise.all([
          supabase.rpc('kpi_business_summary', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_orders_analytics', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_client_analytics', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_user_analytics', { p_date_from: date_from, p_date_to: date_to }),
          buildProductionDepartmentInsights(supabase, { date_from, date_to, compare_from, compare_to })
            .then(data => ({ data, error: null }))
            .catch(error => ({ data: null, error })),
          supabase.rpc('kpi_smart_alerts'),
          supabase.rpc('kpi_orders_trend', { p_days: 30 }),
          supabase.rpc('kpi_sla_violations'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('role', 'admin').eq('employment_status', true),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('role', 'admin'),
          supabase.from('clients').select('id', { count: 'exact', head: true }),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'credito').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'parcial').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'Pending_Payment').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id, created_at').not('status', 'in', '(cancelled,in_completed,in_delivered)').gte('created_at', threeDaysAgo.toISOString()),
          (() => {
            let q = supabase.from('orders').select('material, created_at').not('material', 'is', null)
            if (date_from) q = q.gte('created_at', date_from)
            if (date_to) q = q.lt('created_at', date_to)
            return q.then(({ data }) => {
              const counts = {}
              ;(data || []).forEach(o => {
                const raw = o.material || 'Sin material'
                const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
                if (parts.length === 0) {
                  counts['Sin material'] = (counts['Sin material'] || 0) + 1
                } else {
                  parts.forEach(m => {
                    counts[m] = (counts[m] || 0) + 1
                  })
                }
              })
              return { data: Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3) }
            })
          })(),
        ])

        if (bs.error) console.error('kpi_business_summary:', bs.error.message)
        if (oa.error) console.error('kpi_orders_analytics:', oa.error.message)
        if (ca.error) console.error('kpi_client_analytics:', ca.error.message)
        if (ui.error) console.error('kpi_user_analytics:', ui.error.message)
        if (pi.error) console.error('kpi_production_insights:', pi.error.message)
        if (sa.error) console.error('kpi_smart_alerts:', sa.error.message)
        if (ot.error) console.error('kpi_orders_trend:', ot.error.message)
        if (sv.error) console.error('kpi_sla_violations:', sv.error.message)
        if (empCount.error) console.error('total_employees:', empCount.error.message)
        if (empCountAll.error) console.error('total_employees_all:', empCountAll.error.message)
        if (clientCount.error) console.error('total_clients:', clientCount.error.message)

        const safeQuery = (fn) => fn().catch(err => { console.error('client_kpi query error:', err.message); return { data: [] } })

        const [
          cancelByClientResult,
          materialsByClientResult,
          orderTypeByClientResult,
          deliveryTimeByClientResult,
          frequencyByClientResult,
          materialAnalyticsResult,
        ] = await Promise.all([
          safeQuery(() => supabase.from('orders').select('client_id, client_name, status').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, total: 0, cancelled: 0 }
              byClient[o.client_id].total++
              if ((o.status || '').toLowerCase() === 'cancelled') byClient[o.client_id].cancelled++
            })
            return { data: Object.values(byClient)
              .filter(c => c.total >= 1)
              .map(c => ({
                client_name: c.client_name,
                total_orders: c.total,
                cancelled_orders: c.cancelled,
                cancel_rate: c.total > 0 ? Math.round((c.cancelled / c.total) * 1000) / 10 : 0,
              }))
              .sort((a, b) => b.cancel_rate - a.cancel_rate)
              .slice(0, 10) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, material').not('material', 'is', null).then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id || !o.material) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, materials: {} }
              o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                byClient[o.client_id].materials[m] = (byClient[o.client_id].materials[m] || 0) + 1
              })
            })
            const clientOrderCounts = {}
            ;(data || []).forEach(o => {
              if (o.client_id) clientOrderCounts[o.client_id] = (clientOrderCounts[o.client_id] || 0) + 1
            })
            return { data: Object.entries(byClient)
              .sort((a, b) => (clientOrderCounts[b[0]] || 0) - (clientOrderCounts[a[0]] || 0))
              .slice(0, 5)
              .map(([, info]) => ({
                client_name: info.client_name,
                materials: Object.entries(info.materials)
                  .map(([name, count]) => ({ name, count }))
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 5),
              })) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, order_type').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, normal: 0, urgent_911: 0 }
              if ((o.order_type || '').toLowerCase().includes('911')) {
                byClient[o.client_id].urgent_911++
              } else {
                byClient[o.client_id].normal++
              }
            })
            return { data: Object.values(byClient)
              .filter(c => (c.normal + c.urgent_911) >= 1)
              .map(c => ({
                client_name: c.client_name,
                normal: c.normal,
                urgent_911: c.urgent_911,
                total: c.normal + c.urgent_911,
              }))
              .sort((a, b) => b.total - a.total)
              .slice(0, 10) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, delivery_date, completed_at, status').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id || !o.delivery_date) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, on_time: 0, late: 0, total_days: 0, count: 0 }
              const deliveredAt = o.completed_at || null
              if (deliveredAt) {
                const diffMs = new Date(deliveredAt) - new Date(o.delivery_date)
                const diffDays = diffMs / (1000 * 60 * 60 * 24)
                byClient[o.client_id].total_days += Math.abs(diffDays)
                byClient[o.client_id].count++
                if (diffMs <= 0) {
                  byClient[o.client_id].on_time++
                } else {
                  byClient[o.client_id].late++
                }
              }
            })
            return { data: Object.values(byClient)
              .filter(c => c.count >= 1)
              .map(c => ({
                client_name: c.client_name,
                avg_delivery_days: c.count > 0 ? Math.round((c.total_days / c.count) * 10) / 10 : 0,
                on_time: c.on_time,
                late: c.late,
                total_delivered: c.count,
              }))
              .sort((a, b) => b.total_delivered - a.total_delivered)
              .slice(0, 10) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, created_at').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, months: {}, daily: {} }
              const monthKey = new Date(o.created_at).toISOString().slice(0, 7)
              byClient[o.client_id].months[monthKey] = (byClient[o.client_id].months[monthKey] || 0) + 1
              const dayKey = new Date(o.created_at).toISOString().slice(0, 10)
              byClient[o.client_id].daily[dayKey] = (byClient[o.client_id].daily[dayKey] || 0) + 1
            })
            return { data: Object.values(byClient)
              .filter(c => Object.keys(c.months).length >= 1)
              .map(c => {
                const monthCount = Object.keys(c.months).length
                const totalOrders = Object.values(c.months).reduce((s, v) => s + v, 0)
                const avg = monthCount > 0 ? Math.round((totalOrders / monthCount) * 10) / 10 : 0
                let frequency = 'Baja'
                if (avg >= 4) frequency = 'Alta'
                else if (avg >= 1) frequency = 'Media'
                return {
                  client_name: c.client_name,
                  orders_per_month: avg,
                  total_orders: totalOrders,
                  active_months: monthCount,
                  frequency,
                  months: c.months,
                  daily: c.daily,
                }
              })
              .sort((a, b) => b.orders_per_month - a.orders_per_month)
              .slice(0, 10) }
          })),
          safeQuery(() => {
            let q = supabase.from('orders').select('client_id, client_name, material, created_at, order_type, status')
            if (date_from) q = q.gte('created_at', date_from)
            if (date_to) q = q.lt('created_at', date_to)
            return q.then(({ data, error }) => {
              if (error) throw error
              const materialMap = {}
              const allMaterials = new Set()
              const orderTypeMap = {}
              ;(data || []).forEach(o => {
                if (!o.material) return
                const isUrgent = (o.order_type || '').toLowerCase().includes('911')
                o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                  allMaterials.add(m)
                  if (!materialMap[m]) materialMap[m] = { name: m, total: 0, cancelled: 0, clients: {}, months: {}, daily: {}, normal: 0, urgent: 0 }
                  materialMap[m].total++
                  if ((o.status || '').toLowerCase() === 'cancelled') materialMap[m].cancelled++
                  if (isUrgent) materialMap[m].urgent++
                  else materialMap[m].normal++
                  if (!orderTypeMap[m]) orderTypeMap[m] = { name: m, normal: 0, urgent: 0 }
                  if (isUrgent) orderTypeMap[m].urgent++
                  else orderTypeMap[m].normal++
                  if (o.client_id) {
                    if (!materialMap[m].clients[o.client_id]) materialMap[m].clients[o.client_id] = { client_name: o.client_name, count: 0 }
                    materialMap[m].clients[o.client_id].count++
                  }
                  const monthKey = new Date(o.created_at).toISOString().slice(0, 7)
                  materialMap[m].months[monthKey] = (materialMap[m].months[monthKey] || 0) + 1
                  const dayKey = new Date(o.created_at).toISOString().slice(0, 10)
                  materialMap[m].daily[dayKey] = (materialMap[m].daily[dayKey] || 0) + 1
                })
              })
              const totalOrdersWithMaterial = Object.values(materialMap).reduce((s, m) => s + m.total, 0)
              return { data: {
                all_materials: [...allMaterials].sort(),
                summary: Object.values(materialMap)
                  .map(m => ({
                    name: m.name,
                    total_orders: m.total,
                    cancelled_orders: m.cancelled,
                    cancel_rate: m.total > 0 ? Math.round((m.cancelled / m.total) * 1000) / 10 : 0,
                    usage_pct: totalOrdersWithMaterial > 0 ? Math.round((m.total / totalOrdersWithMaterial) * 1000) / 10 : 0,
                    normal_orders: m.normal,
                    urgent_orders: m.urgent,
                    top_clients: Object.values(m.clients).sort((a, b) => b.count - a.count).slice(0, 5).map(c => ({ client_name: c.client_name, count: c.count })),
                    monthly_trend: Object.entries(m.months).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
                    daily: m.daily,
                  }))
                  .sort((a, b) => b.total_orders - a.total_orders),
                order_type_by_material: Object.values(orderTypeMap).sort((a, b) => (b.normal + b.urgent) - (a.normal + a.urgent)),
              } }
            })
          }),
        ])

        let materialComparison = null
        if (compare_from || compare_to) {
          try {
            let pq = supabase.from('orders').select('material, status, created_at')
            if (compare_from) pq = pq.gte('created_at', compare_from)
            if (compare_to) pq = pq.lt('created_at', compare_to)
            const prevResult = await pq
            const prevMatMap = {}
            ;(prevResult.data || []).forEach(o => {
              if (!o.material) return
              o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                if (!prevMatMap[m]) prevMatMap[m] = { name: m, total: 0, cancelled: 0, daily: {}, months: {} }
                prevMatMap[m].total++
                if ((o.status || '').toLowerCase() === 'cancelled') prevMatMap[m].cancelled++
                const dayKey = new Date(o.created_at).toISOString().slice(0, 10)
                prevMatMap[m].daily[dayKey] = (prevMatMap[m].daily[dayKey] || 0) + 1
                const monthKey = new Date(o.created_at).toISOString().slice(0, 7)
                prevMatMap[m].months[monthKey] = (prevMatMap[m].months[monthKey] || 0) + 1
              })
            })
            const prevTotal = Object.values(prevMatMap).reduce((s, m) => s + m.total, 0)
            materialComparison = {
              period_total: prevTotal,
              summary: Object.values(prevMatMap)
                .map(m => ({
                  name: m.name,
                  total_orders: m.total,
                  cancel_rate: m.total > 0 ? Math.round((m.cancelled / m.total) * 1000) / 10 : 0,
                  usage_pct: prevTotal > 0 ? Math.round((m.total / prevTotal) * 1000) / 10 : 0,
                  daily: m.daily,
                  monthly_trend: Object.entries(m.months)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([month, count]) => ({ month, count })),
                }))
                .sort((a, b) => b.total_orders - a.total_orders),
            }
          } catch (err) {
            console.error('materialComparison error:', err.message)
          }
        }

        const agedOrders = (pendingAged.data || []).map(o => ({
          id: o.id,
          client_name: o.client_name,
          days_pending: (now - new Date(o.created_at)) / (1000 * 60 * 60 * 24),
        }))

        const paymentByClientRaw = await supabase.from('orders')
          .select('client_id, client_name, payment_status, price, id, created_at, invoice_number')
          .in('payment_status', ['credito', 'parcial'])
          .not('status', 'in', '(cancelled,in_completed,in_delivered)')

        if (paymentByClientRaw.error) console.error('paymentByClient:', paymentByClientRaw.error.message)

        const byClientMap = {}
        ;(paymentByClientRaw.data || []).forEach(o => {
          if (!o.client_id) return
          if (!byClientMap[o.client_id]) {
            byClientMap[o.client_id] = {
              client_id: o.client_id,
              client_name: o.client_name,
              credito_count: 0,
              parcial_count: 0,
              total_pending: 0,
              orders: [],
            }
          }
          if (o.payment_status === 'credito') byClientMap[o.client_id].credito_count++
          if (o.payment_status === 'parcial') byClientMap[o.client_id].parcial_count++
          const price = parseFloat(o.price) || 0
          byClientMap[o.client_id].total_pending += price
          byClientMap[o.client_id].orders.push({
            id: o.id,
            price,
            payment_status: o.payment_status,
            created_at: o.created_at,
            invoice_number: o.invoice_number || '',
          })
        })

        // Order counts by date range for dynamic card
        function buildCountQueries(dateFrom, dateTo) {
          const mkBase = () => {
            let q = supabase.from('orders').select('id', { count: 'exact', head: true })
            if (dateFrom) q = q.gte('created_at', dateFrom)
            if (dateTo) q = q.lt('created_at', dateTo)
            return q
          }
          const mkActive = () => mkBase().not('status', 'in', '(cancelled,in_completed,in_delivered)')

          return Promise.all([
            mkBase(),
            mkActive().eq('order_design_type', 'INTERNAL_DESING'),
            mkActive().eq('order_design_type', 'EXTERNAL_DESING'),
            mkActive().eq('order_type', 'orden normal'),
            mkActive().eq('order_type', 'orden 911'),
            mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden normal'),
            mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden 911'),
            mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden normal'),
            mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden 911'),
            mkActive().eq('payment_status', 'Pending_Payment'),
            mkActive().eq('payment_status', 'parcial'),
            mkActive().eq('payment_status', 'pagado'),
            mkActive().eq('payment_status', 'credito'),
            mkActive().eq('status', 'Pending'),
            mkActive().eq('status', 'in_Design'),
            mkActive().eq('status', 'in_Quote'),
            mkActive().eq('status', 'in_Production'),
            mkActive().eq('status', 'in_Termination'),
            mkActive().eq('status', 'in_Completed'),
            mkActive().eq('status', 'in_Delivered'),
            mkActive().eq('operational_status', 'active'),
            mkActive().eq('operational_status', 'blocked'),
          ]).then(([all, internal, external, normal, urgent, intNorm, intUrg, extNorm, extUrg, payPend, payPart, payPaid, payCred, wfPend, wfDes, wfQuo, wfPro, wfTer, wfCom, wfDel, opAct, opBlk]) => ({
            totals: {
              all: all.count || 0,
              internal: internal.count || 0,
              external: external.count || 0,
              normal: normal.count || 0,
              urgent_911: urgent.count || 0,
            },
            combinations: {
              internal_normal: intNorm.count || 0,
              internal_911: intUrg.count || 0,
              external_normal: extNorm.count || 0,
              external_911: extUrg.count || 0,
            },
            payment: {
              pending: payPend.count || 0,
              partial: payPart.count || 0,
              paid: payPaid.count || 0,
              credit: payCred.count || 0,
            },
            workflow: {
              pending: wfPend.count || 0,
              design: wfDes.count || 0,
              quote: wfQuo.count || 0,
              production: wfPro.count || 0,
              termination: wfTer.count || 0,
              completed: wfCom.count || 0,
              delivered: wfDel.count || 0,
            },
            operational: {
              active: opAct.count || 0,
              blocked: opBlk.count || 0,
            },
          }))
        }

        // Status breakdown by date range for pipeline
        function buildStatusBreakdown(dateFrom, dateTo) {
          let q = supabase.from('orders').select('status')
          if (dateFrom) q = q.gte('created_at', dateFrom)
          if (dateTo) q = q.lt('created_at', dateTo)
          return q.then(({ data }) => {
            const breakdown = {}
            ;(data || []).forEach(o => {
              const s = (o.status || 'unknown').toLowerCase()
              breakdown[s] = (breakdown[s] || 0) + 1
            })
            return breakdown
          })
        }

        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        const weekDate = new Date()
        weekDate.setDate(weekDate.getDate() - weekDate.getDay())
        const weekStart = weekDate.toISOString()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const d30Ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const d90Ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const m3Ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const m6Ago = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
        const y1Ago = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
        const y3Ago = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString()
        const y5Ago = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString()

        const [todayCounts, weekCounts, monthCounts, d30Counts, d90Counts, m3Counts, m6Counts, y1Counts, y3Counts, y5Counts, allCounts, todayBreakdown, weekBreakdown, monthBreakdown, d30Breakdown, d90Breakdown, m3Breakdown, m6Breakdown, y1Breakdown, y3Breakdown, y5Breakdown, allBreakdown] = await Promise.all([
          buildCountQueries(todayStart, null),
          buildCountQueries(weekStart, null),
          buildCountQueries(monthStart, null),
          buildCountQueries(d30Ago, null),
          buildCountQueries(d90Ago, null),
          buildCountQueries(m3Ago, null),
          buildCountQueries(m6Ago, null),
          buildCountQueries(y1Ago, null),
          buildCountQueries(y3Ago, null),
          buildCountQueries(y5Ago, null),
          buildCountQueries(null, null),
          buildStatusBreakdown(todayStart, null),
          buildStatusBreakdown(weekStart, null),
          buildStatusBreakdown(monthStart, null),
          buildStatusBreakdown(d30Ago, null),
          buildStatusBreakdown(d90Ago, null),
          buildStatusBreakdown(m3Ago, null),
          buildStatusBreakdown(m6Ago, null),
          buildStatusBreakdown(y1Ago, null),
          buildStatusBreakdown(y3Ago, null),
          buildStatusBreakdown(y5Ago, null),
          buildStatusBreakdown(null, null),
        ])

        result = {
          business_summary: bs.data || null,
          orders_analytics: oa.data || null,
          client_analytics: ca.data || null,
          user_analytics: ui.data || null,
          production_insights: pi.data || null,
          smart_alerts: sa.data || null,
          orders_trend: ot.data || null,
          sla_violations: sv.data || null,
          total_employees: empCount.count || 0,
          total_employees_all: empCountAll.count || 0,
          total_clients: clientCount.count || 0,
          payment_summary: {
            credito: credito.count || 0,
            parcial: parcial.count || 0,
            pending_payment: pendingPayment.count || 0,
            pending_payment_aged: {
              count: agedOrders.length,
              orders: agedOrders,
            },
            by_client: Object.values(byClientMap)
              .filter(c => c.credito_count + c.parcial_count > 0)
              .sort((a, b) => b.total_pending - a.total_pending),
          },
          top_materials: materialsResult?.data || [],
          client_kpis: {
            cancellation_by_client: cancelByClientResult?.data || [],
            materials_by_client: materialsByClientResult?.data || [],
            order_type_by_client: orderTypeByClientResult?.data || [],
            delivery_time_by_client: deliveryTimeByClientResult?.data || [],
            frequency_by_client: frequencyByClientResult?.data || [],
            material_analytics: materialAnalyticsResult?.data || {},
            material_comparison: materialComparison,
            retention_new_clients: { rate: ca.data?.retention_rate?.rate || 0 },
          },
          order_counts_by_date: {
            today: todayCounts,
            week: weekCounts,
            month: monthCounts,
            '30d': d30Counts,
            '90d': d90Counts,
            '3m': m3Counts,
            '6m': m6Counts,
            '1y': y1Counts,
            '3y': y3Counts,
            '5y': y5Counts,
            all: allCounts,
          },
          pipeline_by_date: {
            today: todayBreakdown,
            week: weekBreakdown,
            month: monthBreakdown,
            '30d': d30Breakdown,
            '90d': d90Breakdown,
            '3m': m3Breakdown,
            '6m': m6Breakdown,
            '1y': y1Breakdown,
            '3y': y3Breakdown,
            '5y': y5Breakdown,
            all: allBreakdown,
          },
        }
        break
      }

      default:
        return { status: 400, body: { error: `Acción no válida: ${action}` } }
    }

    return { status: 200, body: result }
  } catch (error) {
    console.error('KPI Data Error:', error)
    return { status: 500, body: { error: error?.message || 'Error al obtener datos KPI' } }
  }
}
