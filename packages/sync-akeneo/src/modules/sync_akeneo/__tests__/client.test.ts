import { createAkeneoClient, encodeAkeneoPathParam, normalizeAkeneoDateTime, sanitizeAkeneoProductNextUrl, validateAkeneoApiUrl } from '../lib/client'

const validCredentials = {
  apiUrl: 'https://tenant.cloud.akeneo.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'api-user',
  password: 'api-password',
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
    expect(createAkeneoClient(validCredentials).credentials.apiUrl).toBe('https://tenant.cloud.akeneo.com')
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

    const client = createAkeneoClient(validCredentials)
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

  it('rejects cross-origin next urls before any authenticated request is sent', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    const client = createAkeneoClient(validCredentials)

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

    const client = createAkeneoClient(validCredentials)
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

    const client = createAkeneoClient(validCredentials)
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

    const client = createAkeneoClient(validCredentials)
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
