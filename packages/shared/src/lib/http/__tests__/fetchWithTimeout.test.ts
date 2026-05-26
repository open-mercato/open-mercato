import { fetchWithTimeout, FetchTimeoutError, resolveTimeoutMs, withTimeout } from '../fetchWithTimeout'

describe('resolveTimeoutMs', () => {
  it('returns provided positive values', () => {
    expect(resolveTimeoutMs(1234)).toBe(1234)
    expect(resolveTimeoutMs(1, 999)).toBe(1)
  })

  it('falls back for undefined, zero, negative, or non-finite values', () => {
    expect(resolveTimeoutMs(undefined, 500)).toBe(500)
    expect(resolveTimeoutMs(0, 500)).toBe(500)
    expect(resolveTimeoutMs(-10, 500)).toBe(500)
    expect(resolveTimeoutMs(Number.POSITIVE_INFINITY, 500)).toBe(500)
    expect(resolveTimeoutMs(Number.NaN, 500)).toBe(500)
  })
})

describe('fetchWithTimeout', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves with the underlying response when fetch completes in time', async () => {
    const response = new Response('ok', { status: 200 })
    global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch
    const result = await fetchWithTimeout('https://example.com', { timeoutMs: 100 })
    expect(result).toBe(response)
  })

  it('rejects with FetchTimeoutError if fetch exceeds the timeout', async () => {
    global.fetch = jest.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        if (!signal) return
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          ;(err as Error & { name: string }).name = 'AbortError'
          reject(err)
        })
      })
    }) as unknown as typeof fetch

    await expect(
      fetchWithTimeout('https://example.com/slow', { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError)
  })

  it('propagates external abort reasons without converting them into timeout errors', async () => {
    const externalController = new AbortController()
    global.fetch = jest.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        if (!signal) return
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          ;(err as Error & { name: string }).name = 'AbortError'
          reject(err)
        })
      })
    }) as unknown as typeof fetch

    const pending = fetchWithTimeout('https://example.com/hang', {
      timeoutMs: 10_000,
      signal: externalController.signal,
    })
    externalController.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toMatchObject({ message: 'caller cancelled' })
  })

  it('throws immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already done'))
    global.fetch = jest.fn() as unknown as typeof fetch
    await expect(
      fetchWithTimeout('https://example.com', { timeoutMs: 100, signal: controller.signal }),
    ).rejects.toMatchObject({ message: 'already done' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('withTimeout', () => {
  it('resolves when the task finishes before the deadline', async () => {
    const result = await withTimeout(async () => 'done', 100, 'test')
    expect(result).toBe('done')
  })

  it('throws FetchTimeoutError and aborts the task when the deadline elapses', async () => {
    const pending = withTimeout(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
      10,
      'meilisearch.search',
    )
    await expect(pending).rejects.toBeInstanceOf(FetchTimeoutError)
  })

  it('does not swallow task errors when the task fails before the timeout', async () => {
    await expect(
      withTimeout(async () => {
        throw new Error('boom')
      }, 1_000, 'label'),
    ).rejects.toMatchObject({ message: 'boom' })
  })
})
