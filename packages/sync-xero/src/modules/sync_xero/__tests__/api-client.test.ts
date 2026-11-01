import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { createXeroApiClient, type XeroClientBudget } from '../lib/api-client'
import { XERO_ENDPOINTS } from '../lib/constants'
import { createXeroDescriptor } from '../lib/descriptor'
import { XeroApiError } from '../lib/errors'
import { buildXeroGrantOwner } from '../lib/owner'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { startStubHttpServer, type StubHttpServer, type StubRequest, type StubResponse } from './support/stubHttpServer'

const XERO_TENANT = '996096ec-5362-40dd-be90-3e6a2be09dce'
const PROVIDER_DATA = {
  xeroOrganisationId: XERO_TENANT,
  xeroConnectionId: '6a3b2c1d-0000-4000-8000-000000000001',
  xeroOrganisationName: 'Demo Company (Global)',
}

type Harness = {
  server: StubHttpServer
  grants: FakeGrantService
  waits: number[]
  client: ReturnType<typeof createXeroApiClient>
  contactsUrl: string
}

const servers: StubHttpServer[] = []

async function setup(
  handler: (request: StubRequest) => StubResponse,
  options: { budget?: XeroClientBudget; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Harness> {
  const server = await startStubHttpServer(handler)
  servers.push(server)
  const grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
  const waits: number[] = []
  let clock = Date.parse('2026-10-13T10:00:00Z')
  const client = createXeroApiClient({
    grantService: grants.service,
    descriptor: createXeroDescriptor(XERO_ENDPOINTS),
    owner: buildXeroGrantOwner({ tenantId: 'tenant-1', organizationId: 'org-1' }),
    endpoints: { connections: `${server.url}/connections`, accounting: `${server.url}/api.xro/2.0` },
    budget: options.budget ?? 'run',
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    sleep: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    now: () => clock,
  })
  return { server, grants, waits, client, contactsUrl: `${server.url}/api.xro/2.0/Contacts?page=1` }
}

function accountingRequests(harness: Harness): StubRequest[] {
  return harness.server.requests.filter((request) => request.path.startsWith('/api.xro'))
}

async function expectXeroError(promise: Promise<unknown>, code: string, status?: number | null): Promise<XeroApiError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(XeroApiError)
  const xeroError = error as XeroApiError
  expect(xeroError.code).toBe(code)
  if (status !== undefined) expect(xeroError.status).toBe(status)
  return xeroError
}

function brokenBodyResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('[{"ContactID":'))
      controller.error(new TypeError('terminated'))
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
  jest.restoreAllMocks()
})

describe('Xero API client — successful responses', () => {
  it('sends the bearer token, JSON accept, tenant and If-Modified-Since headers and reports quota and Date', async () => {
    const harness = await setup(() => ({
      status: 200,
      headers: {
        'x-daylimit-remaining': '999',
        'x-minlimit-remaining': '59',
        'x-appminlimit-remaining': '9995',
        date: 'Tue, 13 Oct 2026 10:00:05 GMT',
      },
      body: { Contacts: [] },
    }))

    const response = await harness.client.request({
      url: harness.contactsUrl,
      xeroTenantId: XERO_TENANT,
      ifModifiedSince: new Date('2026-10-13T09:59:59.500Z'),
    })

    const [sent] = harness.server.requests
    expect(sent.headers.authorization).toBe(`Bearer ${harness.grants.state.accessToken}`)
    expect(sent.headers.accept).toBe('application/json')
    expect(sent.headers['xero-tenant-id']).toBe(XERO_TENANT)
    expect(sent.headers['if-modified-since']).toBe('2026-10-13T09:59:59Z')
    expect(response.body).toEqual({ Contacts: [] })
    expect(response.quota).toEqual({ dayRemaining: 999, minuteRemaining: 59, appMinuteRemaining: 9995 })
    expect(response.date?.toISOString()).toBe('2026-10-13T10:00:05.000Z')
    expect(response.providerData).toEqual(PROVIDER_DATA)
    expect(harness.waits).toEqual([])
  })

  it('asks the grant service for a token before every request', async () => {
    const harness = await setup(() => ({ status: 200, body: {} }))
    await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    expect(harness.grants.calls.filter((call) => call.method === 'getAccessToken')).toHaveLength(2)
  })

  it('paces the next request until the minute window resets after X-MinLimit-Remaining 0', async () => {
    let call = 0
    const harness = await setup((): StubResponse => {
      call += 1
      if (call === 1) return { status: 200, headers: { 'x-minlimit-remaining': '0' }, body: {} }
      if (call === 2) return { status: 200, headers: { 'x-minlimit-remaining': '0', 'retry-after': '7' }, body: {} }
      return { status: 200, headers: { 'x-minlimit-remaining': '42' }, body: {} }
    })
    await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    expect(harness.waits).toEqual([])
    await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    expect(harness.waits).toEqual([60_000])
    await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    expect(harness.waits).toEqual([60_000, 7_000])
  })
})

