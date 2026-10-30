type MockAuth = {
  tenantId: string | null
  sub: string
  orgId: string | null
  roles: string[]
  isApiKey?: boolean
  isSuperAdmin?: boolean
}

type MockOrganizationScope = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
  tenantId: string | null
  selectionRejected?: boolean
}

type MockOrganizationScopeInput = {
  auth: MockAuth | null | undefined
  request?: Request
}

const mockResolveOrganizationScopeForRequest = jest.fn(
  async ({ auth }: MockOrganizationScopeInput): Promise<MockOrganizationScope> => {
    const selectedId = auth?.orgId ?? null
    return {
      selectedId,
      filterIds: selectedId ? [selectedId] : null,
      allowedIds: selectedId ? [selectedId] : null,
      tenantId: auth?.tenantId ?? null,
    }
  },
)

function buildResolvedContext(auth: MockAuth | null = {
  tenantId: 't1',
  sub: 'u1',
  orgId: 'o1',
  roles: ['admin'],
}) {
  return {
    ctx: {
      auth,
      container: {
        resolve(name: string) {
          if (name !== 'organizationScopeService') throw new Error(`Unexpected service: ${name}`)
          return { resolveForRequest: mockResolveOrganizationScopeForRequest }
        },
      },
    },
  }
}

const mockResolveRequestContext = jest.fn(async () => buildResolvedContext())

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: (...args: unknown[]) => mockResolveRequestContext(...args),
}))

type EmitOptions = {
  tenantId?: string | null
  organizationId?: string | null
  organizationIds?: string[] | null
}

type GlobalEventTap = (
  eventName: string,
  payload: Record<string, unknown>,
  options?: EmitOptions,
) => void | Promise<void>

let mockGlobalEventTap: GlobalEventTap | undefined

const registerGlobalEventTapMock = jest.fn((handler: GlobalEventTap) => {
  mockGlobalEventTap = handler
})
const registerCrossProcessEventListenerMock = jest.fn()

jest.mock('../../../../../bus', () => ({
  registerGlobalEventTap: (handler: GlobalEventTap) => registerGlobalEventTapMock(handler),
  registerCrossProcessEventListener: (...args: unknown[]) => registerCrossProcessEventListenerMock(...args),
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'web-instance',
}))

import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { GET } from '@open-mercato/events/modules/events/api/stream/route'

createModuleEvents({
  moduleId: 'stream_privacy_test',
  events: [
    {
      id: 'stream_privacy_test.browser',
      label: 'Browser event',
      clientBroadcast: true,
    },
    {
      id: 'stream_privacy_test.private',
      label: 'Private cross-process invalidation',
      crossProcessBroadcast: true,
    },
  ] as const,
})

