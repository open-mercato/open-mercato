import { OpenCodeClient } from '../opencode-client'

describe('OpenCodeClient.subscribeToEvents', () => {
  const originalFetch = global.fetch
  let originalSseEnv: string | undefined

  beforeEach(() => {
    originalSseEnv = process.env.OPENCODE_SSE_CONNECT_TIMEOUT_MS
    process.env.OPENCODE_SSE_CONNECT_TIMEOUT_MS = '25'
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalSseEnv === undefined) {
      delete process.env.OPENCODE_SSE_CONNECT_TIMEOUT_MS
    } else {
      process.env.OPENCODE_SSE_CONNECT_TIMEOUT_MS = originalSseEnv
    }
  })

  const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('waitFor: predicate never became true')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  it('invokes onError with the connect-timeout reason when the deadline elapses before the SSE handshake', async () => {
    global.fetch = jest.fn((_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        if (!signal) return
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          ;(err as Error & { name: string }).name = 'AbortError'
          reject(err)
        })
      })
    }) as unknown as typeof fetch

    const client = new OpenCodeClient({ baseUrl: 'http://opencode.local' })
    const onError = jest.fn()

    client.subscribeToEvents(() => {}, onError)

    await waitFor(() => onError.mock.calls.length > 0)

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0] as Error
    expect(err.message).toMatch(/OpenCode SSE connection timed out after \d+ms/)
  })

  it('does not invoke onError when the caller disposes the stream before it connects', async () => {
    global.fetch = jest.fn((_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        if (!signal) return
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          ;(err as Error & { name: string }).name = 'AbortError'
          reject(err)
        })
      })
    }) as unknown as typeof fetch

    const client = new OpenCodeClient({ baseUrl: 'http://opencode.local' })
    const onError = jest.fn()

    const dispose = client.subscribeToEvents(() => {}, onError)
    dispose()
    await new Promise((r) => setTimeout(r, 10))

    expect(onError).not.toHaveBeenCalled()
  })
})
