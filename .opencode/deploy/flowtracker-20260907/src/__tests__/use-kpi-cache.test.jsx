import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useKPI } from '../hooks/useKPI'
import { adminApiFetch } from '../utils/adminApi'

vi.mock('../utils/adminApi', () => ({ adminApiFetch: vi.fn() }))
vi.mock('../hooks/useOrdersRealtimeSync', () => ({ default: vi.fn() }))

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useKPI cache', () => {
  it('keeps cached KPI data and does not refetch when browser focus returns', async () => {
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { snapshot: { open_total: 4 } } })
    const { result } = renderHook(() => useKPI({}, 'admin-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.data?.snapshot?.open_total).toBe(4))
    expect(result.current.loading).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(adminApiFetch).toHaveBeenCalledTimes(1)
    expect(result.current.data?.snapshot?.open_total).toBe(4)
  })

  it('starts with a valid monthly comparison instead of the unbounded historical range', async () => {
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { snapshot: { open_total: 4 } } })
    renderHook(() => useKPI({}, 'admin-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalled())
    const [, params] = adminApiFetch.mock.calls.at(-1)
    const currentDuration = new Date(params.date_to) - new Date(params.date_from)
    const comparisonDuration = new Date(params.compare_to) - new Date(params.compare_from)

    expect(params.action).toBe('all')
    expect(params.date_from).not.toBe('1970-01-01T00:00:00.000Z')
    expect(currentDuration).toBeGreaterThan(0)
    expect(comparisonDuration).toBe(currentDuration)
    expect(params.compare_to).toBe(params.date_from)
  })

  it('keeps the optional general range comparable when restored from the workspace', async () => {
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { snapshot: { open_total: 4 } } })
    renderHook(() => useKPI({ period: 'general' }, 'admin-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalled())
    const [, params] = adminApiFetch.mock.calls.at(-1)

    expect(new Date(params.date_to) - new Date(params.date_from)).toBeGreaterThan(0)
    expect(new Date(params.compare_to) - new Date(params.compare_from))
      .toBe(new Date(params.date_to) - new Date(params.date_from))
    expect(params.compare_to).toBe(params.date_from)
  })
})
