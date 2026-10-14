const mockGetCustomerAuthFromRequest = jest.fn(async () => ({
  tenantId: 't1',
  orgId: 'o1',
  sub: 'c1',
}))

const mockIsPortalBroadcastEvent = jest.fn((eventName: string) => eventName === 'customer_accounts.user.updated')
const mockIsPrivateCrossProcessBroadcastEvent = jest.fn((eventName: string) => eventName === 'example.private.sync')
const mockRegisterGlobalEventTap = jest.fn()
const mockRegisterCrossProcessEventListener = jest.fn()

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/modules/events', () => ({
  isPortalBroadcastEvent: (...args: [string]) => mockIsPortalBroadcastEvent(...args),
  isPrivateCrossProcessBroadcastEvent: (...args: [string]) => mockIsPrivateCrossProcessBroadcastEvent(...args),
}))

jest.mock('@open-mercato/events/bus', () => ({
  registerGlobalEventTap: (...args: unknown[]) => mockRegisterGlobalEventTap(...args),
  registerCrossProcessEventListener: (...args: unknown[]) => mockRegisterCrossProcessEventListener(...args),
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'portal-test-instance',
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

type CrossProcessEnvelope = {
  event: string
  payload: Record<string, unknown>
  options?: { tenantId?: string | null; organizationId?: string | null }
  originPid: number
  originInstanceId?: string
}

async function waitForCrossProcessListener(): Promise<(envelope: CrossProcessEnvelope) => Promise<void>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const callback = mockRegisterCrossProcessEventListener.mock.calls[0]?.[0]
    if (typeof callback === 'function') {
      return callback as (envelope: CrossProcessEnvelope) => Promise<void>
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('Portal cross-process listener was not registered')
}

describe('Portal SSE event stream — cross-process delivery', () => {
  beforeEach(() => {
    mockGetCustomerAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'c1' })
    mockIsPortalBroadcastEvent.mockImplementation((eventName: string) => eventName === 'customer_accounts.user.updated')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('delivers a portal envelope published by another process, even when it shares this pid', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const listener = await waitForCrossProcessListener()

      await listener({
        event: 'customer_accounts.user.updated',
        payload: { id: 'user-1', tenantId: 't1', organizationId: 'o1', recipientUserId: 'c1' },
        options: { tenantId: 't1', organizationId: 'o1' },
        originPid: process.pid,
        originInstanceId: 'worker-instance',
      })

      expect(await readSsePayload(reader)).toMatchObject({
        id: 'customer_accounts.user.updated',
        payload: { id: 'user-1', recipientUserId: 'c1' },
        organizationId: 'o1',
      })
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })

  it('delivers a truncated bridge envelope that keeps its audience scope', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const listener = await waitForCrossProcessListener()

      await listener({
        event: 'customer_accounts.user.updated',
        payload: { truncated: true, id: 'user-1', tenantId: 't1', organizationId: 'o1' },
        options: { tenantId: 't1' },
        originPid: process.pid + 1,
        originInstanceId: 'worker-instance',
      })

      expect(await readSsePayload(reader)).toMatchObject({
        payload: { truncated: true, id: 'user-1' },
      })
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })

  it('ignores its own echo, non-portal events and payloads that contradict the trusted tenant', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const listener = await waitForCrossProcessListener()
      const pendingRead = reader.read()

      await listener({
        event: 'customer_accounts.user.updated',
        payload: { id: 'own', tenantId: 't1', organizationId: 'o1' },
        options: { tenantId: 't1' },
        originPid: process.pid + 1,
        originInstanceId: 'portal-test-instance',
      })
      await listener({
        event: 'customers.person.updated',
        payload: { id: 'backoffice-only', tenantId: 't1', organizationId: 'o1' },
        options: { tenantId: 't1' },
        originPid: process.pid + 1,
        originInstanceId: 'worker-instance',
      })
      await listener({
        event: 'customer_accounts.user.updated',
        payload: { id: 'forged', tenantId: 't1', organizationId: 'o1' },
        options: { tenantId: 'other-tenant' },
        originPid: process.pid + 1,
        originInstanceId: 'worker-instance',
      })

      expect(await withTimeout(pendingRead)).toEqual({ status: 'timeout' })
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })

  it('rejects a same-process emit whose payload tenant contradicts the trusted options tenant', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const tap = (await waitForPortalTap()) as (
        eventName: string,
        payload: Record<string, unknown>,
        options?: { tenantId?: string | null },
      ) => Promise<void>
      const pendingRead = reader.read()

      await tap('customer_accounts.user.updated', { id: 'forged', tenantId: 't1' }, { tenantId: 'workflow-tenant' })
      expect(await withTimeout(pendingRead)).toEqual({ status: 'timeout' })

      await tap('customer_accounts.user.updated', { id: 'trusted', tenantId: 't1' }, { tenantId: 't1' })
      expect(parseSseReadResult(await pendingRead)).toMatchObject({ payload: { id: 'trusted' } })
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })
})

