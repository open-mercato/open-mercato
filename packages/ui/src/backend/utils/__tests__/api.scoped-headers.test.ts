import { apiFetch, withScopedApiHeaders } from '../api'

describe('withScopedApiHeaders', () => {
  const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch

  beforeEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: jest.Mock }).fetch = jest.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
  })

  test('removes the correct scoped header when overlapping scopes finish out of order', async () => {
    let releaseFirst: (() => void) | null = null
    let releaseSecond: (() => void) | null = null

    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondPending = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const firstScope = withScopedApiHeaders(
      { 'x-first-scope': 'first' },
      async () => {
        await firstPending
      },
    )

    const secondScope = withScopedApiHeaders(
      { 'x-second-scope': 'second' },
      async () => {
        await secondPending
      },
    )

    if (!releaseFirst || !releaseSecond) throw new Error('Test setup failed')

    releaseFirst()
    await firstScope

    await apiFetch('/api/test')

    releaseSecond()
    await secondScope

    const call = ((globalThis as { fetch?: jest.Mock }).fetch as jest.Mock).mock.calls[0]
    expect(call).toBeDefined()

    const headers = new Headers((call?.[1] as RequestInit | undefined)?.headers)
    expect(headers.get('x-first-scope')).toBeNull()
    expect(headers.get('x-second-scope')).toBe('second')
  })
})
