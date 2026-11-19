const REVALIDATION_ENV = 'OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS'
const MAX_AGE_ENV = 'OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS'
const PORTAL_EVENT = 'customer_accounts.user.updated'

type PortalAuth = { tenantId: string; orgId: string; sub: string; sid: string }
type PortalTap = (eventName: string, payload: Record<string, unknown>) => Promise<void>
type PendingSettlers = { resolve: (value: PortalAuth | null) => void; reject: (reason: unknown) => void }

const SESSION_A: PortalAuth = { tenantId: 't1', orgId: 'o1', sub: 'c1', sid: 's-a' }
const SESSION_B: PortalAuth = { tenantId: 't1', orgId: 'o1', sub: 'c1', sid: 's-b' }
const COOKIE_A = 'customer_auth_token=jwt-a; customer_session_token=raw-a'
const COOKIE_B = 'customer_auth_token=jwt-b; customer_session_token=raw-b'

const mockRevokedSessionIds = new Set<string>()

function mockResolveByCookie(req: Request): PortalAuth | null {
  const cookie = req.headers.get('cookie') ?? ''
  const auth = cookie.includes('raw-a') ? SESSION_A : cookie.includes('raw-b') ? SESSION_B : null
  if (!auth || mockRevokedSessionIds.has(auth.sid)) return null
  return { ...auth }
}

const mockGetCustomerAuthFromRequest = jest.fn(async (req: Request): Promise<PortalAuth | null> => mockResolveByCookie(req))
let mockPortalTap: PortalTap | undefined
const mockReportError = jest.fn()

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (req: Request) => mockGetCustomerAuthFromRequest(req),
}))

jest.mock('@open-mercato/shared/modules/events', () => ({
  isPortalBroadcastEvent: (eventName: string) => eventName === 'customer_accounts.user.updated',
  isPrivateCrossProcessBroadcastEvent: () => false,
}))

jest.mock('@open-mercato/events/bus', () => ({
  registerGlobalEventTap: (handler: PortalTap) => {
    mockPortalTap = handler
  },
  registerCrossProcessEventListener: () => undefined,
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'portal-revalidation-test-instance',
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

import { GET } from '@open-mercato/core/modules/customer_accounts/api/portal/events/stream'

type StreamReader = ReadableStreamDefaultReader<Uint8Array>

type Collector = {
  frames: string[]
  state: { done: boolean }
  received: (marker: string) => boolean
}

async function flushMicrotasks(rounds = 25): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve()
  }
}

async function waitForPortalTap(): Promise<PortalTap> {
  for (let round = 0; round < 50; round += 1) {
    if (mockPortalTap) return mockPortalTap
    await Promise.resolve()
  }
  throw new Error('[internal] portal event tap was not registered')
}

function makeRequest(cookie: string, extraHeaders: Record<string, string> = {}) {
  const controller = new AbortController()
  const req = new Request('http://localhost/api/customer_accounts/portal/events/stream', {
    headers: { cookie, ...extraHeaders },
    signal: controller.signal,
  })
  return { req, controller }
}

function collect(reader: StreamReader): Collector {
  const frames: string[] = []
  const state = { done: false }
  const decoder = new TextDecoder()
  const pump = async () => {
    for (;;) {
      const result = await reader.read()
      if (result.done) {
        state.done = true
        return
      }
      frames.push(decoder.decode(result.value))
    }
  }
  void pump().catch(() => {
    state.done = true
  })
  return {
    frames,
    state,
    received: (marker: string) => frames.some((frame) => frame.startsWith('data: ') && frame.includes(marker)),
  }
}

async function openStream(cookie: string, extraHeaders: Record<string, string> = {}) {
  const { req, controller } = makeRequest(cookie, extraHeaders)
  const response = await GET(req)
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  const collector = collect(reader)
  await flushMicrotasks()
  expect(collector.frames[0]).toBe(': connected\n\n')
  return { req, controller, reader, collector }
}

async function broadcast(marker: string, extra: Record<string, unknown> = {}): Promise<void> {
  const tap = await waitForPortalTap()
  await tap(PORTAL_EVENT, { tenantId: 't1', organizationId: 'o1', recipientUserId: 'c1', marker, ...extra })
  await flushMicrotasks()
}

async function advance(ms: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms)
  await flushMicrotasks()
}

