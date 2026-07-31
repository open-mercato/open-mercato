import { CheckoutTransaction } from '../../data/entities'

const findWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

describe('checkout transaction-expiry worker', () => {
  const mockCommandBus = {
    execute: jest.fn().mockResolvedValue({ ok: true }),
  }

  const mockEm = {
    fork: () => mockEm,
  }

  const mockResolve = jest.fn((name: string) => {
    if (name === 'em') return mockEm
    if (name === 'commandBus') return mockCommandBus
    throw new Error(`Missing dependency: ${name}`)
  })

  const mockContext = {
    resolve: mockResolve,
    jobId: 'job-1',
    attemptNumber: 1,
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('throws an error if tenantId or organizationId is missing', async () => {
    const { default: handle } = await import('../transaction-expiry.worker')

    await expect(
      handle(
        {
          payload: { batchSize: 10 } as any,
        } as any,
        mockContext,
      ),
    ).rejects.toThrow('tenantId and organizationId are required in CheckoutExpiryJob')

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
        payload: {
          batchSize: 50,
          tenantId: 'tenant-456',
          organizationId: 'org-123',
        },
      } as any,
      mockContext,
    )

    // Verify findWithDecryption was called with org and tenant scoping
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

    // Verify command bus executes updateStatus for each transaction with context
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
