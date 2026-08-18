import { useEffect, useMemo, useRef } from 'react'
import { registerRealtimeListener } from '../utils/realtimeCoordinator'

const DEFAULT_TABLES = ['orders']

// Compatibility hook for existing modules. The coordinator owns the shared
// Supabase channels; components only register the resources they depend on.
export default function useOrdersRealtimeSync({ userId, scope, refreshOrders, tables = DEFAULT_TABLES }) {
  const refreshRef = useRef(refreshOrders)
  const tablesKey = tables.join('|')
  const realtimeTables = useMemo(() => tablesKey.split('|').filter(Boolean), [tablesKey])

  useEffect(() => {
    refreshRef.current = refreshOrders
  }, [refreshOrders])

  useEffect(() => {
    if (!userId || !scope) return undefined
    return registerRealtimeListener({
      userId,
      tables: realtimeTables,
      onChange: async () => {
        try {
          await refreshRef.current?.()
        } catch (error) {
          console.warn(`No se pudo reconciliar ${scope} en tiempo real:`, error?.message || error)
        }
      },
    })
  }, [realtimeTables, scope, userId])
}