describe('Portal SSE event stream — session revalidation (#7217)', () => {
  const openReaders: StreamReader[] = []

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    mockRevokedSessionIds.clear()
    mockGetCustomerAuthFromRequest.mockReset()
    mockReportError.mockReset()
    mockGetCustomerAuthFromRequest.mockImplementation(async (req: Request) => mockResolveByCookie(req))
    process.env[REVALIDATION_ENV] = '1000'
    process.env[MAX_AGE_ENV] = '60000'
  })

  afterEach(async () => {
    for (const reader of openReaders.splice(0)) {
      await reader.cancel().catch(() => undefined)
    }
    delete process.env[REVALIDATION_ENV]
    delete process.env[MAX_AGE_ENV]
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('closes the stream of a revoked session and stops delivering to it, while a sibling session keeps receiving', async () => {
    const streamA = await openStream(COOKIE_A)
    const streamB = await openStream(COOKIE_B)
    openReaders.push(streamA.reader, streamB.reader)

    await broadcast('before-revoke')
    expect(streamA.collector.received('before-revoke')).toBe(true)
    expect(streamB.collector.received('before-revoke')).toBe(true)

    mockRevokedSessionIds.add(SESSION_A.sid)
    await advance(1000)
    await broadcast('after-revoke')

    expect(streamA.collector.received('after-revoke')).toBe(false)
    expect(streamB.collector.received('after-revoke')).toBe(true)
    expect(streamA.collector.state.done).toBe(true)
    expect(streamB.collector.state.done).toBe(false)
    const revalidationCookies = mockGetCustomerAuthFromRequest.mock.calls
      .slice(2)
      .map(([request]) => request.headers.get('cookie'))
    expect(revalidationCookies).toEqual(expect.arrayContaining([COOKIE_A, COOKIE_B]))
  })

  it('keeps an active session open across intervals and re-checks it every interval', async () => {
    const stream = await openStream(COOKIE_A)
    openReaders.push(stream.reader)

    await advance(1000)
    await advance(1000)
    await advance(1000)

    expect(mockGetCustomerAuthFromRequest).toHaveBeenCalledTimes(4)
    expect(stream.collector.state.done).toBe(false)
    await broadcast('still-active')
    expect(stream.collector.received('still-active')).toBe(true)
  })

  it.each([
    ['a different session id', { sid: 's-other' }],
    ['a different organization', { orgId: 'o2' }],
    ['a different customer user', { sub: 'c2' }],
    ['a different tenant', { tenantId: 't2' }],
  ])('closes when revalidation resolves %s', async (_label, drift) => {
    const stream = await openStream(COOKIE_A)
    openReaders.push(stream.reader)

    mockGetCustomerAuthFromRequest.mockImplementation(async () => ({ ...SESSION_A, ...drift }))
    await advance(1000)

    expect(stream.collector.state.done).toBe(true)
    await broadcast('after-drift', { tenantId: 't1', organizationId: 'o1' })
    expect(stream.collector.received('after-drift')).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('fails closed when revalidation throws', async () => {
    const stream = await openStream(COOKIE_A)
    openReaders.push(stream.reader)

    const failure = new Error('[internal] database unavailable')
    mockGetCustomerAuthFromRequest.mockRejectedValue(failure)
    await advance(1000)

    expect(stream.collector.state.done).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'customer_accounts',
      code: 'customer_accounts.portal_sse_revalidation_failed',
    })
  })

  it('revalidates with a distinct request that carries the original credentials', async () => {
    const stream = await openStream(COOKIE_A, { authorization: 'Bearer jwt-a' })
    openReaders.push(stream.reader)

    await advance(1000)

    expect(mockGetCustomerAuthFromRequest).toHaveBeenCalledTimes(2)
    const initialRequest = mockGetCustomerAuthFromRequest.mock.calls[0][0]
    const revalidationRequest = mockGetCustomerAuthFromRequest.mock.calls[1][0]
    expect(initialRequest).toBe(stream.req)
    expect(revalidationRequest).not.toBe(stream.req)
    expect(revalidationRequest.headers.get('cookie')).toBe(COOKIE_A)
    expect(revalidationRequest.headers.get('authorization')).toBe('Bearer jwt-a')
  })

  it('closes a still-valid stream at its maximum age and releases every timer', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    process.env[REVALIDATION_ENV] = '999999'
    process.env[MAX_AGE_ENV] = '5000'
    const stream = await openStream(COOKIE_A)
    openReaders.push(stream.reader)

    await advance(4999)
    expect(stream.collector.state.done).toBe(false)
    await advance(1)

    expect(stream.collector.state.done).toBe(true)
    expect(mockGetCustomerAuthFromRequest).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('does not start a second revalidation while one is still in flight', async () => {
    const stream = await openStream(COOKIE_A)
    openReaders.push(stream.reader)

    let releasePending: (value: PortalAuth | null) => void = () => undefined
    mockGetCustomerAuthFromRequest.mockImplementationOnce(
      () => new Promise<PortalAuth | null>((resolve) => {
        releasePending = resolve
      }),
    )
    await advance(1000)
    await advance(1000)
    await advance(1000)
    expect(mockGetCustomerAuthFromRequest).toHaveBeenCalledTimes(2)

    releasePending({ ...SESSION_A })
    await flushMicrotasks()
    await advance(1000)
    expect(mockGetCustomerAuthFromRequest).toHaveBeenCalledTimes(3)
    expect(stream.collector.state.done).toBe(false)
  })

  it.each([
    ['resolves null', (settle: PendingSettlers) => settle.resolve(null)],
    ['rejects', (settle: PendingSettlers) => settle.reject(new Error('[internal] late failure'))],
  ])('stays closed when the client cancels while a revalidation is pending and it later %s', async (_label, settlePending) => {
    const stream = await openStream(COOKIE_A)

    const settlers: PendingSettlers = { resolve: () => undefined, reject: () => undefined }
    mockGetCustomerAuthFromRequest.mockImplementationOnce(
      () => new Promise<PortalAuth | null>((resolve, reject) => {
        settlers.resolve = resolve
        settlers.reject = reject
      }),
    )
    await advance(1000)
    expect(mockGetCustomerAuthFromRequest).toHaveBeenCalledTimes(2)

    await stream.reader.cancel()
    await flushMicrotasks()
    expect(stream.collector.state.done).toBe(true)
    expect(jest.getTimerCount()).toBe(0)

    expect(() => settlePending(settlers)).not.toThrow()
    await flushMicrotasks()
    await advance(5000)

    await broadcast('after-cancel')
    expect(stream.collector.received('after-cancel')).toBe(false)
    expect(stream.collector.state.done).toBe(true)
    expect(mockGetCustomerAuthFromRequest).toHaveBeenCalledTimes(2)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('never registers a request that was aborted before the stream opened', async () => {
    const { req, controller } = makeRequest(COOKIE_A)
    controller.abort()

    const response = await GET(req)
    const collector = collect(response.body!.getReader())
    await flushMicrotasks()

    expect(collector.state.done).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
    await broadcast('after-abort')
    expect(collector.received('after-abort')).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
  })
})
