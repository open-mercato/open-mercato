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
  const jsonInit = (body: Record<string, unknown>, method = 'POST'): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const sentBodies = () =>
    ((globalThis as { fetch?: jest.Mock }).fetch as jest.Mock).mock.calls.map((call) =>
      typeof call[1]?.body === 'string' ? JSON.parse(call[1].body) : call[1]?.body,
    )

  beforeEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: jest.Mock }).fetch = jest.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
  })

  test('merges every open scope into the first eligible write and leaves later calls alone', async () => {
    await withScopedApiRequestBody({ relations: { relatedPersonId: 'person-1' } }, async () => {
      await withScopedApiRequestBody({ relations: { relationType: 'father' } }, async () => {
        await apiCall('/api/people', jsonInit({ name: 'Alex' }))
      })
      await apiCall('/api/people/person-1/emails', jsonInit({ email: 'alex@example.com' }))
    })
    await apiCall('/api/people', jsonInit({ name: 'Taylor' }))

    expect(sentBodies()).toEqual([
      { name: 'Alex', __om_ext_v1: { relations: { relatedPersonId: 'person-1', relationType: 'father' } } },
      { email: 'alex@example.com' },
      { name: 'Taylor' },
    ])
  })

  test('spends the scope on the submit rather than on a secondary write that follows it', async () => {
    await withScopedApiRequestBody({ relations: { relatedPersonId: 'person-1' } }, async () => {
      await apiCall('/api/people', jsonInit({ name: 'Alex' }))
      await apiCall('/api/audit', jsonInit({ event: 'person.created' }))
    })

    expect(sentBodies()).toEqual([
      { name: 'Alex', __om_ext_v1: { relations: { relatedPersonId: 'person-1' } } },
      { event: 'person.created' },
    ])
  })

  test('never touches reads, non-JSON content types, or non-object bodies', async () => {
    await withScopedApiRequestBody({ relations: { relatedPersonId: 'person-1' } }, async () => {
      await apiCall('/api/people?page=1', { method: 'GET' })
      await apiCall('/api/people/person-1', { method: 'DELETE' })
      await apiCall('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ name: 'Alex' }),
      })
      await apiCall('/api/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{ name: 'Alex' }]),
      })
      await apiCall('/api/people', jsonInit({ name: 'Jordan' }, 'PUT'))
    })

    const bodies = sentBodies()
    expect(bodies.slice(0, 4)).toEqual([undefined, undefined, { name: 'Alex' }, [{ name: 'Alex' }]])
    expect(bodies[4]).toEqual({ name: 'Jordan', __om_ext_v1: { relations: { relatedPersonId: 'person-1' } } })
  })

  test('leaves every request untouched once the scope has closed', async () => {
    await withScopedApiRequestBody({ relations: { relatedPersonId: 'person-1' } }, async () => {})
    await apiCall('/api/people', jsonInit({ name: 'Taylor' }))

    expect(sentBodies()).toEqual([{ name: 'Taylor' }])
  })
})
