import { fetchOptionalCatalogVariant, readOptionalCatalogVariant } from '../catalogVariantLookup'

const response = {} as Response
const raise = jest.fn(async () => {
  throw new Error('raised')
})

describe('readOptionalCatalogVariant', () => {
  beforeEach(() => raise.mockClear())

  it('returns the first variant row on success', async () => {
    const row = { id: 'v1', sku: 'S1', name: 'Name' }
    await expect(
      readOptionalCatalogVariant({ ok: true, status: 200, result: { items: [row] }, response }, 'v1', raise),
    ).resolves.toEqual(row)
  })

  it('returns null when the variant does not exist', async () => {
    await expect(
      readOptionalCatalogVariant({ ok: true, status: 200, result: { items: [] }, response }, 'v1', raise),
    ).resolves.toBeNull()
  })

  it('does not fail the page when catalog access is forbidden (403)', async () => {
    await expect(
      readOptionalCatalogVariant({ ok: false, status: 403, result: null, response }, 'v1', raise),
    ).resolves.toEqual({ id: 'v1' })
    expect(raise).not.toHaveBeenCalled()
  })

  it('still raises for other failures', async () => {
    await expect(
      readOptionalCatalogVariant({ ok: false, status: 500, result: null, response }, 'v1', raise),
    ).rejects.toThrow('raised')
  })
})

describe('fetchOptionalCatalogVariant (real apiCall/apiFetch)', () => {
  const originalFetch = global.fetch
  beforeEach(() => raise.mockClear())
  afterEach(() => {
    global.fetch = originalFetch
  })

  function mockFetchWith(status: number, body: unknown) {
    const fetchMock = jest.fn(async (_input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      // Like the backend: a 403 is only converted into a ForbiddenError when the caller did not opt out.
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    })
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('resolves to a bare row on 403 instead of throwing ForbiddenError', async () => {
    const fetchMock = mockFetchWith(403, { error: 'Forbidden', requiredFeatures: ['catalog.products.view'] })
    await expect(fetchOptionalCatalogVariant('v1', raise)).resolves.toEqual({ id: 'v1' })
    expect(raise).not.toHaveBeenCalled()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('x-om-forbidden-redirect')).toBe('0')
  })

  it('returns the variant row on 200', async () => {
    mockFetchWith(200, { items: [{ id: 'v1', name: 'Name' }] })
    await expect(fetchOptionalCatalogVariant('v1', raise)).resolves.toEqual({ id: 'v1', name: 'Name' })
  })
})
