import { supabase } from '../../supabaseClient'

const COALESCE_MS = 100
const DUPLICATE_EVENT_WINDOW_MS = 750
const FAILURE_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT'])
const groups = new Map()
let visibilityListening = false

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

function ensureVisibilityListener() {
  if (visibilityListening || typeof document === 'undefined') return

  document.addEventListener('visibilitychange', () => {
    if (isHidden()) return
    groups.forEach(group => {
      if (!group.pendingChanges.size && !group.needsReconcile) return
      group.needsReconcile = false
      const pendingChanges = [...group.pendingChanges.values()]
      scheduleDispatch(group, pendingChanges)
    })
  })
  visibilityListening = true
}

function normalizeChange(change) {
  if (typeof change === 'string') {
    return { table: change, id: null, operation: 'RECONCILE' }
  }

  return {
    table: change?.table,
    id: change?.id || null,
    operation: change?.operation || 'UPDATE',
  }
}

function getChangeKey(change) {
  return `${change.table}:${change.id || '*'}:${change.operation}`
}

function pruneRecentChanges(group, now) {
  group.recentChanges.forEach((seenAt, key) => {
    if (now - seenAt > DUPLICATE_EVENT_WINDOW_MS) group.recentChanges.delete(key)
  })
}

function scheduleDispatch(group, changes) {
  const now = Date.now()
  pruneRecentChanges(group, now)

  changes
    .map(normalizeChange)
    .filter(change => Boolean(change.table))
    .forEach(change => {
      const key = getChangeKey(change)
      if (group.recentChanges.has(key)) return
      group.recentChanges.set(key, now)
      group.pendingChanges.set(key, change)
    })

  if (!group.pendingChanges.size) return
  if (isHidden()) return
  if (group.timer !== null) return

  group.timer = window.setTimeout(() => {
    group.timer = null
    const changes = [...group.pendingChanges.values()]
    group.pendingChanges.clear()
    const changedTables = new Set(changes.map(change => change.table))
    group.listeners.forEach(listener => {
      if ([...changedTables].some(table => listener.tables.has(table))) {
        listener.onChange({
          tables: changedTables,
          changes: changes.filter(change => listener.tables.has(change.table)),
        })
      }
    })
  }, COALESCE_MS)
}

function removeChannels(group) {
  if (group.broadcastChannel) supabase.removeChannel(group.broadcastChannel)
  if (group.fallbackChannel) supabase.removeChannel(group.fallbackChannel)
  group.broadcastChannel = null
  group.fallbackChannel = null
}

function rebuildChannels(group) {
  const tables = [...new Set([...group.listeners.values()].flatMap(listener => [...listener.tables]))].sort()
  const tablesKey = tables.join('|')
  if (group.tablesKey === tablesKey && group.broadcastChannel && group.fallbackChannel) return

  removeChannels(group)
  group.tablesKey = tablesKey
  if (!tables.length) return

  const generation = ++group.generation
  const onStatus = (status, error) => {
    if (generation !== group.generation) return
    if (status === 'CLOSED') {
      group.needsReconcile = true
      return
    }
    if (FAILURE_STATUSES.has(status)) {
      group.needsReconcile = true
      console.warn(`Realtime en estado ${status}.`, error || '')
      return
    }
    if (status === 'SUBSCRIBED' && group.needsReconcile) {
      group.needsReconcile = false
      scheduleDispatch(group, tables)
    }
  }

  const connect = async () => {
    try {
      await supabase.realtime.setAuth()
    } catch (error) {
      console.warn('No se pudo autorizar Realtime:', error?.message || error)
    }
    if (generation !== group.generation || !groups.has(group.userId)) return

    group.broadcastChannel = supabase
      .channel(`orders:user:${group.userId}`, { config: { private: true } })
      .on('broadcast', { event: 'order_changed' }, (message) => {
        if (generation !== group.generation) return
        const payload = message?.payload || message || {}
        scheduleDispatch(group, [{
          table: 'orders',
          id: payload.order_id || null,
          operation: payload.operation || 'UPDATE',
        }])
      })
      .subscribe(onStatus)

    const fallback = supabase.channel(`realtime:data:${group.userId}:${tables.join('-')}`)
    tables.forEach(table => {
      fallback.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        if (generation !== group.generation) return
        const row = payload?.new || payload?.old || {}
        scheduleDispatch(group, [{
          table,
          id: row.id || null,
          operation: payload?.eventType || 'UPDATE',
        }])
      })
    })
    group.fallbackChannel = fallback.subscribe(onStatus)
  }

  void connect()
}

function getGroup(userId) {
  let group = groups.get(userId)
  if (!group) {
    group = {
      userId,
      listeners: new Map(),
      pendingChanges: new Map(),
      recentChanges: new Map(),
      timer: null,
      broadcastChannel: null,
      fallbackChannel: null,
      tablesKey: '',
      generation: 0,
      needsReconcile: false,
    }
    groups.set(userId, group)
  }
  ensureVisibilityListener()
  return group
}

export function registerRealtimeListener({ userId, tables, onChange }) {
  if (!userId || !tables?.length || typeof onChange !== 'function') return () => undefined

  const group = getGroup(userId)
  const listenerId = Symbol('realtime-listener')
  group.listeners.set(listenerId, { tables: new Set(tables), onChange })
  rebuildChannels(group)

  return () => {
    const currentGroup = groups.get(userId)
    if (!currentGroup) return
    currentGroup.listeners.delete(listenerId)
    if (!currentGroup.listeners.size) {
      if (currentGroup.timer !== null) window.clearTimeout(currentGroup.timer)
      currentGroup.generation += 1
      removeChannels(currentGroup)
      groups.delete(userId)
      return
    }
    rebuildChannels(currentGroup)
  }
}

export function __resetRealtimeCoordinatorForTests() {
  groups.forEach(group => {
    if (group.timer !== null) window.clearTimeout(group.timer)
    group.generation += 1
    removeChannels(group)
  })
  groups.clear()
}