describe('Portal SSE event stream — trusted organization scope', () => {
  type TrustedTap = (
    eventName: string,
    payload: Record<string, unknown>,
    options?: { tenantId?: string | null; organizationId?: string | null; organizationIds?: string[] },
  ) => Promise<void>

  beforeEach(() => {
    mockGetCustomerAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'c1' })
    mockIsPortalBroadcastEvent.mockImplementation(
      (eventName: string) => eventName === 'customer_accounts.user.updated' || eventName === 'example.private.sync',
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('drops a same-process emit whose payload names an organization outside the trusted one', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const tap = (await waitForPortalTap()) as TrustedTap
      const pendingRead = reader.read()

      await tap('customer_accounts.user.updated', { id: 'forged', tenantId: 't1', organizationId: 'o1' }, { tenantId: 't1', organizationId: 'o2' })
      expect(await withTimeout(pendingRead)).toEqual({ status: 'timeout' })

      await tap('customer_accounts.user.updated', { id: 'trusted', tenantId: 't1', organizationId: 'o1' }, { tenantId: 't1', organizationId: 'o1' })
      expect(parseSseReadResult(await pendingRead)).toMatchObject({ payload: { id: 'trusted' }, organizationId: 'o1' })
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })

  it('limits a same-process emit without payload organizations to the trusted organization', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const tap = (await waitForPortalTap()) as TrustedTap
      const pendingRead = reader.read()

      await tap('customer_accounts.user.updated', { id: 'other-org', tenantId: 't1' }, { tenantId: 't1', organizationId: 'o2' })
      expect(await withTimeout(pendingRead)).toEqual({ status: 'timeout' })

      await tap('customer_accounts.user.updated', { id: 'own-org', tenantId: 't1' }, { tenantId: 't1', organizationId: 'o1' })
      expect(parseSseReadResult(await pendingRead)).toMatchObject({ payload: { id: 'own-org' }, organizationId: 'o1' })
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })

  it('applies the trusted organization scope to cross-process envelopes too', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const listener = await waitForCrossProcessListener()
      const pendingRead = reader.read()

      await listener({
        event: 'customer_accounts.user.updated',
        payload: { id: 'forged', tenantId: 't1', organizationId: 'o1' },
        options: { tenantId: 't1', organizationId: 'o2' },
        originPid: process.pid + 1,
        originInstanceId: 'worker-instance',
      })
      await listener({
        event: 'customer_accounts.user.updated',
        payload: { id: 'unscoped', tenantId: 't1' },
        options: { tenantId: 't1', organizationId: 'o2' },
        originPid: process.pid + 1,
        originInstanceId: 'worker-instance',
      })
      expect(await withTimeout(pendingRead)).toEqual({ status: 'timeout' })

      await listener({
        event: 'customer_accounts.user.updated',
        payload: { id: 'scoped', tenantId: 't1' },
        options: { tenantId: 't1', organizationIds: ['o1', 'o3'] },
        originPid: process.pid + 1,
        originInstanceId: 'worker-instance',
      })
      expect(parseSseReadResult(await pendingRead)).toMatchObject({ payload: { id: 'scoped' } })
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })

  it('never delivers a private crossProcessBroadcast event, even when it is also portalBroadcast', async () => {
    const response = await GET(makeTrackedRequest().req)
    const reader = response.body!.getReader()
    try {
      await drainConnectedComment(reader)
      const tap = (await waitForPortalTap()) as TrustedTap
      const listener = await waitForCrossProcessListener()
      const pendingRead = reader.read()

      await tap('example.private.sync', { id: 'private-local', tenantId: 't1', organizationId: 'o1' }, { tenantId: 't1', organizationId: 'o1' })
      await listener({
        event: 'example.private.sync',
        payload: { id: 'private-remote', tenantId: 't1', organizationId: 'o1' },
        options: { tenantId: 't1', organizationId: 'o1' },
        originPid: process.pid + 1,
        originInstanceId: 'worker-instance',
      })

      expect(await withTimeout(pendingRead)).toEqual({ status: 'timeout' })
    } finally {
      await reader.cancel().catch(() => undefined)
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
