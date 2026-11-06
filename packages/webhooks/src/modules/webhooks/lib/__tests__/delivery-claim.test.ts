import type { EntityManager } from '@mikro-orm/postgresql'
import { processWebhookDeliveryJob } from '../delivery'

jest.mock('../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(async () => true),
  WEBHOOK_INTEGRATION_DISABLED_MESSAGE: 'disabled',
}))

jest.mock('../queue', () => ({
  enqueueWebhookDelivery: jest.fn(async () => 'job-1'),
}))

jest.mock('../url-safety', () => {
  class UnsafeWebhookUrlError extends Error {}
  return {
    assertSafeWebhookDeliveryUrl: jest.fn(async () => undefined),
    safeWebhookFetch: jest.fn(),
    UnsafeWebhookUrlError,
  }
})

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enqueueWebhookDelivery } from '../queue'
import { safeWebhookFetch } from '../url-safety'

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const enqueueWebhookDeliveryMock = enqueueWebhookDelivery as jest.MockedFunction<typeof enqueueWebhookDelivery>
const safeWebhookFetchMock = safeWebhookFetch as jest.MockedFunction<typeof safeWebhookFetch>

const JOB = { deliveryId: 'delivery-1', tenantId: 'tenant-1', organizationId: 'org-1' }

function buildDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    webhookId: 'webhook-1',
    eventType: 'customers.person.created',
    messageId: 'msg-1',
    payload: { type: 'customers.person.created', timestamp: new Date().toISOString(), data: {} },
    status: 'pending',
    attemptNumber: 0,
    maxAttempts: 3,
    targetUrl: 'https://example.com/hook',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    enqueuedAt: new Date(),
    ...overrides,
  }
}

function buildEm(delivery: Record<string, unknown>, claimedRows: number) {
  return {
    findOne: jest.fn(async () => delivery),
    nativeUpdate: jest.fn(async () => claimedRows),
    flush: jest.fn(async () => undefined),
  }
}

describe('processWebhookDeliveryJob — delivery claim', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue({
      id: 'webhook-1',
      url: 'https://example.com/hook',
      secret: 'whsec_dGVzdC1zZWNyZXQ=',
      previousSecret: null,
      httpMethod: 'POST',
      timeoutMs: 5000,
      customHeaders: null,
      isActive: true,
      consecutiveFailures: 0,
      autoDisableThreshold: 0,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    } as never)
    safeWebhookFetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  it.each(['delivered', 'failed', 'expired'])('ignores a job for a %s delivery', async (status) => {
    const delivery = buildDelivery({ status })
    const em = buildEm(delivery, 1)

    const result = await processWebhookDeliveryJob(em as unknown as EntityManager, JOB, { scheduleRetries: false })

    expect(result).toBeNull()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(safeWebhookFetchMock).not.toHaveBeenCalled()
    expect(delivery.status).toBe(status)
  })

  it('does not send when another worker holds the claim and rechecks once the lease ends', async () => {
    const delivery = buildDelivery()
    const em = buildEm(delivery, 0)

    const result = await processWebhookDeliveryJob(em as unknown as EntityManager, JOB)

    expect(result).toBeNull()
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(safeWebhookFetchMock).not.toHaveBeenCalled()
    expect(enqueueWebhookDeliveryMock).toHaveBeenCalledWith(JOB, 5000 + 15_000 + 1000)
  })

  it('does not schedule a recheck when retries are not scheduled', async () => {
    const em = buildEm(buildDelivery(), 0)

    await processWebhookDeliveryJob(em as unknown as EntityManager, JOB, { scheduleRetries: false })

    expect(enqueueWebhookDeliveryMock).not.toHaveBeenCalled()
  })

  it('releases its claim when processing throws after claiming', async () => {
    const em = buildEm(buildDelivery(), 1)
    em.flush.mockRejectedValueOnce(new Error('connection reset'))

    await expect(
      processWebhookDeliveryJob(em as unknown as EntityManager, JOB, { scheduleRetries: false }),
    ).rejects.toThrow('connection reset')

    expect(safeWebhookFetchMock).not.toHaveBeenCalled()
    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
    const [, claimFilter, claimData] = em.nativeUpdate.mock.calls[0] as unknown as [unknown, unknown, { lastAttemptAt: Date }]
    expect(claimFilter).toEqual(expect.objectContaining({ id: 'delivery-1' }))
    const [, releaseFilter, releaseData] = em.nativeUpdate.mock.calls[1] as unknown as [unknown, Record<string, unknown>, Record<string, unknown>]
    expect(releaseFilter).toEqual(expect.objectContaining({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'sending',
      lastAttemptAt: claimData.lastAttemptAt,
    }))
    expect(releaseData).toEqual(expect.objectContaining({ status: 'pending' }))
  })

  it('claims a pending or stale sending delivery before sending it', async () => {
    const delivery = buildDelivery()
    const em = buildEm(delivery, 1)

    const result = await processWebhookDeliveryJob(em as unknown as EntityManager, JOB, { scheduleRetries: false })

    expect(result).toEqual({ status: 'delivered', deliveryId: 'delivery-1' })
    expect(safeWebhookFetchMock).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate.mock.invocationCallOrder[0]).toBeLessThan(safeWebhookFetchMock.mock.invocationCallOrder[0])
    const [, filter, data] = em.nativeUpdate.mock.calls[0] as unknown as [
      unknown,
      { $or: [{ status: string }, { status: string; lastAttemptAt: { $lt: Date } }] },
      { status: string; lastAttemptAt: Date },
    ]
    expect(filter).toEqual(expect.objectContaining({ id: 'delivery-1', tenantId: 'tenant-1', organizationId: 'org-1' }))
    expect(filter.$or[0]).toEqual({ status: 'pending' })
    expect(filter.$or[1].status).toBe('sending')
    expect(data.lastAttemptAt.getTime() - filter.$or[1].lastAttemptAt.$lt.getTime()).toBe(5000 + 15_000)
    expect(data.status).toBe('sending')
    expect(delivery.attemptNumber).toBe(1)
  })
})
