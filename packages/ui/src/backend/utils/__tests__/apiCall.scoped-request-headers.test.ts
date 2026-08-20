import { apiCall, withScopedApiRequestBody, withScopedApiRequestHeaders } from '../apiCall'

describe('withScopedApiRequestHeaders', () => {
  const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch

  beforeEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: jest.Mock }).fetch = jest.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
  })

  test('removes only completed request scope when scopes finish out of order', async () => {
    let releaseFirst: (() => void) | null = null
    let releaseSecond: (() => void) | null = null

    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondPending = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const firstScope = withScopedApiRequestHeaders(
      { 'x-first-scope': 'first' },
      async () => {
        await firstPending
      },
    )

    const secondScope = withScopedApiRequestHeaders(
      { 'x-second-scope': 'second' },
      async () => {
        await secondPending
      },
    )

    if (!releaseFirst || !releaseSecond) throw new Error('Test setup failed')

    releaseFirst()
    await firstScope

    await apiCall('/api/test')

    releaseSecond()
    await secondScope

    const call = ((globalThis as { fetch?: jest.Mock }).fetch as jest.Mock).mock.calls[0]
    expect(call).toBeDefined()

    const headers = new Headers((call?.[1] as RequestInit | undefined)?.headers)
    expect(headers.get('x-first-scope')).toBeNull()
    expect(headers.get('x-second-scope')).toBe('second')
  })
})

describe('withScopedApiRequestBody', () => {
  const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch

  beforeEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: jest.Mock }).fetch = jest.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
  })

  test('merges the scoped payload into JSON requests and restores nested scopes', async () => {
    await withScopedApiRequestBody({ relations: { relatedPersonId: 'person-1' } }, async () => {
      await withScopedApiRequestBody({ relations: { relationType: 'father' } }, async () => {
        await apiCall('/api/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Alex' }),
        })
      })
      await apiCall('/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Jordan' }),
      })
    })
    await apiCall('/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Taylor' }),
    })

    const calls = ((globalThis as { fetch?: jest.Mock }).fetch as jest.Mock).mock.calls
    expect(JSON.parse(calls[0][1].body)).toMatchObject({
      name: 'Alex',
      __om_ext_v1: { relations: { relatedPersonId: 'person-1', relationType: 'father' } },
    })
    expect(JSON.parse(calls[1][1].body)).toMatchObject({
      name: 'Jordan',
      __om_ext_v1: { relations: { relatedPersonId: 'person-1' } },
    })
    expect(JSON.parse(calls[2][1].body)).toEqual({ name: 'Taylor' })
  })
})
