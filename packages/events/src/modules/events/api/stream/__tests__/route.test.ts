jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: jest.fn(async () => ({
    ctx: {
      auth: { tenantId: 't1', sub: 'u1', orgId: 'o1', roles: ['admin'] },
      selectedOrganizationId: 'o1',
    },
    container: {},
  })),
}))

type EmitOptions = {
  tenantId?: string | null
  organizationId?: string | null
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
function makeTrackedRequest() {
  const controller = new AbortController()
  const req = new Request('http://localhost/api/events/stream', { signal: controller.signal })
  const addSpy = jest.spyOn(req.signal, 'addEventListener')
  const removeSpy = jest.spyOn(req.signal, 'removeEventListener')
  return { req, controller, addSpy, removeSpy }
}

describe('SSE event stream — abort listener hygiene', () => {
  afterEach(() => {
    jest.restoreAllMocks()
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
})
