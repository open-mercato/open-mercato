const query = jest.fn(async () => undefined)
const warn = jest.fn()

jest.mock('pg', () => ({
  Client: jest.fn(),
  Pool: jest.fn(() => ({ query })),
}))

jest.mock('@open-mercato/shared/lib/db/ssl', () => ({
  getSslConfig: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const createMockLogger = (): Record<string, unknown> => {
    const mockLogger: Record<string, unknown> = {
      error: jest.fn(),
      warn: (...args: unknown[]) => warn(...args),
      info: jest.fn(),
      debug: jest.fn(),
    }
    mockLogger.child = () => mockLogger
    return mockLogger
  }
  return { createLogger: jest.fn(() => createMockLogger()) }
})

import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { publishCrossProcessEvent } from '../bridge'

createModuleEvents({
  moduleId: 'bridge_oversize_test',
  events: [
    { id: 'bridge_oversize_test.portal', label: 'Portal', portalBroadcast: true },
    { id: 'bridge_oversize_test.browser', label: 'Browser', clientBroadcast: true },
    { id: 'bridge_oversize_test.private', label: 'Private', crossProcessBroadcast: true },
  ] as const,
})

type SerializedEnvelope = {
  event: string
  payload: Record<string, unknown>
  options?: Record<string, unknown>
}

function lastPublishedEnvelope(): SerializedEnvelope {
  const serialized = query.mock.calls.at(-1)?.[1]?.[1]
  expect(typeof serialized).toBe('string')
  return JSON.parse(serialized as string) as SerializedEnvelope
}

const oversizeBody = 'x'.repeat(10_000)

describe('cross-process bridge oversize envelopes', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/mercato'
  })

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
  })

  beforeEach(() => {
    query.mockClear()
    warn.mockClear()
  })

  it('publishes envelopes within the limit unchanged', async () => {
    const payload = { id: 'ticket-1', tenantId: 'tenant-1', body: 'short' }

    await publishCrossProcessEvent('bridge_oversize_test.portal', payload, { tenantId: 'tenant-1' })

    expect(lastPublishedEnvelope().payload).toEqual(payload)
    expect(warn).not.toHaveBeenCalled()
  })

  it('truncates an oversize portal envelope to an entity ref that keeps the audience scope', async () => {
    const options = { tenantId: 'tenant-1', organizationId: 'org-1' }

    await publishCrossProcessEvent(
      'bridge_oversize_test.portal',
      {
        id: ' ticket-1 ',
        entityType: 'staff:support_ticket',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        organizationIds: ['org-1', 42, ''],
        recipientUserId: 'customer-1',
        recipientUserIds: ['customer-1', 'customer-2'],
        recipientRoleIds: ['role-1'],
        body: oversizeBody,
      },
      options,
    )

    expect(query).toHaveBeenCalledTimes(1)
    const envelope = lastPublishedEnvelope()
    expect(envelope.event).toBe('bridge_oversize_test.portal')
    expect(envelope.options).toEqual(options)
    expect(envelope.payload).toEqual({
      truncated: true,
      id: 'ticket-1',
      entityType: 'staff:support_ticket',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      organizationIds: ['org-1'],
      recipientUserId: 'customer-1',
      recipientUserIds: ['customer-1', 'customer-2'],
      recipientRoleIds: ['role-1'],
    })
    expect(warn).toHaveBeenCalledWith(
      'Cross-process event truncated: payload exceeds size limit',
      expect.objectContaining({ event: 'bridge_oversize_test.portal' }),
    )
  })

  it('truncates an oversize clientBroadcast envelope the same way', async () => {
    await publishCrossProcessEvent(
      'bridge_oversize_test.browser',
      { entityId: 'record-1', tenantId: 'tenant-1', body: oversizeBody },
      { tenantId: 'tenant-1' },
    )

    expect(lastPublishedEnvelope().payload).toEqual({
      truncated: true,
      entityId: 'record-1',
      tenantId: 'tenant-1',
    })
  })

  it('drops an oversize private crossProcessBroadcast envelope instead of reshaping it', async () => {
    await publishCrossProcessEvent(
      'bridge_oversize_test.private',
      { id: 'record-1', tenantId: 'tenant-1', body: oversizeBody },
      { tenantId: 'tenant-1', emitterModuleId: 'bridge_oversize_test' },
    )

    expect(query).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'Cross-process event dropped: payload exceeds size limit',
      expect.objectContaining({ event: 'bridge_oversize_test.private' }),
    )
  })

  it('drops an envelope that still exceeds the limit after truncation', async () => {
    const recipientUserIds = Array.from({ length: 600 }, (entry, index) => `customer-${index}`)

    await publishCrossProcessEvent(
      'bridge_oversize_test.portal',
      { id: 'ticket-1', tenantId: 'tenant-1', recipientUserIds },
      { tenantId: 'tenant-1' },
    )

    expect(query).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'Cross-process event dropped: payload exceeds size limit',
      expect.objectContaining({ event: 'bridge_oversize_test.portal' }),
    )
  })
})
