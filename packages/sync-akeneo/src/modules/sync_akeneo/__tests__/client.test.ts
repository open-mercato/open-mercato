import { FetchTimeoutError } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { createAkeneoClient, encodeAkeneoPathParam, normalizeAkeneoDateTime, sanitizeAkeneoProductNextUrl, validateAkeneoApiUrl, type AkeneoClientDeps } from '../lib/client'

const validCredentials = {
  apiUrl: 'https://tenant.cloud.akeneo.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'api-user',
  password: 'api-password',
}

const publicAkeneoLookupHost: AkeneoClientDeps['lookupHost'] = async () => [{ address: '93.184.216.34', family: 4 }]

function createTestAkeneoClient(
  credentialsInput: Record<string, unknown> = validCredentials,
  deps: AkeneoClientDeps = {},
): ReturnType<typeof createAkeneoClient> {
  return createAkeneoClient(credentialsInput, {
    lookupHost: publicAkeneoLookupHost,
    fetchImpl: global.fetch,
    ...deps,
  })
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
    ...init,
  })
}

function redirectResponse(): Response {
  return new Response('redirected', {
    status: 302,
    headers: {
      location: 'http://169.254.169.254/latest/meta-data/',
    },
  })
}

describe('akeneo client helpers', () => {
  it('normalizes ISO timestamps to Akeneo query format', () => {
    expect(normalizeAkeneoDateTime('2026-03-10T12:15:30.000Z')).toBe('2026-03-10 12:15:30')
  })

  it('returns null for blank timestamps', () => {
    expect(normalizeAkeneoDateTime('')).toBeNull()
    expect(normalizeAkeneoDateTime(null)).toBeNull()
  })

  it('removes empty updated filters from Akeneo next urls', () => {
    const url = new URL('https://example.test/api/rest/v1/products-uuid')
    url.searchParams.set('search', JSON.stringify({
      updated: [{ operator: '>', value: '' }],
      enabled: [{ operator: '=', value: true }],
    }))

    const nextUrl = sanitizeAkeneoProductNextUrl(url.toString())
    const search = new URL(nextUrl).searchParams.get('search')
    expect(search).not.toContain('"updated"')
    expect(search).toContain('"enabled"')
  })

  it('normalizes updated filters in Akeneo next urls', () => {
    const url = new URL('https://example.test/api/rest/v1/products-uuid')
    url.searchParams.set('search', JSON.stringify({
      updated: [{ operator: '>', value: '2026-03-10T12:15:30.000Z' }],
    }))

    const nextUrl = sanitizeAkeneoProductNextUrl(url.toString())
    const search = new URL(nextUrl).searchParams.get('search')
    const parsed = JSON.parse(search ?? '{}') as { updated?: Array<{ value?: string }> }
    expect(parsed.updated?.[0]?.value).toBe('2026-03-10 12:15:30')
  })

  it('preserves Akeneo media path separators when encoding path params', () => {
    expect(encodeAkeneoPathParam('6/7/7/6776561ac32580e17fe19bb007edacd2764a8d3c_t_shirt_green.jpg'))
      .toBe('6/7/7/6776561ac32580e17fe19bb007edacd2764a8d3c_t_shirt_green.jpg')
  })
})