describe('Xero API client — 401 and 403', () => {
  it('retries a 401 once with the rejected token', async () => {
    let call = 0
    const harness = await setup(() => {
      call += 1
      return call === 1 ? { status: 401 } : { status: 200, body: { ok: true } }
    })
    const firstToken = harness.grants.state.accessToken

    const response = await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })

    expect(response.body).toEqual({ ok: true })
    const tokenCalls = harness.grants.calls.filter((entry) => entry.method === 'getAccessToken')
    expect(tokenCalls).toHaveLength(2)
    expect(tokenCalls[1].options).toEqual({ rejectedAccessToken: firstToken })
    expect(harness.server.requests[1].headers.authorization).toBe(`Bearer ${harness.grants.state.accessToken}`)
    expect(harness.grants.state.accessToken).not.toBe(firstToken)
  })

  it('reports unauthorized after a second 401', async () => {
    const harness = await setup(() => ({ status: 401 }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'unauthorized', 401)
    expect(harness.server.requests).toHaveLength(2)
  })

  it.each([
    ['the misspelled token Xero documents', 'insufficent_scope'],
    ['the bare token Xero sends', 'insufficient_scope'],
    ['a Bearer challenge', 'Bearer error="insufficient_scope"'],
  ])('classifies insufficient scope from %s without refreshing', async (_label, header) => {
    const harness = await setup(() => ({ status: 401, headers: { 'www-authenticate': header } }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'scope_insufficient', 401)
    expect(harness.server.requests).toHaveLength(1)
    expect(harness.grants.calls.filter((entry) => entry.method === 'getAccessToken')).toHaveLength(1)
  })

  it('reports organisation_not_authorised when a 403 Organisation is gone from /connections', async () => {
    const harness = await setup((request) =>
      request.path === '/connections' ? { status: 200, body: [] } : { status: 403, body: { Detail: 'AuthenticationUnsuccessful' } },
    )
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'organisation_not_authorised', 403)
    expect(harness.server.requests.map((request) => request.path)).toEqual(['/api.xro/2.0/Contacts', '/connections'])
  })

  it('reports forbidden when the 403 Organisation is still connected', async () => {
    const harness = await setup((request) =>
      request.path === '/connections'
        ? { status: 200, body: [{ id: 'c-1', tenantId: XERO_TENANT, tenantType: 'ORGANISATION', tenantName: 'Demo Company' }] }
        : { status: 403 },
    )
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'forbidden', 403)
  })

  it('reports forbidden for a 403 outside an Accounting call', async () => {
    const harness = await setup(() => ({ status: 403 }))
    await expectXeroError(harness.client.listConnections(), 'forbidden', 403)
    expect(harness.server.requests).toHaveLength(1)
  })
})

