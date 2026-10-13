/** @jest-environment node */
import type { FakeAuthorizationServer } from '@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer'
import { XERO_ENDPOINTS } from '../lib/constants'
import { resolveXeroEndpoints, XeroTestFakesUnavailableError } from '../lib/endpoints'
import { seamFailureResponse } from '../lib/route-errors'
import { startFakeXeroApi, toXeroDotNetDate, type FakeXeroApi, type FakeXeroContact } from '../lib/testing/fakeXeroApi'
import { isSeamClientId, seamRegistry, type XeroSeamFakes } from '../lib/testing/seam'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const TENANT = '996096ec-5362-40dd-be90-3e6a2be09dce'
const OTHER_TENANT = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6'
const VALID_TOKEN = 'valid-token'
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function contact(id: string, updatedAt: string, extra: Partial<FakeXeroContact> = {}): FakeXeroContact {
  return { ContactID: id, Name: `Contact ${id}`, ContactStatus: 'ACTIVE', UpdatedDateUTC: toXeroDotNetDate(new Date(updatedAt)), ...extra }
}

async function get(api: FakeXeroApi, path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${api.url}${path}`, { headers: { authorization: `Bearer ${VALID_TOKEN}`, accept: 'application/json', ...headers } })
  return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, unknown> }
}

describe('fake Xero API', () => {
  let api: FakeXeroApi

  beforeEach(async () => {
    api = await startFakeXeroApi({ isTokenValid: (token) => token === VALID_TOKEN, now: () => new Date('2026-10-13T10:00:00Z') })
    api.seed({
      organisations: [
        { tenantId: TENANT, connectionId: 'conn-1', name: 'Demo Company', authEventId: 'evt-1' },
        { tenantId: OTHER_TENANT, connectionId: 'conn-2', name: 'Second Ltd', authEventId: 'evt-2' },
      ],
      contacts: {
        [TENANT]: [
          contact('c', '2026-10-01T10:00:02Z'),
          contact('b', '2026-10-01T10:00:00Z'),
          contact('a', '2026-10-01T10:00:00Z'),
          contact('d', '2026-10-01T10:00:05Z', { ContactStatus: 'ARCHIVED' }),
        ],
      },
    })
  })

  afterEach(async () => {
    await api.close()
  })

  it('lists contacts by UpdatedDateUTC, then ContactID, with the pagination envelope and quota headers', async () => {
    const response = await get(api, '/api.xro/2.0/Contacts?page=1&pageSize=1000&includeArchived=true', { 'xero-tenant-id': TENANT })
    expect(response.status).toBe(200)
    expect((response.body.Contacts as FakeXeroContact[]).map((entry) => entry.ContactID)).toEqual(['a', 'b', 'c', 'd'])
    expect(response.body.pagination).toEqual({ page: 1, pageSize: 1000, pageCount: 1, itemCount: 4 })
    expect(response.headers.get('x-daylimit-remaining')).toBe('999')
    expect(response.headers.get('x-minlimit-remaining')).toBe('59')
    expect(response.headers.get('date')).toBe('Tue, 13 Oct 2026 10:00:00 GMT')
  })

  it('leaves archived contacts out unless includeArchived=true', async () => {
    const response = await get(api, '/api.xro/2.0/Contacts?page=1&pageSize=1000', { 'xero-tenant-id': TENANT })
    expect((response.body.Contacts as FakeXeroContact[]).map((entry) => entry.ContactID)).toEqual(['a', 'b', 'c'])
  })

  it('pages with pageSize clamped to 1000', async () => {
    const first = await get(api, '/api.xro/2.0/Contacts?page=1&pageSize=2&includeArchived=true', { 'xero-tenant-id': TENANT })
    const second = await get(api, '/api.xro/2.0/Contacts?page=2&pageSize=2&includeArchived=true', { 'xero-tenant-id': TENANT })
    expect((first.body.Contacts as FakeXeroContact[]).map((entry) => entry.ContactID)).toEqual(['a', 'b'])
    expect((second.body.Contacts as FakeXeroContact[]).map((entry) => entry.ContactID)).toEqual(['c', 'd'])
    expect(second.body.pagination).toMatchObject({ page: 2, pageSize: 2, pageCount: 2 })
    const clamped = await get(api, '/api.xro/2.0/Contacts?page=1&pageSize=5000', { 'xero-tenant-id': TENANT })
    expect(clamped.body.pagination).toMatchObject({ pageSize: 1000 })
  })

  it.each([
    ['ISO 8601 with Z', '2026-10-01T10:00:02Z'],
    ['ISO 8601 without Z', '2026-10-01T10:00:02'],
    ['the HTTP date', 'Thu, 01 Oct 2026 10:00:02 GMT'],
  ])('filters by If-Modified-Since in %s, inclusive at the second', async (_label, header) => {
    const response = await get(api, '/api.xro/2.0/Contacts?page=1&includeArchived=true', { 'xero-tenant-id': TENANT, 'if-modified-since': header })
    expect((response.body.Contacts as FakeXeroContact[]).map((entry) => entry.ContactID)).toEqual(['c', 'd'])
  })

  it('rejects a token its callback does not accept, and a tenant outside the connections', async () => {
    const unauthorized = await fetch(`${api.url}/api.xro/2.0/Contacts`, { headers: { authorization: 'Bearer stale', 'xero-tenant-id': TENANT } })
    expect(unauthorized.status).toBe(401)
    const forbidden = await get(api, '/api.xro/2.0/Contacts', { 'xero-tenant-id': 'ffffffff-0000-4000-8000-000000000000' })
    expect(forbidden.status).toBe(403)
  })

  it('lists connection records, filtered by authEventId when given', async () => {
    const all = await fetch(`${api.endpoints.connections}`, { headers: { authorization: `Bearer ${VALID_TOKEN}` } })
    expect(((await all.json()) as Array<{ tenantId: string }>).map((entry) => entry.tenantId)).toEqual([TENANT, OTHER_TENANT])
    const filtered = await fetch(`${api.endpoints.connections}?authEventId=evt-2`, { headers: { authorization: `Bearer ${VALID_TOKEN}` } })
    expect(((await filtered.json()) as Array<{ tenantId: string; tenantName: string }>)).toEqual([
      expect.objectContaining({ tenantId: OTHER_TENANT, tenantName: 'Second Ltd', tenantType: 'ORGANISATION', id: 'conn-2' }),
    ])
  })

  it('answers injected failures with their headers, then recovers', async () => {
    api.inject({ status: 429, path: 'contacts', rateLimitProblem: 'minute', retryAfter: 7, times: 2 })
    const first = await get(api, '/api.xro/2.0/Contacts', { 'xero-tenant-id': TENANT })
    const second = await get(api, '/api.xro/2.0/Contacts', { 'xero-tenant-id': TENANT })
    const third = await get(api, '/api.xro/2.0/Contacts', { 'xero-tenant-id': TENANT })
    expect([first.status, second.status, third.status]).toEqual([429, 429, 200])
    expect(first.headers.get('x-rate-limit-problem')).toBe('minute')
    expect(first.headers.get('retry-after')).toBe('7')
    expect(api.requests().map((request) => request.status)).toEqual([429, 429, 200])
  })

  it('records the tenant and If-Modified-Since of each request and forgets everything on reset', async () => {
    await get(api, '/api.xro/2.0/Contacts?page=1', { 'xero-tenant-id': TENANT, 'if-modified-since': '2026-10-01T10:00:00Z' })
    expect(api.requests()).toEqual([
      { path: 'contacts', query: { page: '1' }, xeroTenantId: TENANT, ifModifiedSince: '2026-10-01T10:00:00Z', status: 200 },
    ])
    api.reset()
    expect(api.requests()).toEqual([])
    const afterReset = await fetch(api.endpoints.connections, { headers: { authorization: `Bearer ${VALID_TOKEN}` } })
    expect(await afterReset.json()).toEqual([])
  })
})

describe('resolveXeroEndpoints and the seam mark', () => {
  const savedFlag = process.env.OM_ENABLE_TEST_OAUTH_GRANTS
  const fakes: XeroSeamFakes = {
    authorizationServer: {
      authorizationEndpoint: 'http://127.0.0.1:41000/authorize',
      tokenEndpoint: 'http://127.0.0.1:41000/token',
      revocationEndpoint: 'http://127.0.0.1:41000/revoke',
    } as FakeAuthorizationServer,
    xeroApi: { endpoints: { connections: 'http://127.0.0.1:42000/connections', accounting: 'http://127.0.0.1:42000/api.xro/2.0' } } as FakeXeroApi,
  }
  const credentialsWith = (clientId: string | null) => ({ resolve: jest.fn(async () => (clientId === null ? null : { clientId, clientSecret: 's' })) })

  afterEach(() => {
    seamRegistry().clear()
    if (savedFlag === undefined) delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    else process.env.OM_ENABLE_TEST_OAUTH_GRANTS = savedFlag
  })

  it("returns Xero's endpoints with the flag off, whatever the Map and the Client ID say", async () => {
    delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    seamRegistry().set(scope.organizationId, fakes)
    const credentialsService = credentialsWith('om_test_seam_abc')
    await expect(resolveXeroEndpoints({ scope, credentialsService })).resolves.toEqual({ ...XERO_ENDPOINTS })
    expect(credentialsService.resolve).not.toHaveBeenCalled()
  })

  it("returns the organization's fakes with the flag on", async () => {
    process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
    seamRegistry().set(scope.organizationId, fakes)
    await expect(resolveXeroEndpoints({ scope, credentialsService: credentialsWith('om_test_seam_abc') })).resolves.toEqual({
      authorize: 'http://127.0.0.1:41000/authorize',
      token: 'http://127.0.0.1:41000/token',
      revoke: 'http://127.0.0.1:41000/revoke',
      connections: 'http://127.0.0.1:42000/connections',
      accounting: 'http://127.0.0.1:42000/api.xro/2.0',
    })
  })

  it('refuses a marked organization whose fakes are not running, instead of falling back to Xero', async () => {
    process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
    seamRegistry().set('another-org', fakes)
    await expect(resolveXeroEndpoints({ scope, credentialsService: credentialsWith('om_test_seam_abc') })).rejects.toBeInstanceOf(
      XeroTestFakesUnavailableError,
    )
  })

  it.each([
    ['a real Client ID', 'ABCDEF0123456789'],
    ['no Client Configuration', null],
  ])("returns Xero's endpoints with the flag on for %s", async (_label, clientId) => {
    process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
    await expect(resolveXeroEndpoints({ scope, credentialsService: credentialsWith(clientId) })).resolves.toEqual({ ...XERO_ENDPOINTS })
  })

  it('recognizes only the seam prefix as the mark', () => {
    expect(isSeamClientId('om_test_seam_0f1e2d')).toBe(true)
    expect(isSeamClientId('7CD86BE39C0B404499BF62F8D90A37B7')).toBe(false)
    expect(isSeamClientId(undefined)).toBe(false)
  })

  it('maps the seam failure to 409 xero.test_fakes_unavailable for the routes', async () => {
    const response = await seamFailureResponse(new XeroTestFakesUnavailableError())
    expect(response?.status).toBe(409)
    expect(await response?.json()).toMatchObject({ code: 'xero.test_fakes_unavailable' })
    await expect(seamFailureResponse(new Error('other'))).resolves.toBeNull()
  })
})
