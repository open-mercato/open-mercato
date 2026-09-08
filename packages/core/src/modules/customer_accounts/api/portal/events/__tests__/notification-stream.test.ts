const mockGetCustomerAuthFromRequest = jest.fn()
const mockIsPortalBroadcastEvent = jest.fn(
  (eventName: string) => eventName === 'notifications.notification.created',
)
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
type PortalTap = (eventName: string, payload: Record<string, unknown>) => Promise<void>

function makeRequest(): Request {
  return new Request('http://localhost/api/customer_accounts/portal/events/stream')
}

async function drainConnectedComment(reader: StreamReader): Promise<void> {
  const result = await reader.read()
  expect(result.done).toBe(false)
  expect(new TextDecoder().decode(result.value)).toBe(': connected\n\n')
}

async function waitForPortalTap(): Promise<PortalTap> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const callback = mockRegisterGlobalEventTap.mock.calls[0]?.[0]
    if (typeof callback === 'function') return callback as PortalTap
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('Portal event tap was not registered')
}

async function readPayload(reader: StreamReader): Promise<Record<string, unknown>> {
  const result = await reader.read()
  if (result.done || !result.value) throw new Error('Expected SSE payload')
  const text = new TextDecoder().decode(result.value)
  return JSON.parse(text.replace(/^data:\s*/, '').trim()) as Record<string, unknown>
}

async function expectNoPayload(
  pendingRead: Promise<ReadableStreamReadResult<Uint8Array>>,
): Promise<void> {
  const result = await Promise.race([
    pendingRead.then(() => 'resolved' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
  ])
  expect(result).toBe('timeout')
}

describe('Portal notification SSE stream — scoped delivery', () => {
  it('delivers a notification only to the matching tenant, organization, and customer user', async () => {
    mockGetCustomerAuthFromRequest
      .mockResolvedValueOnce({ tenantId: 'tenant-a', orgId: 'org-a', sub: 'customer-a' })
      .mockResolvedValueOnce({ tenantId: 'tenant-a', orgId: 'org-a', sub: 'customer-b' })
      .mockResolvedValueOnce({ tenantId: 'tenant-a', orgId: 'org-b', sub: 'customer-a' })
      .mockResolvedValueOnce({ tenantId: 'tenant-b', orgId: 'org-a', sub: 'customer-a' })

    const responses = await Promise.all([
      GET(makeRequest()),
      GET(makeRequest()),
      GET(makeRequest()),
      GET(makeRequest()),
    ])
    const readers = responses.map((response) => {
      expect(response.status).toBe(200)
      if (!response.body) throw new Error('Expected SSE response body')
      return response.body.getReader()
    })

    try {
      await Promise.all(readers.map(drainConnectedComment))
      const excludedReads = readers.slice(1).map((reader) => reader.read())
      const broadcast = await waitForPortalTap()

      await broadcast('notifications.notification.created', {
        tenantId: 'tenant-a',
        organizationId: 'org-a',
        recipientUserId: 'customer-a',
        notification: { id: 'notification-a' },
      })

      await expect(readPayload(readers[0])).resolves.toMatchObject({
        id: 'notifications.notification.created',
        payload: {
          recipientUserId: 'customer-a',
          notification: { id: 'notification-a' },
        },
      })
      await Promise.all(excludedReads.map(expectNoPayload))
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel().catch(() => undefined)))
    }
  })
})