// req.signal is a linked/derived signal in Node, so we spy AFTER the
// Request is constructed to intercept the handler's real calls.
function makeTrackedRequest(init: RequestInit = {}) {
  const controller = new AbortController()
  const req = new Request('http://localhost/api/events/stream', { ...init, signal: controller.signal })
  const addSpy = jest.spyOn(req.signal, 'addEventListener')
  const removeSpy = jest.spyOn(req.signal, 'removeEventListener')
  return { req, controller, addSpy, removeSpy }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('SSE event stream — abort listener hygiene', () => {
  beforeEach(() => {
    mockResolveRequestContext.mockReset()
    mockResolveRequestContext.mockResolvedValue(buildResolvedContext())
    mockResolveOrganizationScopeForRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockImplementation(async ({ auth }: MockOrganizationScopeInput) => {
      const selectedId = auth?.orgId ?? null
      return {
        selectedId,
        filterIds: selectedId ? [selectedId] : null,
        allowedIds: selectedId ? [selectedId] : null,
        tenantId: auth?.tenantId ?? null,
      }
    })
    delete process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS
    delete process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    jest.useRealTimers()
    delete process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS
    delete process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS
    jest.restoreAllMocks()
  })

  it.each([
    ['x-api-key', { 'x-api-key': 'key-secret', cookie: 'auth_token=staff-token' }],
    ['Authorization ApiKey', { authorization: 'aPiKeY key-secret', cookie: 'auth_token=staff-token' }],
  ])('rejects %s credentials before resolving request context', async (_credential, headers) => {
    const { req, addSpy } = makeTrackedRequest({ headers })

    const response = await GET(req)

    expect(response.status).toBe(401)
    expect(mockResolveRequestContext).not.toHaveBeenCalled()
    expect(addSpy).not.toHaveBeenCalled()
  })

  it('rejects an API-key trusted context even when raw API-key headers are absent', async () => {
    mockResolveRequestContext.mockResolvedValue(buildResolvedContext({
      tenantId: 't1',
      sub: 'api_key:key-1',
      orgId: 'o1',
      roles: ['admin'],
      isApiKey: true,
    }))
    const { req, addSpy } = makeTrackedRequest()

    const response = await GET(req)

    expect(response.status).toBe(401)
    expect(mockResolveRequestContext).toHaveBeenCalledTimes(1)
    expect(addSpy).not.toHaveBeenCalled()
  })

  it('rejects a selected organization that the canonical DI scope does not allow', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'o2',
      filterIds: ['o1'],
      allowedIds: ['o1'],
      tenantId: 't1',
    })
    const { req, addSpy } = makeTrackedRequest({
      headers: { cookie: 'auth_token=staff-token; om_selected_org=o2' },
    })

    const response = await GET(req)

    expect(response.status).toBe(401)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith({
      auth: expect.objectContaining({ sub: 'u1' }),
      request: req,
    })
    expect(addSpy).not.toHaveBeenCalled()
  })

  it('rejects an initial scope whose normalized tenant differs from canonical auth without registering it', async () => {
    mockResolveRequestContext.mockResolvedValue(buildResolvedContext({
      tenantId: ' t1 ',
      sub: 'u1',
      orgId: 'o1',
      roles: ['admin'],
    }))
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'o1',
      filterIds: ['o1'],
      allowedIds: ['o1'],
      tenantId: ' t2 ',
    })
    const enqueueSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
    const { req, addSpy } = makeTrackedRequest()

    const response = await GET(req)

    expect(response.status).toBe(401)
    expect(registerGlobalEventTapMock).not.toHaveBeenCalled()
    expect(enqueueSpy).not.toHaveBeenCalled()
    expect(addSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['staff cookie', { cookie: 'auth_token=cookie-token; om_selected_org=o1' }],
    ['staff Bearer token', { authorization: 'Bearer bearer-token' }],
  ])('copies %s credentials into a distinct canonical revalidation request', async (_credential, headers) => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const { req } = makeTrackedRequest({ headers })
    const trustedContextSymbol = Symbol.for('open-mercato.auth.trustedContext')
    ;(req as unknown as Record<symbol, unknown>)[trustedContextSymbol] = { auth: { sub: 'stale' } }
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    await jest.advanceTimersByTimeAsync(1000)

    expect(mockResolveRequestContext).toHaveBeenCalledTimes(2)
    const validationRequest = mockResolveRequestContext.mock.calls[1][0] as Request
    expect(validationRequest).not.toBe(req)
    expect(validationRequest.headers.get('cookie')).toBe(req.headers.get('cookie'))
    expect(validationRequest.headers.get('authorization')).toBe(req.headers.get('authorization'))
    expect((validationRequest as unknown as Record<symbol, unknown>)[trustedContextSymbol]).toBeUndefined()
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledTimes(2)
    expect(mockResolveOrganizationScopeForRequest.mock.calls[1][0]).toEqual({
      auth: expect.objectContaining({ sub: 'u1' }),
      request: validationRequest,
    })
    await reader.cancel()
  })

  it('registers the abort listener with { once: true }', async () => {
    const { req, addSpy } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const abortCalls = addSpy.mock.calls.filter((call) => call[0] === 'abort')
    expect(abortCalls).toHaveLength(1)
    expect(abortCalls[0][2]).toMatchObject({ once: true })

    try { await (res.body as ReadableStream).cancel() } catch {}
  })

  it('detaches the abort listener when the stream is cancelled', async () => {
    const { req, addSpy, removeSpy } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const abortAdd = addSpy.mock.calls.find((call) => call[0] === 'abort')
    const attachedListener = abortAdd![1]

    await (res.body as ReadableStream).cancel()

    const abortRemove = removeSpy.mock.calls.find((call) => call[0] === 'abort' && call[1] === attachedListener)
    expect(abortRemove).toBeDefined()
  })

  it('detaches the abort listener when the request aborts', async () => {
    const { req, controller, addSpy, removeSpy } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

    controller.abort()
    await new Promise((resolve) => setImmediate(resolve))

    const abortRemove = removeSpy.mock.calls.find((call) => call[0] === 'abort' && call[1] === attachedListener)
    expect(abortRemove).toBeDefined()

    try { await (res.body as ReadableStream).cancel() } catch {}
  })

  it('fully cleans up an already-aborted request without registering a live connection', async () => {
    jest.useFakeTimers()
    const enqueueSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
    const closeSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'close')
    const { req, controller, addSpy, removeSpy } = makeTrackedRequest()
    controller.abort()

    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    const enqueueCountAfterClose = enqueueSpy.mock.calls.length

    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'must-not-arrive' },
    )

    expect(enqueueSpy).toHaveBeenCalledTimes(enqueueCountAfterClose)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(addSpy.mock.calls.filter((call) => call[0] === 'abort')).toHaveLength(1)
    expect(removeSpy.mock.calls.filter((call) => call[0] === 'abort')).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('flushes an initial connected comment so EventSource opens immediately', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toBe(': connected\n\n')

    try { await reader.cancel() } catch {}
  })

  it('sends a heartbeat message that EventSource delivers to the client watchdog', async () => {
    jest.useFakeTimers()
    const { req } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    try {
      await reader.read()
      jest.advanceTimersByTime(30_000)
      const { value } = await reader.read()
      const frame = new TextDecoder().decode(value)
      expect(frame).toBe(':heartbeat\ndata: :heartbeat\n\n')
      expect(frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n')).toBe(':heartbeat')
    } finally {
      await reader.cancel()
      jest.useRealTimers()
    }
  })

  it('uses trusted organization scope when the payload omits it', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    expect(mockGlobalEventTap).toBeDefined()
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', marker: 'must-not-arrive' },
      { tenantId: 't1', organizationId: 'o2' },
    )
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', marker: 'expected' },
      { tenantId: 't1', organizationId: 'o1' },
    )

    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toContain('"marker":"expected"')

    try { await reader.cancel() } catch {}
  })

  it('still receives home-organization events when "All organizations" is selected', async () => {
    // An unrestricted admin's organization switcher persists `om_selected_org=__all__`,
    // so the resolved scope has NO concrete `selectedId`. Deriving the connection's
    // organization from `selectedId` alone leaves it null, and `matchesAudience`
    // then drops every organization-scoped event — the bridge goes silent on the
    // default selection (TC-WF-059).
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 't1',
    })
    const { req } = makeTrackedRequest({
      headers: { cookie: 'auth_token=staff-token; om_selected_org=__all__' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', marker: 'all-orgs-expected' },
      { tenantId: 't1', organizationId: 'o1' },
    )

    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toContain('"marker":"all-orgs-expected"')

    try { await reader.cancel() } catch {}
  })

  it('resolves ordinary multi-org staff scope through DI when replacing an O1 stream with O2', async () => {
    const enqueueSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
    const ordinaryStaffAuth: MockAuth = {
      tenantId: 't1',
      sub: 'u1',
      orgId: 'o1',
      roles: ['staff'],
      isSuperAdmin: false,
    }
    mockResolveRequestContext.mockResolvedValue(buildResolvedContext(ordinaryStaffAuth))
    mockResolveOrganizationScopeForRequest.mockImplementation(async ({ auth, request }: MockOrganizationScopeInput) => {
      const cookie = request?.headers.get('cookie') ?? ''
      const requestedId = cookie.includes('om_selected_org=o2') ? 'o2' : 'o1'
      const allowedIds = ['o1', 'o2']
      return {
        selectedId: allowedIds.includes(requestedId) ? requestedId : 'o1',
        filterIds: [requestedId],
        allowedIds,
        tenantId: auth?.tenantId ?? null,
        ...(allowedIds.includes(requestedId) ? {} : { selectionRejected: true }),
      }
    })
    const { req: openingRequest } = makeTrackedRequest({
      headers: { cookie: 'auth_token=staff-token; om_selected_org=o1' },
    })
    const openingResponse = await GET(openingRequest)
    const openingReader = openingResponse.body!.getReader()
    await openingReader.read()
    await openingReader.cancel()
    const enqueueCountAfterOpeningClose = enqueueSpy.mock.calls.length

    const { req: replacementRequest } = makeTrackedRequest({
      headers: { cookie: 'auth_token=staff-token; om_selected_org=o2' },
    })
    const replacementResponse = await GET(replacementRequest)
    const replacementReader = replacementResponse.body!.getReader()
    await replacementReader.read()

    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'closed-opening-scope' },
    )
    expect(enqueueSpy).toHaveBeenCalledTimes(enqueueCountAfterOpeningClose + 1)
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o2', marker: 'current-request-scope' },
    )

    const delivered = await replacementReader.read()
    const decoded = new TextDecoder().decode(delivered.value)
    expect(decoded).toContain('current-request-scope')
    expect(decoded).not.toContain('closed-opening-scope')
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenNthCalledWith(1, {
      auth: ordinaryStaffAuth,
      request: openingRequest,
    })
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenNthCalledWith(2, {
      auth: ordinaryStaffAuth,
      request: replacementRequest,
    })
    await replacementReader.cancel()
  })

  it('honors a trusted multi-organization audience for a clientBroadcast event', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    expect(mockGlobalEventTap).toBeDefined()
    // Connection is scoped to org o1; an audience array that omits it must not deliver.
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', marker: 'must-not-arrive' },
      { tenantId: 't1', organizationIds: ['o2', 'o3'] },
    )
    // An audience array that includes o1 must deliver, even without a singular organizationId.
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', marker: 'expected' },
      { tenantId: 't1', organizationIds: ['o1', 'o2'] },
    )

    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toContain('"marker":"expected"')

    try { await reader.cancel() } catch {}
  })

  it('does not deliver a private cross-process event to a same-organization browser', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    const listener = registerCrossProcessEventListenerMock.mock.calls[0]?.[0] as
      | ((envelope: Record<string, unknown>) => Promise<void>)
      | undefined
    expect(listener).toBeDefined()

    await listener?.({
      event: 'stream_privacy_test.private',
      payload: {
        id: 'private-record',
        tenantId: 't1',
        organizationId: 'o1',
      },
      originPid: process.pid + 1,
      originInstanceId: 'other-instance',
    })

    const pendingRead = reader.read().then(() => 'delivered')
    const result = await Promise.race([
      pendingRead,
      new Promise<'not-delivered'>((resolve) => setTimeout(() => resolve('not-delivered'), 10)),
    ])
    expect(result).toBe('not-delivered')

    try { await reader.cancel() } catch {}
  })

  it('does not let a forged global-tap payload override trusted tenant and organization scope', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    const tap = registerGlobalEventTapMock.mock.calls[0]?.[0] as
      | ((
          event: string,
          payload: Record<string, unknown>,
          options?: { tenantId?: string | null; organizationId?: string | null },
        ) => Promise<void>)
      | undefined
    expect(tap).toBeDefined()

    await tap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'forged-payload' },
      { tenantId: 'attacker-tenant', organizationId: 'attacker-org' },
    )

    const pendingRead = reader.read().then(() => 'delivered')
    const result = await Promise.race([
      pendingRead,
      new Promise<'not-delivered'>((resolve) => setTimeout(() => resolve('not-delivered'), 10)),
    ])
    expect(result).toBe('not-delivered')

    try { await reader.cancel() } catch {}
  })

  it('delivers a global-tap event when trusted scope matches despite forged payload scope', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    const tap = registerGlobalEventTapMock.mock.calls[0]?.[0] as
      | ((
          event: string,
          payload: Record<string, unknown>,
          options?: { tenantId?: string | null; organizationId?: string | null },
        ) => Promise<void>)
      | undefined

    await tap?.(
      'stream_privacy_test.browser',
      { tenantId: 'forged-tenant', organizationId: 'forged-org', marker: 'trusted-delivery' },
      { tenantId: 't1', organizationId: 'o1' },
    )

    const delivered = await reader.read()
    expect(new TextDecoder().decode(delivered.value)).toContain('trusted-delivery')

    try { await reader.cancel() } catch {}
  })

  it('ignores conflicting payload scope when trusted scope matches the connection', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    expect(mockGlobalEventTap).toBeDefined()
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 'forged-tenant', organizationId: 'forged-organization', marker: 'expected' },
      { tenantId: 't1', organizationId: 'o1' },
    )

    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toContain('\"marker\":\"expected\"')

    try { await reader.cancel() } catch {}
  })

  it('does not let a forged cross-process payload override trusted envelope scope', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    const listener = registerCrossProcessEventListenerMock.mock.calls[0]?.[0] as
      | ((envelope: Record<string, unknown>) => Promise<void>)
      | undefined
    expect(listener).toBeDefined()

    await listener?.({
      event: 'stream_privacy_test.browser',
      payload: { tenantId: 't1', organizationId: 'o1', marker: 'forged-payload' },
      options: { tenantId: 'attacker-tenant', organizationId: 'attacker-org' },
      originPid: process.pid + 1,
      originInstanceId: 'other-instance',
    })

    const pendingRead = reader.read().then(() => 'delivered')
    const result = await Promise.race([
      pendingRead,
      new Promise<'not-delivered'>((resolve) => setTimeout(() => resolve('not-delivered'), 10)),
    ])
    expect(result).toBe('not-delivered')

    try { await reader.cancel() } catch {}
  })

  it('preserves payload-authored scope for legacy emitters without a trusted scope marker', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    expect(mockGlobalEventTap).toBeDefined()
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'legacy-expected' },
    )

    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toContain('"marker":"legacy-expected"')

    try { await reader.cancel() } catch {}
  })

  it('delivers a cross-process event when trusted envelope scope matches despite forged payload scope', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    const listener = registerCrossProcessEventListenerMock.mock.calls[0]?.[0] as
      | ((envelope: Record<string, unknown>) => Promise<void>)
      | undefined

    await listener?.({
      event: 'stream_privacy_test.browser',
      payload: { tenantId: 'forged-tenant', organizationId: 'forged-org', marker: 'trusted-envelope' },
      options: { tenantId: 't1', organizationId: 'o1' },
      originPid: process.pid + 1,
      originInstanceId: 'other-instance',
    })

    const delivered = await reader.read()
    expect(new TextDecoder().decode(delivered.value)).toContain('trusted-envelope')

    try { await reader.cancel() } catch {}
  })

  it('delivers a rolling-deploy envelope that omits the instance id and shares this pid', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    const listener = registerCrossProcessEventListenerMock.mock.calls[0]?.[0] as
      | ((envelope: Record<string, unknown>) => Promise<void>)
      | undefined
    expect(listener).toBeDefined()

    // Containers commonly run as pid 1, so an older replica publishing without
    // an instance id must not be mistaken for this process.
    await listener?.({
      event: 'stream_privacy_test.browser',
      payload: { marker: 'legacy-replica' },
      options: { tenantId: 't1', organizationId: 'o1' },
      originPid: process.pid,
    })

    const pendingRead = reader.read().then((chunk) => new TextDecoder().decode(chunk.value))
    const result = await Promise.race([
      pendingRead,
      new Promise<'dropped'>((resolve) => setTimeout(() => resolve('dropped'), 50)),
    ])
    expect(result).toContain('legacy-replica')

    try { await reader.cancel() } catch {}
  })

  it('suppresses an envelope published by this instance even when the pid differs', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    const listener = registerCrossProcessEventListenerMock.mock.calls[0]?.[0] as
      | ((envelope: Record<string, unknown>) => Promise<void>)
      | undefined

    await listener?.({
      event: 'stream_privacy_test.browser',
      payload: { marker: 'self-echo' },
      options: { tenantId: 't1', organizationId: 'o1' },
      originPid: process.pid + 1,
      originInstanceId: 'web-instance',
    })

    const pendingRead = reader.read().then(() => 'delivered')
    const result = await Promise.race([
      pendingRead,
      new Promise<'not-delivered'>((resolve) => setTimeout(() => resolve('not-delivered'), 10)),
    ])
    expect(result).toBe('not-delivered')

    try { await reader.cancel() } catch {}
  })

  it('does not fall back to payload scope when the trusted tenant marker is empty', async () => {
    const { req } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()

    expect(mockGlobalEventTap).toBeDefined()
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'must-not-arrive' },
      { tenantId: null, organizationId: null },
    )
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { marker: 'expected' },
      { tenantId: 't1', organizationId: 'o1' },
    )

    const { value, done } = await reader.read()
    expect(done).toBe(false)
    const decoded = new TextDecoder().decode(value)
    expect(decoded).toContain('"marker":"expected"')
    expect(decoded).not.toContain('"marker":"must-not-arrive"')

    try { await reader.cancel() } catch {}
  })

  it('does not retain listeners across many reconnects', async () => {
    for (let i = 0; i < 20; i += 1) {
      const { req, controller, addSpy, removeSpy } = makeTrackedRequest()
      const res = await GET(req)
      expect(res.status).toBe(200)

      const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

      controller.abort()
      await new Promise((resolve) => setImmediate(resolve))

      const abortRemove = removeSpy.mock.calls.find((call) => call[0] === 'abort' && call[1] === attachedListener)
      expect(abortRemove).toBeDefined()

      try { await (res.body as ReadableStream).cancel() } catch {}
      jest.restoreAllMocks()
    }
  })

  it('closes and fully cleans up when canonical recipient roles change', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const { req, addSpy, removeSpy } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()
    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]
    expect(jest.getTimerCount()).toBe(3)

    mockResolveRequestContext.mockResolvedValue(buildResolvedContext({
      tenantId: 't1',
      sub: 'u1',
      orgId: 'o1',
      roles: ['viewer'],
    }))
    await jest.advanceTimersByTimeAsync(1000)

    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', recipientRoleId: 'admin', marker: 'revoked-role' },
    )
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(removeSpy).toHaveBeenCalledWith('abort', attachedListener)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('closes on periodic canonical auth/scope tenant mismatch without delivery or resurrection', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    mockResolveOrganizationScopeForRequest
      .mockResolvedValueOnce({
        selectedId: 'o1',
        filterIds: ['o1'],
        allowedIds: ['o1'],
        tenantId: 't1',
      })
      .mockResolvedValue({
        selectedId: 'o1',
        filterIds: ['o1'],
        allowedIds: ['o1'],
        tenantId: 't2',
      })
    const enqueueSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
    const { req } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    await jest.advanceTimersByTimeAsync(1000)
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    const enqueueCountAfterClose = enqueueSpy.mock.calls.length

    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'must-not-arrive' },
    )
    await jest.advanceTimersByTimeAsync(5000)

    expect(enqueueSpy).toHaveBeenCalledTimes(enqueueCountAfterClose)
    expect(mockResolveRequestContext).toHaveBeenCalledTimes(2)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledTimes(2)
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each([
    {
      change: 'tenant move',
      nextContext: buildResolvedContext({ tenantId: 't2', sub: 'u1', orgId: 'o1', roles: ['admin'] }),
    },
    {
      change: 'organization move',
      nextContext: buildResolvedContext({ tenantId: 't1', sub: 'u1', orgId: 'o2', roles: ['admin'] }),
    },
  ])('closes after a canonical $change', async ({ nextContext }) => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const { req } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    mockResolveRequestContext.mockResolvedValue(nextContext)
    await jest.advanceTimersByTimeAsync(1000)

    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('closes when canonical identity is missing', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const { req } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    mockResolveRequestContext.mockResolvedValue(buildResolvedContext(null))
    await jest.advanceTimersByTimeAsync(1000)

    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('fails closed when canonical auth validation throws', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const { req } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    mockResolveRequestContext.mockRejectedValue(new Error('validation unavailable'))
    await jest.advanceTimersByTimeAsync(1000)

    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('caps connection lifetime and leaves EventSource free to reconnect', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '10000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '1000'
    const { req, addSpy, removeSpy } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()
    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

    await jest.advanceTimersByTimeAsync(1000)

    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(mockResolveRequestContext).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledWith('abort', attachedListener)
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each([
    ['the low end', 0, 8_500],
    ['the high end', 1, 11_500],
  ])('jitters the configured maximum age by 15%% at %s of the random range', async (_case, randomValue, expectedDelayMs) => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(randomValue)
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '999999'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const closeSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'close')
    const { req } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    jest.advanceTimersByTime(expectedDelayMs - 1)
    expect(closeSpy).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
    await reader.cancel()
  })

  it.each([
    ['the minimum age', '1000', 0, 1_000],
    ['the Node timer maximum', '2147483647', 1, 2_147_483_647],
  ])('keeps the jittered maximum age within %s', async (_case, configuredValue, randomValue, expectedDelayMs) => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(randomValue)
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '999999'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = configuredValue
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout')
    const { req } = makeTrackedRequest()

    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), expectedDelayMs)
    await reader.cancel()
  })

  it.each(['0', 'not-a-number', 'Infinity'])('falls back to a finite maximum age for invalid value %s', async (invalidValue) => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '999999'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = invalidValue
    const closeSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'close')
    const { req } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    jest.advanceTimersByTime(299_999)
    expect(closeSpy).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
    await reader.cancel()
  })

  it.each([
    ['the exact Node timer maximum', '2147483647'],
    ['one millisecond above the Node timer maximum', '2147483648'],
    ['an oversized finite integer', '9007199254740991'],
  ])('bounds SSE timers for %s', async (_case, configuredValue) => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = configuredValue
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = configuredValue
    const intervalSpy = jest.spyOn(globalThis, 'setInterval')
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout')
    const { req } = makeTrackedRequest()

    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647)
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647)
    await reader.cancel()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('cannot resurrect or deliver after cancellation during deferred validation', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const validation = deferred<ReturnType<typeof buildResolvedContext>>()
    mockResolveRequestContext
      .mockResolvedValueOnce(buildResolvedContext())
      .mockImplementationOnce(() => validation.promise)
    const enqueueSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
    const { req, addSpy, removeSpy } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()
    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

    jest.advanceTimersByTime(1000)
    await flushPromises()
    expect(mockResolveRequestContext).toHaveBeenCalledTimes(2)
    await reader.cancel()
    const enqueueCountAfterCancel = enqueueSpy.mock.calls.length

    validation.resolve(buildResolvedContext())
    await flushPromises()
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'must-not-arrive' },
    )

    expect(enqueueSpy).toHaveBeenCalledTimes(enqueueCountAfterCancel)
    expect(removeSpy.mock.calls.filter((call) => call[0] === 'abort' && call[1] === attachedListener)).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('cannot resurrect after maximum age closes during deferred validation', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '1500'
    const validation = deferred<ReturnType<typeof buildResolvedContext>>()
    mockResolveRequestContext
      .mockResolvedValueOnce(buildResolvedContext())
      .mockImplementationOnce(() => validation.promise)
    const enqueueSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
    const closeSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'close')
    const { req, addSpy, removeSpy } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()
    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

    jest.advanceTimersByTime(1000)
    await flushPromises()
    expect(mockResolveRequestContext).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(500)
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    const enqueueCountAfterClose = enqueueSpy.mock.calls.length

    validation.resolve(buildResolvedContext())
    await flushPromises()
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'must-not-arrive' },
    )

    expect(enqueueSpy).toHaveBeenCalledTimes(enqueueCountAfterClose)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy.mock.calls.filter((call) => call[0] === 'abort' && call[1] === attachedListener)).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('ignores a late validation failure after abort cleanup', async () => {
    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const validation = deferred<ReturnType<typeof buildResolvedContext>>()
    mockResolveRequestContext
      .mockResolvedValueOnce(buildResolvedContext())
      .mockImplementationOnce(() => validation.promise)
    const enqueueSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
    const closeSpy = jest.spyOn(ReadableStreamDefaultController.prototype, 'close')
    const { req, controller, addSpy, removeSpy } = makeTrackedRequest()
    const response = await GET(req)
    const reader = response.body!.getReader()
    await reader.read()
    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

    jest.advanceTimersByTime(1000)
    await flushPromises()
    controller.abort()
    await flushPromises()
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    const enqueueCountAfterClose = enqueueSpy.mock.calls.length

    validation.reject(new Error('late validation failure'))
    await flushPromises()
    await mockGlobalEventTap?.(
      'stream_privacy_test.browser',
      { tenantId: 't1', organizationId: 'o1', marker: 'must-not-arrive' },
    )

    expect(enqueueSpy).toHaveBeenCalledTimes(enqueueCountAfterClose)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy.mock.calls.filter((call) => call[0] === 'abort' && call[1] === attachedListener)).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})
