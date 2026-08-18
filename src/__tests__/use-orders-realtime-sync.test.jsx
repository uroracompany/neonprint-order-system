import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../../supabaseClient'
import useOrdersRealtimeSync from '../hooks/useOrdersRealtimeSync'
import { __resetRealtimeCoordinatorForTests } from '../utils/realtimeCoordinator'

vi.mock('../../supabaseClient', () => ({
  supabase: {
    realtime: { setAuth: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}))

const flushConnection = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useOrdersRealtimeSync', () => {
  let channels

  beforeEach(() => {
    vi.useFakeTimers()
    channels = []
    supabase.realtime.setAuth.mockResolvedValue()
    supabase.removeChannel.mockResolvedValue()
    supabase.channel.mockImplementation((name, options) => {
      const handlers = { broadcast: [], postgres_changes: [] }
      const channel = {
        name,
        options,
        handlers,
        statusCallback: null,
        on: vi.fn((type, filter, callback) => {
          handlers[type].push({ filter, callback })
          return channel
        }),
        subscribe: vi.fn((callback) => {
          channel.statusCallback = callback
          return channel
        }),
      }
      channels.push(channel)
      return channel
    })
  })

  afterEach(() => {
    __resetRealtimeCoordinatorForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shares one Broadcast and one Postgres Changes channel for the same user', async () => {
    const firstRefresh = vi.fn().mockResolvedValue()
    const secondRefresh = vi.fn().mockResolvedValue()
    const first = renderHook(() => useOrdersRealtimeSync({ userId: 'user-1', scope: 'quote', refreshOrders: firstRefresh }))
    const second = renderHook(() => useOrdersRealtimeSync({ userId: 'user-1', scope: 'delivery', refreshOrders: secondRefresh }))
    await flushConnection()

    expect(supabase.channel).toHaveBeenCalledTimes(2)
    expect(channels[0].name).toBe('orders:user:user-1')
    expect(channels[1].name).toBe('realtime:data:user-1:orders')

    act(() => {
      channels[0].handlers.broadcast[0].callback()
      channels[1].handlers.postgres_changes[0].callback()
    })
    await act(async () => vi.advanceTimersByTimeAsync(100))

    expect(firstRefresh).toHaveBeenCalledTimes(1)
    expect(secondRefresh).toHaveBeenCalledTimes(1)
    first.unmount()
    second.unmount()
  })

  it('does not refresh on subscription, focus, visibility or online events', async () => {
    const refreshOrders = vi.fn().mockResolvedValue()
    const { unmount } = renderHook(() => useOrdersRealtimeSync({
      userId: 'user-2', scope: 'admin', refreshOrders,
    }))
    await flushConnection()

    act(() => {
      channels.forEach(channel => channel.statusCallback('SUBSCRIBED'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => vi.advanceTimersByTimeAsync(200))

    expect(refreshOrders).not.toHaveBeenCalled()
    unmount()
  })

  it('defers a real change received while hidden until the document becomes visible', async () => {
    const refreshOrders = vi.fn().mockResolvedValue()
    renderHook(() => useOrdersRealtimeSync({
      userId: 'user-3', scope: 'production', refreshOrders,
      tables: ['orders', 'order_production_files'],
    }))
    await flushConnection()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => channels[1].handlers.postgres_changes.find(({ filter }) => filter.table === 'order_production_files').callback())
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(refreshOrders).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(refreshOrders).toHaveBeenCalledTimes(1)
  })
})
