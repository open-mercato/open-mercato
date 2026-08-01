import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { CheckoutTransaction } from '../../data/entities'
import type { CheckoutExpiryJob } from '../transaction-expiry.worker'

const findWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

describe('checkout transaction-expiry worker', () => {
  const mockCommandBus = {
    execute: jest.fn().mockResolvedValue({ ok: true }),
  }

  type MockEntityManager = {
    fork: () => MockEntityManager
  }

  const mockEm: MockEntityManager = {
    fork: () => mockEm,
  }

  const resolve = <ResolvedValue = unknown>(name: string): ResolvedValue => {
    if (name === 'em') return mockEm as ResolvedValue
    if (name === 'commandBus') return mockCommandBus as ResolvedValue
    throw new Error(`[internal] Missing dependency: ${name}`)
  }

  const mockContext: JobContext & { resolve: typeof resolve } = {
    resolve,
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'checkout-transaction-expiry',
  }

  const baseJob = {
    id: 'job-1',
    createdAt: '2026-08-01T00:00:00.000Z',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('throws an error if tenantId or organizationId is missing', async () => {
    const { default: handle } = await import('../transaction-expiry.worker')

    await expect(
      handle(
        {
          ...baseJob,
          payload: { batchSize: 10 },
        } as unknown as QueuedJob<CheckoutExpiryJob>,
        mockContext,
      ),
    ).rejects.toThrow('[internal] tenantId and organizationId are required in CheckoutExpiryJob')

    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('queries only transactions matching the payload tenantId and organizationId and passes decryption scope', async () => {
    const { default: handle } = await import('../transaction-expiry.worker')

    const mockTransactions = [
      {
        id: 'txn-1',
        organizationId: 'org-123',
        tenantId: 'tenant-456',
      },
      {
        id: 'txn-2',
        organizationId: 'org-123',
        tenantId: 'tenant-456',
      },
    ]

    findWithDecryption.mockResolvedValueOnce(mockTransactions)

    await handle(
      {
        ...baseJob,
        payload: {
          batchSize: 50,
          tenantId: 'tenant-456',
          organizationId: 'org-123',
        },
      } satisfies QueuedJob<CheckoutExpiryJob>,
      mockContext,
    )

    expect(findWithDecryption).toHaveBeenCalledWith(
      mockEm,
      CheckoutTransaction,
      expect.objectContaining({
        status: 'processing',
        tenantId: 'tenant-456',
        organizationId: 'org-123',
      }),
      expect.objectContaining({
        limit: 50,
      }),
      {
        tenantId: 'tenant-456',
        organizationId: 'org-123',
      },
    )

    expect(mockCommandBus.execute).toHaveBeenCalledTimes(2)
    expect(mockCommandBus.execute).toHaveBeenNthCalledWith(
      1,
      'checkout.transaction.updateStatus',
      expect.objectContaining({
        input: {
          id: 'txn-1',
          status: 'expired',
          paymentStatus: 'expired',
          organizationId: 'org-123',
          tenantId: 'tenant-456',
        },
      }),
    )
  })
})
