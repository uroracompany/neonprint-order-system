import { supabase } from '../../supabaseClient'

const COALESCE_MS = 100
const FAILURE_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT'])
const groups = new Map()
let visibilityListening = false

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

function ensureVisibilityListener() {
  if (visibilityListening || typeof document === 'undefined') return

  document.addEventListener('visibilitychange', () => {
    if (isHidden()) return
    groups.forEach(group => {
      if (!group.pendingTables.size && !group.needsReconcile) return
      group.needsReconcile = false
      const pendingTables = new Set(group.pendingTables)
      group.pendingTables.clear()
      scheduleDispatch(group, pendingTables)
    })
  })
  visibilityListening = true
}

function scheduleDispatch(group, tables) {
  tables.forEach(table => group.pendingTables.add(table))
  if (isHidden()) return
  if (group.timer !== null) return

  group.timer = window.setTimeout(() => {
    group.timer = null
    const changedTables = new Set(group.pendingTables)
    group.pendingTables.clear()
    group.listeners.forEach(listener => {
      if ([...changedTables].some(table => listener.tables.has(table))) {
        listener.onChange({ tables: changedTables })
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
      scheduleDispatch(group, new Set(tables))
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
      .on('broadcast', { event: 'order_changed' }, () => {
        if (generation === group.generation) scheduleDispatch(group, new Set(['orders']))
      })
      .subscribe(onStatus)

    const fallback = supabase.channel(`realtime:data:${group.userId}:${tables.join('-')}`)
    tables.forEach(table => {
      fallback.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (generation === group.generation) scheduleDispatch(group, new Set([table]))
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
      pendingTables: new Set(),
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
