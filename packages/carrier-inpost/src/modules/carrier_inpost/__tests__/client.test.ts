import Chance from 'chance'
import { resolveBaseUrl, resolveApiToken, resolveOrganizationId, inpostRequest } from '../lib/client'

const chance = new Chance()

const PRODUCTION_BASE_URL = 'https://api-shipx-pl.easypack24.net'

describe('resolveBaseUrl', () => {
  it('returns the production default when no override is set', () => {
    expect(resolveBaseUrl({})).toBe(PRODUCTION_BASE_URL)
    expect(resolveBaseUrl({ apiBaseUrl: '' })).toBe(PRODUCTION_BASE_URL)
    expect(resolveBaseUrl({ apiBaseUrl: '   ' })).toBe(PRODUCTION_BASE_URL)
    expect(resolveBaseUrl({ apiBaseUrl: 42 })).toBe(PRODUCTION_BASE_URL)
  })

  it('returns a trimmed override URL without trailing slash', () => {
    const host = `https://${chance.domain()}`
    expect(resolveBaseUrl({ apiBaseUrl: host })).toBe(host)
    expect(resolveBaseUrl({ apiBaseUrl: `${host}/` })).toBe(host)
    expect(resolveBaseUrl({ apiBaseUrl: `  ${host}  ` })).toBe(host)
  })
})

describe('resolveApiToken', () => {
  it('returns a trimmed token from credentials', () => {
    const token = chance.guid()
    expect(resolveApiToken({ apiToken: token })).toBe(token)
    expect(resolveApiToken({ apiToken: `  ${token}  ` })).toBe(token)
  })

  it('throws when apiToken is missing or empty', () => {
    expect(() => resolveApiToken({})).toThrow('InPost API token is required')
    expect(() => resolveApiToken({ apiToken: '' })).toThrow('InPost API token is required')
    expect(() => resolveApiToken({ apiToken: '   ' })).toThrow('InPost API token is required')
    expect(() => resolveApiToken({ apiToken: chance.integer() })).toThrow('InPost API token is required')
  })

  it('strips a leading Bearer prefix (case-insensitive) stored by users copying from InPost Manager', () => {
    const token = chance.guid()
    expect(resolveApiToken({ apiToken: `Bearer ${token}` })).toBe(token)
    expect(resolveApiToken({ apiToken: `bearer ${token}` })).toBe(token)
    expect(resolveApiToken({ apiToken: `BEARER   ${token}` })).toBe(token)
    expect(resolveApiToken({ apiToken: `  Bearer ${token}  ` })).toBe(token)
  })

  it('throws when the token is only a Bearer prefix with no actual token', () => {
    expect(() => resolveApiToken({ apiToken: 'Bearer ' })).toThrow('InPost API token is required')
    expect(() => resolveApiToken({ apiToken: 'Bearer   ' })).toThrow('InPost API token is required')
  })
})

describe('resolveOrganizationId', () => {
  it('returns a trimmed org ID from credentials', () => {
    const orgId = chance.guid()
    expect(resolveOrganizationId({ organizationId: orgId })).toBe(orgId)
    expect(resolveOrganizationId({ organizationId: `  ${orgId}  ` })).toBe(orgId)
  })

  it('throws when organizationId is missing or empty', () => {
    expect(() => resolveOrganizationId({})).toThrow('InPost organization ID is required')
    expect(() => resolveOrganizationId({ organizationId: '' })).toThrow('InPost organization ID is required')
    expect(() => resolveOrganizationId({ organizationId: '   ' })).toThrow('InPost organization ID is required')
    expect(() => resolveOrganizationId({ organizationId: null })).toThrow('InPost organization ID is required')
  })
})

describe('inpostRequest', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('sends GET request with Bearer token and correct headers', async () => {
    const token = chance.guid()
    const orgId = chance.guid()
    const credentials = { apiToken: token, organizationId: orgId }
    const responseBody = { id: orgId, name: chance.company() }

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseBody),
    })

    const result = await inpostRequest(credentials, `/v1/organizations/${orgId}`)

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PRODUCTION_BASE_URL}/v1/organizations/${orgId}`)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${token}`)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(result).toEqual(responseBody)
  })

  it('sends POST request with serialized body', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }
    const payload = { service: `inpost_${chance.word()}` }

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: chance.guid() }),
    })

    await inpostRequest(credentials, '/v1/organizations/org-1/shipments', {
      method: 'POST',
      body: payload,
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify(payload))
  })

  it('appends query parameters to the URL', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }
    const page = String(chance.integer({ min: 1, max: 10 }))
    const perPage = String(chance.integer({ min: 10, max: 100 }))

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })

    await inpostRequest(credentials, '/v1/shipments', { query: { page, per_page: perPage } })

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string]
    expect(url).toContain(`page=${page}`)
    expect(url).toContain(`per_page=${perPage}`)
  })

  it('returns undefined for 204 No Content responses', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }
    const jsonMock = jest.fn()

    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, json: jsonMock })

    const result = await inpostRequest(credentials, `/v1/organizations/${chance.guid()}/shipments/${chance.guid()}`, {
      method: 'DELETE',
    })

    expect(result).toBeUndefined()
    expect(jsonMock).not.toHaveBeenCalled()
  })

  it('throws on non-ok responses with status and body', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }
    const errorBody = chance.sentence()

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve(errorBody),
    })

    await expect(
      inpostRequest(credentials, '/v1/organizations/org-1/shipments', { method: 'POST' }),
    ).rejects.toThrow(`InPost API error 422: ${errorBody}`)
  })

  it('throws on 401 unauthorized', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })

    await expect(inpostRequest(credentials, '/v1/organizations/org-1')).rejects.toThrow('InPost API error 401')
  })

  it('uses custom base URL when provided in credentials', async () => {
    const customBase = `https://${chance.domain()}`
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid(), apiBaseUrl: customBase }

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })

    await inpostRequest(credentials, '/v1/organizations/org-1')

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string]
    expect(url.startsWith(customBase)).toBe(true)
  })

  it('strips Bearer prefix from credentials before building the Authorization header', async () => {
    const rawToken = chance.guid()
    const credentials = { apiToken: `Bearer ${rawToken}`, organizationId: chance.guid() }

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })

    await inpostRequest(credentials, '/v1/organizations/org-1')

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${rawToken}`)
  })

  it('throws when API token is missing', async () => {
    await expect(
      inpostRequest({ organizationId: chance.guid() }, '/v1/test'),
    ).rejects.toThrow('InPost API token is required')
  })

  it('still throws when error body cannot be read', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('stream error')),
    })

    await expect(inpostRequest(credentials, '/v1/test')).rejects.toThrow('InPost API error 500')
  })
})
