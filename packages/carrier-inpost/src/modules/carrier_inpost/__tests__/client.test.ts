import { resolveBaseUrl, resolveApiToken, resolveOrganizationId, inpostRequest } from '../lib/client'

const PRODUCTION_BASE_URL = 'https://api-shipx-pl.easypack24.net'

describe('resolveBaseUrl', () => {
  it('returns the production default when no override is set', () => {
    expect(resolveBaseUrl({})).toBe(PRODUCTION_BASE_URL)
    expect(resolveBaseUrl({ apiBaseUrl: '' })).toBe(PRODUCTION_BASE_URL)
    expect(resolveBaseUrl({ apiBaseUrl: '   ' })).toBe(PRODUCTION_BASE_URL)
    expect(resolveBaseUrl({ apiBaseUrl: 42 })).toBe(PRODUCTION_BASE_URL)
  })

  it('returns a trimmed override URL without trailing slash', () => {
    expect(resolveBaseUrl({ apiBaseUrl: 'https://sandbox.inpost.pl' })).toBe('https://sandbox.inpost.pl')
    expect(resolveBaseUrl({ apiBaseUrl: 'https://sandbox.inpost.pl/' })).toBe('https://sandbox.inpost.pl')
    expect(resolveBaseUrl({ apiBaseUrl: '  https://sandbox.inpost.pl  ' })).toBe('https://sandbox.inpost.pl')
  })
})

describe('resolveApiToken', () => {
  it('returns a trimmed token from credentials', () => {
    expect(resolveApiToken({ apiToken: 'my-token' })).toBe('my-token')
    expect(resolveApiToken({ apiToken: '  padded  ' })).toBe('padded')
  })

  it('throws when apiToken is missing or empty', () => {
    expect(() => resolveApiToken({})).toThrow('InPost API token is required')
    expect(() => resolveApiToken({ apiToken: '' })).toThrow('InPost API token is required')
    expect(() => resolveApiToken({ apiToken: '   ' })).toThrow('InPost API token is required')
    expect(() => resolveApiToken({ apiToken: 123 })).toThrow('InPost API token is required')
  })
})

describe('resolveOrganizationId', () => {
  it('returns a trimmed org ID from credentials', () => {
    expect(resolveOrganizationId({ organizationId: 'org-abc' })).toBe('org-abc')
    expect(resolveOrganizationId({ organizationId: '  org-abc  ' })).toBe('org-abc')
  })

  it('throws when organizationId is missing or empty', () => {
    expect(() => resolveOrganizationId({})).toThrow('InPost organization ID is required')
    expect(() => resolveOrganizationId({ organizationId: '' })).toThrow('InPost organization ID is required')
    expect(() => resolveOrganizationId({ organizationId: '   ' })).toThrow('InPost organization ID is required')
    expect(() => resolveOrganizationId({ organizationId: null })).toThrow('InPost organization ID is required')
  })
})

describe('inpostRequest', () => {
  const credentials = { apiToken: 'tok', organizationId: 'org-1' }

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('sends GET request with Bearer token and correct headers', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'org-1', name: 'Test' }),
    })
    global.fetch = mockFetch

    const result = await inpostRequest(credentials, '/v1/organizations/org-1')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api-shipx-pl.easypack24.net/v1/organizations/org-1')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(result).toEqual({ id: 'org-1', name: 'Test' })
  })

  it('sends POST request with serialized body', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: 'shp-1', tracking_number: 'TRK001' }),
    })
    global.fetch = mockFetch

    await inpostRequest(credentials, '/v1/organizations/org-1/shipments', {
      method: 'POST',
      body: { service: 'inpost_locker_standard' },
    })

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ service: 'inpost_locker_standard' }))
  })

  it('appends query parameters to the URL', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })
    global.fetch = mockFetch

    await inpostRequest(credentials, '/v1/shipments', {
      query: { page: '2', per_page: '20' },
    })

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('page=2')
    expect(url).toContain('per_page=20')
  })

  it('returns undefined for 204 No Content responses', async () => {
    const jsonMock = jest.fn()
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: jsonMock,
    })
    global.fetch = mockFetch

    const result = await inpostRequest(credentials, '/v1/organizations/org-1/shipments/shp-1', {
      method: 'DELETE',
    })

    expect(result).toBeUndefined()
    expect(jsonMock).not.toHaveBeenCalled()
  })

  it('throws on non-ok responses with status and body', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('Validation failed'),
    })
    global.fetch = mockFetch

    await expect(inpostRequest(credentials, '/v1/organizations/org-1/shipments', { method: 'POST' }))
      .rejects.toThrow('InPost API error 422: Validation failed')
  })

  it('throws on 401 unauthorized', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    global.fetch = mockFetch

    await expect(inpostRequest(credentials, '/v1/organizations/org-1')).rejects.toThrow('InPost API error 401')
  })

  it('uses custom base URL when provided in credentials', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })
    global.fetch = mockFetch

    await inpostRequest(
      { ...credentials, apiBaseUrl: 'https://sandbox.inpost.pl' },
      '/v1/organizations/org-1',
    )

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url.startsWith('https://sandbox.inpost.pl')).toBe(true)
  })

  it('throws when API token is missing', async () => {
    await expect(inpostRequest({ organizationId: 'org-1' }, '/v1/test')).rejects.toThrow(
      'InPost API token is required',
    )
  })

  it('still throws when error body cannot be read', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('stream error')),
    })
    global.fetch = mockFetch

    await expect(inpostRequest(credentials, '/v1/test')).rejects.toThrow('InPost API error 500')
  })
})
