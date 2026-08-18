import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApiFetch } from '../utils/adminApi'
import { getPeriodBounds, getComparePeriodBounds } from '../utils/kpiHelpers'
import { queryKeys } from '../utils/queryKeys'
import useOrdersRealtimeSync from './useOrdersRealtimeSync'

const KPI_REALTIME_TABLES = ['orders', 'order_events', 'order_production_files', 'profiles', 'clients']

async function fetchKpi(action, params) {
  const { response, result } = await adminApiFetch('/api/kpi-data', { action, ...params })
  if (response.ok) return result

  const errorMessage = result?.details
    ? result.details.join('; ')
    : result?.error || `Error HTTP ${response.status}: ${response.statusText}`
  const error = new Error(errorMessage)
  error.code = result?.backendCode || result?.code || null
  error.status = response.status
  error.details = result?.details || null
  throw error
}

function getKpiBounds(period, customDateFrom, customDateTo) {
  if (period === 'custom') {
    if (!customDateFrom || !customDateTo || customDateFrom > customDateTo) return null

    const dateFrom = new Date(`${customDateFrom}T00:00:00`).toISOString()
    const exclusiveEnd = new Date(`${customDateTo}T00:00:00`)
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1)
    const dateTo = exclusiveEnd.toISOString()
    const duration = new Date(dateTo) - new Date(dateFrom)
    return {
      date_from: dateFrom,
      date_to: dateTo,
      compare_from: new Date(new Date(dateFrom) - duration).toISOString(),
      compare_to: dateFrom,
    }
  }

  const bounds = getPeriodBounds(period)
  const compareBounds = getComparePeriodBounds(period)
  return {
    date_from: bounds.dateFrom,
    date_to: bounds.dateTo,
    compare_from: compareBounds.dateFrom,
    compare_to: compareBounds.dateTo,
  }
}

export function useKPI(initialState = {}, userId) {
  const [period, setPeriod] = useState(() => initialState.period || 'month')
  const [customDateFrom, setCustomDateFrom] = useState(() => initialState.customDateFrom || '')
  const [customDateTo, setCustomDateTo] = useState(() => initialState.customDateTo || '')
  const queryClient = useQueryClient()

  const bounds = useMemo(
    () => getKpiBounds(period, customDateFrom, customDateTo),
    [customDateFrom, customDateTo, period],
  )
  const queryKey = useMemo(() => queryKeys.kpiExecutive(userId, bounds), [bounds, userId])
  const query = useQuery({
    queryKey,
    queryFn: () => fetchKpi('all', bounds),
    enabled: Boolean(bounds && userId),
    placeholderData: keepPreviousData,
  })

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  )

  useOrdersRealtimeSync({
    userId,
    scope: 'kpi-executive',
    tables: KPI_REALTIME_TABLES,
    refreshOrders: refresh,
  })

  const setPeriodAndDates = useCallback((newPeriod, from = '', to = '') => {
    setPeriod(newPeriod)
    if (newPeriod === 'custom') {
      setCustomDateFrom(from)
      setCustomDateTo(to)
    }
  }, [])

  return {
    data: query.data || null,
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error?.message || null,
    errorInfo: query.error ? { code: query.error.code || null, status: query.error.status || null } : null,
    isPlaceholderData: query.isPlaceholderData,
    period,
    setPeriod: setPeriodAndDates,
    customDateFrom,
    setCustomDateFrom,
    customDateTo,
    setCustomDateTo,
    refresh,
  }
}

export function useKPISingle(action, params = {}, userId, enabled = true) {
  const queryKey = useMemo(() => queryKeys.kpiDetail(userId, action, params), [action, params, userId])
  const query = useQuery({
    queryKey,
    queryFn: () => fetchKpi(action, params),
    enabled: Boolean(userId) && enabled,
    placeholderData: keepPreviousData,
  })

  return {
    data: query.data || null,
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error?.message || null,
    errorInfo: query.error ? { code: query.error.code || null, status: query.error.status || null } : null,
    isPlaceholderData: query.isPlaceholderData,
    refresh: query.refetch,
  }
}