describe('akeneo client security', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('normalizes allowed Akeneo cloud urls to their origin', () => {
    expect(validateAkeneoApiUrl('https://tenant.cloud.akeneo.com/')).toBe('https://tenant.cloud.akeneo.com')
    expect(createTestAkeneoClient(validCredentials).credentials.apiUrl).toBe('https://tenant.cloud.akeneo.com')
  })

  it.each([
    'http://tenant.cloud.akeneo.com',
    'https://tenant.cloud.akeneo.com/admin',
    'https://tenant.cloud.akeneo.com?foo=bar',
    'https://tenant.cloud.akeneo.com:8443',
    'https://attacker.test',
    'https://127.0.0.1',
    'https://localhost',
  ])('rejects unsafe Akeneo apiUrl values: %s', (apiUrl) => {
    expect(() => validateAkeneoApiUrl(apiUrl)).toThrow()
  })

  it('allows operator-configured host overrides without trusting tenant input blindly', () => {
    expect(validateAkeneoApiUrl('https://pim.example.internal', {
      OM_INTEGRATION_AKENEO_ALLOWED_HOSTS: 'pim.example.internal',
    })).toBe('https://pim.example.internal')
  })

  it('rejects allowlisted Akeneo hosts that resolve to private IPs before sending credentials', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    const lookupHost = jest.fn(async () => [{ address: '10.0.0.5', family: 4 }])
    const client = createTestAkeneoClient(validCredentials, {
      lookupHost,
    })

    await expect(client.getSystemProbe()).rejects.toMatchObject({ reason: 'private_ip_resolved' })
    expect(lookupHost).toHaveBeenCalledWith('tenant.cloud.akeneo.com')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows private Akeneo DNS resolution only when the operator opts in', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    const lookupHost = jest.fn(async () => [{ address: '10.0.0.5', family: 4 }])
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'token-123',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({
        pim_version: '7.0.0',
      }))

    const client = createTestAkeneoClient(validCredentials, {
      lookupHost,
      allowPrivate: true,
    })

    await expect(client.getSystemProbe()).resolves.toEqual({ version: '7.0.0' })
    expect(lookupHost).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the fixed oauth token endpoint on the validated Akeneo origin', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'token-123',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({
        pim_version: '7.0.0',
      }))

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.getSystemProbe()).resolves.toEqual({ version: '7.0.0' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://tenant.cloud.akeneo.com/api/oauth/v1/token', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'password',
        client_id: validCredentials.clientId,
        client_secret: validCredentials.clientSecret,
        username: validCredentials.username,
        password: validCredentials.password,
      }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://tenant.cloud.akeneo.com/api/rest/v1/system-information', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer token-123',
      }),
    }))
  })

  it('does not automatically follow redirects while acquiring an access token', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockImplementation(async (_input, init) => (
      (init as RequestInit | undefined)?.redirect === 'manual'
        ? redirectResponse()
        : new Response('internal metadata leaked through redirect', { status: 500 })
    ))

    const client = createAkeneoClient(validCredentials)
    await expect(client.getSystemProbe()).rejects.toThrow('Akeneo authentication failed (302)')
  })

  it('does not automatically follow redirects on authenticated API requests', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/oauth/v1/token')) {
        return jsonResponse({ access_token: 'token-123', expires_in: 3600 })
      }
      return (init as RequestInit | undefined)?.redirect === 'manual'
        ? redirectResponse()
        : new Response('internal metadata leaked through redirect', { status: 500 })
    })

    const client = createAkeneoClient(validCredentials)
    await expect(client.getSystemProbe()).rejects.toThrow('Akeneo request failed (302)')
  })

  it('does not automatically follow redirects on media downloads', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/oauth/v1/token')) {
        return jsonResponse({ access_token: 'token-123', expires_in: 3600 })
      }
      if (url.endsWith('/api/rest/v1/media-files/asset-1')) {
        return jsonResponse({
          code: 'asset-1',
          original_filename: 'asset.jpg',
          _links: {
            download: {
              href: 'https://tenant.cloud.akeneo.com/api/rest/v1/media-files/asset-1/download',
            },
          },
        })
      }
      return (init as RequestInit | undefined)?.redirect === 'manual'
        ? redirectResponse()
        : new Response('internal metadata leaked through redirect', { status: 500 })
    })

    const client = createAkeneoClient(validCredentials)
    await expect(client.downloadMediaFile('asset-1')).rejects.toThrow('Akeneo request failed (302)')
  })

  it('falls back to the attributes reachability probe and reports an unknown version (issue #3621)', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('system information unavailable', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { items: [{ code: 'sku' }] },
        _links: {},
        items_count: 1,
      }))

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.getSystemProbe()).resolves.toEqual({ version: null })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[2][0])).toContain('/api/rest/v1/attributes')
  })

  it('reports an unknown version even when the attributes probe returns no items (issue #3621)', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('system information unavailable', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { items: [] },
        _links: {},
        items_count: 0,
      }))

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.getSystemProbe()).resolves.toEqual({ version: null })
  })

  it('propagates when the attributes reachability probe also fails (issue #3621)', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('system information unavailable', { status: 404 }))
      .mockResolvedValueOnce(new Response('unreachable', { status: 500 }))

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.getSystemProbe()).rejects.toThrow('Akeneo request failed (500)')
  })

  it('rejects cross-origin next urls before any authenticated request is sent', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    const client = createTestAkeneoClient(validCredentials)

    await expect(client.listProducts({
      nextUrl: 'https://attacker.test/api/rest/v1/products-uuid?search_after=abc',
      batchSize: 1,
    })).rejects.toThrow('configured host')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects cross-origin next links returned by Akeneo without following them', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'token-123',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({
        _embedded: {
          items: [],
        },
        _links: {
          next: {
            href: 'https://attacker.test/api/rest/v1/products-uuid?search_after=abc',
          },
        },
        items_count: 0,
      }))

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.listCategories(null, 1)).rejects.toThrow('configured host')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects media download urls that leave the validated Akeneo origin', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'token-123',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 'asset-1',
        original_filename: 'asset.jpg',
        _links: {
          download: {
            href: 'https://attacker.test/download/asset-1',
          },
        },
      }))

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.downloadMediaFile('asset-1')).rejects.toThrow('configured host')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://tenant.cloud.akeneo.com/api/rest/v1/media-files/asset-1', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer token-123',
      }),
    }))
  })

  it('allows same-origin absolute pagination urls from Akeneo', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'token-123',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({
        _embedded: {
          items: [{ uuid: 'product-1' }],
        },
        _links: {},
        items_count: 1,
      }))

    const client = createTestAkeneoClient(validCredentials)
    const page = await client.listProducts({
      nextUrl: 'https://tenant.cloud.akeneo.com/api/rest/v1/products-uuid?search_after=abc',
      batchSize: 1,
    })

    expect(page.items).toHaveLength(1)
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://tenant.cloud.akeneo.com/api/rest/v1/products-uuid?search_after=abc', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer token-123',
      }),
    }))
  })
})

