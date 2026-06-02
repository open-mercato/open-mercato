const mockGetCustomerAuthFromRequest = jest.fn(async () => ({
  tenantId: 't1',
  orgId: 'o1',
  sub: 'c1',
}))

const mockIsPortalBroadcastEvent = jest.fn((eventName: string) => eventName === 'customer_accounts.user.updated')
const mockRegisterGlobalEventTap = jest.fn()
const mockRegisterCrossProcessEventListener = jest.fn()

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/modules/events', () => ({
  isPortalBroadcastEvent: (...args: [string]) => mockIsPortalBroadcastEvent(...args),
}))

jest.mock('@open-mercato/events/bus', () => ({
  registerGlobalEventTap: (...args: unknown[]) => mockRegisterGlobalEventTap(...args),
  registerCrossProcessEventListener: (...args: unknown[]) => mockRegisterCrossProcessEventListener(...args),
}))

import { GET } from '@open-mercato/core/modules/customer_accounts/api/portal/events/stream'

type StreamReader = ReadableStreamDefaultReader<Uint8Array>

function makeTrackedRequest() {
  const controller = new AbortController()
  const req = new Request('http://localhost/api/portal/events/stream', { signal: controller.signal })
  const addSpy = jest.spyOn(req.signal, 'addEventListener')
  const removeSpy = jest.spyOn(req.signal, 'removeEventListener')
  return { req, controller, addSpy, removeSpy }
}

async function waitForPortalTap(): Promise<(eventName: string, payload: Record<string, unknown>) => Promise<void>> {
  for (let i = 0; i < 5; i += 1) {
    const callback = mockRegisterGlobalEventTap.mock.calls[0]?.[0]
    if (typeof callback === 'function') {
      return callback as (eventName: string, payload: Record<string, unknown>) => Promise<void>
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('Portal event tap was not registered')
}

async function readSsePayload(reader: StreamReader): Promise<Record<string, unknown>> {
  const result = await reader.read()
  return parseSseReadResult(result)
}

function parseSseReadResult(result: ReadableStreamReadResult<Uint8Array>): Record<string, unknown> {
  if (result.done || !result.value) throw new Error('Expected SSE payload')
  const text = new TextDecoder().decode(result.value)
  const json = text.replace(/^data:\s*/, '').trim()
  return JSON.parse(json) as Record<string, unknown>
}

// The stream flushes an initial `: connected` comment on open so the browser
// EventSource fires `open` immediately. Drain it before asserting on event
// payloads, which are sequenced one read per broadcast below.
async function drainConnectedComment(reader: StreamReader): Promise<void> {
  const result = await reader.read()
  if (result.done || !result.value) throw new Error('Expected initial connected comment')
  expect(new TextDecoder().decode(result.value)).toBe(': connected\n\n')
}

async function withTimeout<T>(promise: Promise<T>, ms = 25): Promise<{ status: 'resolved'; value: T } | { status: 'timeout' }> {
  return Promise.race([
    promise.then((value) => ({ status: 'resolved' as const, value })),
    new Promise<{ status: 'timeout' }>((resolve) => setTimeout(() => resolve({ status: 'timeout' }), ms)),
  ])
}

describe('Portal SSE event stream — audience filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCustomerAuthFromRequest.mockResolvedValue({
      tenantId: 't1',
      orgId: 'o1',
      sub: 'c1',
    })
    mockIsPortalBroadcastEvent.mockImplementation((eventName: string) => eventName === 'customer_accounts.user.updated')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('filters portalBroadcast events by recipient customer user before sending', async () => {
    mockGetCustomerAuthFromRequest
      .mockResolvedValueOnce({ tenantId: 't1', orgId: 'o1', sub: 'c1' })
      .mockResolvedValueOnce({ tenantId: 't1', orgId: 'o1', sub: 'c2' })

    const first = await GET(makeTrackedRequest().req)
    const second = await GET(makeTrackedRequest().req)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const firstReader = first.body!.getReader()
    const secondReader = second.body!.getReader()

    try {
      await drainConnectedComment(firstReader)
      await drainConnectedComment(secondReader)

      const broadcast = await waitForPortalTap()

      const secondReadForFirstEvent = secondReader.read()
      await broadcast('customer_accounts.user.updated', {
        tenantId: 't1',
        organizationId: 'o1',
        recipientUserId: 'c1',
        email: 'customer-one@example.com',
      })

      const firstPayload = await readSsePayload(firstReader)
      expect(firstPayload).toMatchObject({
        id: 'customer_accounts.user.updated',
        payload: {
          recipientUserId: 'c1',
          email: 'customer-one@example.com',
        },
      })
      expect(await withTimeout(secondReadForFirstEvent)).toEqual({ status: 'timeout' })

      const firstReadForSecondEvent = firstReader.read()
      await broadcast('customer_accounts.user.updated', {
        tenantId: 't1',
        organizationId: 'o1',
        recipientUserIds: ['c2'],
        email: 'customer-two@example.com',
      })

      const secondArrayPayload = parseSseReadResult(await secondReadForFirstEvent)
      expect(secondArrayPayload).toMatchObject({
        id: 'customer_accounts.user.updated',
        payload: {
          recipientUserIds: ['c2'],
          email: 'customer-two@example.com',
        },
      })
      expect(await withTimeout(firstReadForSecondEvent)).toEqual({ status: 'timeout' })

      const secondReadForOrgEvent = secondReader.read()
      await broadcast('customer_accounts.user.updated', {
        tenantId: 't1',
        organizationId: 'o1',
        id: 'org-wide',
      })

      const firstOrgPayload = parseSseReadResult(await firstReadForSecondEvent)
      const secondOrgPayload = parseSseReadResult(await secondReadForOrgEvent)
      expect(firstOrgPayload).toMatchObject({ payload: { id: 'org-wide' } })
      expect(secondOrgPayload).toMatchObject({ payload: { id: 'org-wide' } })
    } finally {
      await firstReader.cancel().catch(() => undefined)
      await secondReader.cancel().catch(() => undefined)
    }
  })
})

describe('Portal SSE event stream — abort listener hygiene', () => {
  beforeEach(() => {
    mockGetCustomerAuthFromRequest.mockResolvedValue({
      tenantId: 't1',
      orgId: 'o1',
      sub: 'c1',
    })
  })

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

    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

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
})
