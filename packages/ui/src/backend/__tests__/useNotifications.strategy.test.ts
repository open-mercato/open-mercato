import type { UseNotificationsPollResult } from '@open-mercato/ui/backend/notifications/useNotificationsPoll'

const pollResult: UseNotificationsPollResult = {
  notifications: [],
  unreadCount: 0,
  hasNew: false,
  isLoading: false,
  error: null,
  refresh: () => undefined,
  markAsRead: async () => undefined,
  executeAction: async () => ({}),
  dismiss: async () => undefined,
  dismissUndo: null,
  undoDismiss: async () => undefined,
  markAllRead: async () => undefined,
}

const sseResult: UseNotificationsPollResult = {
  ...pollResult,
  hasNew: true,
}

jest.mock('@open-mercato/ui/backend/notifications/useNotificationsPoll', () => ({
  useNotificationsPoll: jest.fn(() => pollResult),
}))

jest.mock('@open-mercato/ui/backend/notifications/useNotificationsSse', () => ({
  useNotificationsSse: jest.fn(() => sseResult),
}))

describe('useNotifications strategy', () => {
  const originalEventSource = globalThis.window?.EventSource

  afterEach(() => {
    jest.resetModules()
    if (typeof originalEventSource === 'undefined') {
      delete (window as unknown as { EventSource?: typeof EventSource }).EventSource
    } else {
      ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = originalEventSource
    }
  })

  it('uses SSE strategy when EventSource is available', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    const { useNotifications } = await import('@open-mercato/ui/backend/notifications/useNotifications')
    expect(useNotifications()).toBe(sseResult)
  })

  it('falls back to polling strategy when EventSource is unavailable', async () => {
    delete (window as unknown as { EventSource?: typeof EventSource }).EventSource

    const { useNotifications } = await import('@open-mercato/ui/backend/notifications/useNotifications')
    expect(useNotifications()).toBe(pollResult)
  })
})