describe('Xero API client — 429', () => {
  it.each(['minute', 'appminute'])('waits out a %s limit for Retry-After and retries', async (problem) => {
    let call = 0
    const harness = await setup(() => {
      call += 1
      return call === 1
        ? { status: 429, headers: { 'x-rate-limit-problem': problem, 'retry-after': '3' } }
        : { status: 200, body: { ok: true } }
    })
    const response = await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    expect(response.body).toEqual({ ok: true })
    expect(harness.waits).toEqual([3_000])
  })

  it('caps the wait at 60 s and gives up as transient after five waits', async () => {
    const harness = await setup(() => ({ status: 429, headers: { 'x-rate-limit-problem': 'minute', 'retry-after': '120' } }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'transient', 429)
    expect(harness.waits).toEqual([60_000, 60_000, 60_000, 60_000, 60_000])
    expect(harness.server.requests).toHaveLength(6)
  })

  it('stops on the daily limit without retrying', async () => {
    const harness = await setup(() => ({ status: 429, headers: { 'x-rate-limit-problem': 'day', 'retry-after': '40000' } }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'daily_limit', 429)
    expect(harness.waits).toEqual([])
    expect(harness.server.requests).toHaveLength(1)
  })

  it('treats a 429 without a problem header and a long Retry-After as the daily limit', async () => {
    const harness = await setup(() => ({ status: 429, headers: { 'retry-after': '3600' } }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'daily_limit', 429)
  })

  it('answers a minute limit at once within the interactive budget', async () => {
    const harness = await setup(() => ({ status: 429, headers: { 'x-rate-limit-problem': 'minute', 'retry-after': '3' } }), {
      budget: 'interactive',
    })
    await expectXeroError(harness.client.listConnections(), 'rate_limited', 429)
    expect(harness.waits).toEqual([])
  })
})

describe('Xero API client — server and network errors', () => {
  it('backs off 1 s and 2 s before succeeding', async () => {
    let call = 0
    const harness = await setup(() => {
      call += 1
      if (call === 1) return { status: 503 }
      if (call === 2) return { status: 502 }
      return { status: 200, body: { ok: true } }
    })
    const response = await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    expect(response.body).toEqual({ ok: true })
    expect(harness.waits).toEqual([1_000, 2_000])
  })

  it('reports transient after three retries', async () => {
    const harness = await setup(() => ({ status: 500 }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'transient', 500)
    expect(harness.waits).toEqual([1_000, 2_000, 4_000])
    expect(harness.server.requests).toHaveLength(4)
  })

  it('makes one attempt within the interactive budget', async () => {
    const harness = await setup(() => ({ status: 500 }), { budget: 'interactive' })
    await expectXeroError(harness.client.listConnections(), 'transient', 500)
    expect(harness.server.requests).toHaveLength(1)
  })

  it('retries a network failure and then reports transient', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const harness = await setup(() => ({ status: 200 }), { fetchImpl })
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'transient', null)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(harness.waits).toEqual([1_000, 2_000, 4_000])
  })

  it('retries a body that breaks off after the headers, then reports transient', async () => {
    const fetchImpl = jest.fn(async () => brokenBodyResponse()) as unknown as typeof fetch
    const harness = await setup(() => ({ status: 200 }), { fetchImpl })
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'transient', null)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(harness.waits).toEqual([1_000, 2_000, 4_000])
  })

  it('returns the body of the retry after a broken one', async () => {
    let call = 0
    const fetchImpl = jest.fn(async () => {
      call += 1
      return call === 1 ? brokenBodyResponse() : Response.json([{ ContactID: 'c-1' }])
    }) as unknown as typeof fetch
    const harness = await setup(() => ({ status: 200 }), { fetchImpl })
    const response = await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })
    expect(response.body).toEqual([{ ContactID: 'c-1' }])
    expect(harness.waits).toEqual([1_000])
  })

  it('reports a broken body as transient at once within the interactive budget', async () => {
    const fetchImpl = jest.fn(async () => brokenBodyResponse()) as unknown as typeof fetch
    const harness = await setup(() => ({ status: 200 }), { budget: 'interactive', fetchImpl })
    await expectXeroError(harness.client.listConnections(), 'transient', null)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("rethrows the caller's abort while the body is read", async () => {
    const controller = new AbortController()
    const fetchImpl = jest.fn(async () => new Response(new ReadableStream({
      pull(stream) {
        controller.abort(new Error('cancelled by the run'))
        stream.error(new DOMException('The operation was aborted', 'AbortError'))
      },
    }), { status: 200 })) as unknown as typeof fetch
    const harness = await setup(() => ({ status: 200 }), { fetchImpl, signal: controller.signal })
    await expect(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })).rejects.not.toBeInstanceOf(XeroApiError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(harness.waits).toEqual([])
  })

  it("rethrows the caller's abort instead of retrying", async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled by the run'))
    const harness = await setup(() => ({ status: 200 }), { signal: controller.signal })
    await expect(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT })).rejects.not.toBeInstanceOf(XeroApiError)
    expect(harness.waits).toEqual([])
  })

  it('uses a 30 s timeout for runs and 5 s for interactive calls', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
    const run = await setup(() => ({ status: 200, body: [] }))
    await run.client.listConnections()
    const interactive = await setup(() => ({ status: 200, body: [] }), { budget: 'interactive' })
    await interactive.client.listConnections()
    expect(timeoutSpy.mock.calls.map(([ms]) => ms)).toEqual([30_000, 5_000])
  })
})

describe('Xero API client — other failures', () => {
  it('passes a token failure from the grant service through unchanged', async () => {
    const harness = await setup(() => ({ status: 200 }))
    harness.grants.failNext('getAccessToken', 'grant_invalidated', { reason: 'grant_rejected' })
    const error = await harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(OAuthGrantError)
    expect((error as OAuthGrantError).code).toBe('grant_invalidated')
    expect(harness.server.requests).toHaveLength(0)
  })

  it('rejects another 4xx with its status only, never the body', async () => {
    const harness = await setup(() => ({ status: 400, body: { Message: 'Contact Jane Doe jane@example.com is invalid' } }))
    const error = await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'request_rejected', 400)
    expect(error.message).not.toContain('Jane')
    expect(JSON.stringify(error)).not.toContain('jane@example.com')
    expect(accountingRequests(harness)).toHaveLength(1)
  })

  it('refuses to send the bearer token to a URL outside the configured Xero endpoints', async () => {
    const harness = await setup(() => ({ status: 200, body: [] }))
    await expect(harness.client.request({ url: 'https://example.com/api.xro/2.0/Contacts' })).rejects.toThrow(TypeError)
    expect(harness.server.requests).toHaveLength(0)
  })

  it('does not follow redirects', async () => {
    const harness = await setup(() => ({ status: 302, headers: { location: 'https://example.com/elsewhere' } }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'request_rejected', 302)
    expect(harness.server.requests).toHaveLength(1)
  })

  it('treats a 2xx body that is not JSON as transient', async () => {
    const harness = await setup(() => ({ status: 200, body: '<Response>xml</Response>' }))
    await expectXeroError(harness.client.request({ url: harness.contactsUrl, xeroTenantId: XERO_TENANT }), 'transient', 200)
  })
})
