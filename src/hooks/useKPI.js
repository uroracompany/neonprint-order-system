import { useState, useEffect, useCallback, useRef } from 'react'
import { adminApiFetch } from '../utils/adminApi'
import { getPeriodBounds, getComparePeriodBounds } from '../utils/kpiHelpers'

const CACHE_TTL = 60000 // 60 seconds

export function useKPI() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('month')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')

  const cacheRef = useRef(new Map())
  const abortControllerRef = useRef(null)

  const fetchKPI = useCallback(async (action = 'all', params = {}) => {
    const cacheKey = `${action}_${JSON.stringify(params)}`
    const cached = cacheRef.current.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      const result = await adminApiFetch('/api/kpi-data', {
        action,
        ...params,
      })

      if (!result.response.ok) {
        const errorMsg = result.result?.details
          ? result.result.details.join('; ')
          : result.result?.error || `Error HTTP ${result.response.status}: ${result.response.statusText}`
        throw new Error(errorMsg)
      }

      cacheRef.current.set(cacheKey, { data: result.result, timestamp: Date.now() })
      return result.result
    } catch (err) {
      if (err.name === 'AbortError') return null
      throw err
    }
  }, [])

  const refresh = useCallback(async () => {
    cacheRef.current.clear()
    await loadKPI()
  }, [])

  const loadKPI = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let dateFrom, dateTo, compareFrom, compareTo

      if (period === 'custom' && customDateFrom && customDateTo) {
        dateFrom = customDateFrom
        dateTo = customDateTo
        // For custom, compare with same duration before
        const diff = new Date(dateTo) - new Date(dateFrom)
        compareFrom = new Date(new Date(dateFrom) - diff).toISOString()
        compareTo = dateFrom
      } else {
        const bounds = getPeriodBounds(period)
        const compareBounds = getComparePeriodBounds(period)
        dateFrom = bounds.dateFrom
        dateTo = bounds.dateTo
        compareFrom = compareBounds.dateFrom
        compareTo = compareBounds.dateTo
      }

      const result = await fetchKPI('all', {
        date_from: dateFrom,
        date_to: dateTo,
        compare_from: compareFrom,
        compare_to: compareTo,
      })

      if (result) {
        setData(result)
      }
    } catch (err) {
      setError(err.message)
      console.error('KPI Load Error:', err)
    } finally {
      setLoading(false)
    }
  }, [period, customDateFrom, customDateTo, fetchKPI])

  useEffect(() => {
    loadKPI()
  }, [loadKPI])

  const setPeriodAndDates = useCallback((newPeriod, from = '', to = '') => {
    setPeriod(newPeriod)
    if (newPeriod === 'custom') {
      setCustomDateFrom(from)
      setCustomDateTo(to)
    }
  }, [])

  return {
    data,
    loading,
    error,
    period,
    setPeriod: setPeriodAndDates,
    customDateFrom,
    setCustomDateFrom,
    customDateTo,
    setCustomDateTo,
    refresh,
  }
}

export function useKPISingle(action, params = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await adminApiFetch('/api/kpi-data', { action, ...params })
      if (!result.response.ok) throw new Error(result.result.error)
      setData(result.result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [action, params])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, refresh: load }
}