describe('akeneo client resilience (issue #2976)', () => {
  // Mirrors DEFAULT_AKENEO_REQUEST_TIMEOUT_MS in client.ts: the per-request
  // timeout `fetchWithTimeout` schedules when no
  // OM_INTEGRATION_AKENEO_REQUEST_TIMEOUT_MS override is set (none of these tests set it).
  const AKENEO_DEFAULT_REQUEST_TIMEOUT_MS = 30_000
  const originalFetch = global.fetch
  const originalSetTimeout = global.setTimeout
  const originalMaxRetries = process.env.OM_INTEGRATION_AKENEO_MAX_RATE_LIMIT_RETRIES
  const originalRetryCap = process.env.OM_INTEGRATION_AKENEO_RETRY_AFTER_CAP_MS
  let capturedDelays: number[]

  function tokenResponse(): Response {
    return jsonResponse({ access_token: 'token-123', expires_in: 3600 })
  }

  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch
    capturedDelays = []
    // Fire backoff/retry-after sleeps synchronously so the retry loop runs
    // without real timers while we assert the requested wait durations. The
    // shared `fetchWithTimeout` helper also schedules a per-request timeout timer
    // (`AKENEO_DEFAULT_REQUEST_TIMEOUT_MS`); delegate that one to the real timer —
    // the helper clears it in its `finally` before the mocked fetch resolves, so
    // it never fires and never pollutes the recorded backoff delays.
    global.setTimeout = ((callback: () => void, ms?: number) => {
      if (ms === AKENEO_DEFAULT_REQUEST_TIMEOUT_MS) {
        return originalSetTimeout(callback, ms)
      }
      capturedDelays.push(typeof ms === 'number' ? ms : 0)
      callback()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof global.setTimeout
  })

  afterEach(() => {
    global.fetch = originalFetch
    global.setTimeout = originalSetTimeout
    if (originalMaxRetries === undefined) delete process.env.OM_INTEGRATION_AKENEO_MAX_RATE_LIMIT_RETRIES
    else process.env.OM_INTEGRATION_AKENEO_MAX_RATE_LIMIT_RETRIES = originalMaxRetries
    if (originalRetryCap === undefined) delete process.env.OM_INTEGRATION_AKENEO_RETRY_AFTER_CAP_MS
    else process.env.OM_INTEGRATION_AKENEO_RETRY_AFTER_CAP_MS = originalRetryCap
    jest.restoreAllMocks()
  })

  it('caps 429 retries and surfaces the existing error shape instead of looping forever', async () => {
    process.env.OM_INTEGRATION_AKENEO_MAX_RATE_LIMIT_RETRIES = '2'
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/api/oauth/v1/token')) return tokenResponse()
      return new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } })
    })

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.listChannels()).rejects.toThrow('Akeneo request failed (429)')

    // 1 token + (maxRetries + 1) request attempts = 1 + 3 = 4 fetches; 2 sleeps.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(capturedDelays).toHaveLength(2)
  })

  it('clamps a hostile retry-after header to the configured ceiling', async () => {
    process.env.OM_INTEGRATION_AKENEO_RETRY_AFTER_CAP_MS = '60000'
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    let listCalls = 0
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/api/oauth/v1/token')) return tokenResponse()
      listCalls += 1
      if (listCalls === 1) {
        // retry-after: ~31 years — must be clamped, not slept verbatim.
        return new Response('', { status: 429, headers: { 'retry-after': '999999999' } })
      }
      return jsonResponse({ _embedded: { items: [{ code: 'web' }] }, _links: {}, items_count: 1 })
    })

    const client = createTestAkeneoClient(validCredentials)
    const channels = await client.listChannels()

    expect(channels).toHaveLength(1)
    expect(capturedDelays).toEqual([60000])
  })

  it('attaches an AbortSignal timeout to authenticated requests', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ _embedded: { items: [] }, _links: {}, items_count: 0 }))

    const client = createTestAkeneoClient(validCredentials)
    await client.listChannels()

    const tokenInit = fetchMock.mock.calls[0][1] as RequestInit
    const requestInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(tokenInit.signal).toBeInstanceOf(AbortSignal)
    expect(requestInit.signal).toBeInstanceOf(AbortSignal)
  })

  it('surfaces the shared-helper FetchTimeoutError when an authenticated request times out (issue #3068)', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(new FetchTimeoutError('https://tenant.cloud.akeneo.com/api/rest/v1/channels', 30_000))

    const client = createTestAkeneoClient(validCredentials)
    await expect(client.listChannels()).rejects.toBeInstanceOf(FetchTimeoutError)
  })
})
