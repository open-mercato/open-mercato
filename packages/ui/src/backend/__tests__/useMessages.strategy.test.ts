import type { UseMessagesPollResult } from '@open-mercato/ui/backend/messages/useMessagesPoll'

const pollResult: UseMessagesPollResult = {
  messages: [],
  unreadCount: 0,
  hasNew: false,
  isLoading: false,
  error: null,
  refresh: async () => undefined,
}

const sseResult: UseMessagesPollResult = {
  ...pollResult,
  unreadCount: 3,
}

jest.mock('@open-mercato/ui/backend/messages/useMessagesPoll', () => ({
  useMessagesPoll: jest.fn(() => pollResult),
}))

jest.mock('@open-mercato/ui/backend/messages/useMessagesSse', () => ({
  useMessagesSse: jest.fn(() => sseResult),
}))

describe('useMessages strategy', () => {
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

    const { useMessages } = await import('@open-mercato/ui/backend/messages/useMessages')
    expect(useMessages()).toBe(sseResult)
  })

  it('falls back to polling strategy when EventSource is unavailable', async () => {
    delete (window as unknown as { EventSource?: typeof EventSource }).EventSource

    const { useMessages } = await import('@open-mercato/ui/backend/messages/useMessages')
    expect(useMessages()).toBe(pollResult)
  })
})
