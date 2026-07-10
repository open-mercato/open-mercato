import handle from '../workers/webhook-processor'

describe('Stripe webhook processor', () => {
  it('fails closed when a scope-less job carries tenant metadata', async () => {
    const findTransaction = jest.fn().mockResolvedValue(null)
    const findTransactionBySessionId = jest.fn().mockResolvedValue(null)
    const syncTransactionStatus = jest.fn()
    const scoped = jest.fn()
    const write = jest.fn()
    const services = {
      em: {},
      paymentGatewayService: {
        findTransaction,
        findTransactionBySessionId,
        syncTransactionStatus,
      },
      integrationLogService: { scoped, write },
    }
    const ctx = {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'stripe-webhook',
      resolve: jest.fn((name: keyof typeof services) => services[name]),
    } as unknown as Parameters<typeof handle>[1]
    const job = {
      id: 'job-1',
      createdAt: new Date().toISOString(),
      payload: {
        providerKey: 'stripe',
        transactionId: 'victim-transaction',
        scope: null,
        event: {
          eventType: 'payment_intent.succeeded',
          eventId: 'evt-forged',
          idempotencyKey: 'evt-forged',
          timestamp: new Date(),
          data: {
            id: 'pi-victim',
            status: 'succeeded',
            metadata: {
              organizationId: 'victim-organization',
              tenantId: 'victim-tenant',
            },
          },
        },
      },
    } as Parameters<typeof handle>[0]

    await handle(job, ctx)

    expect(findTransaction).not.toHaveBeenCalled()
    expect(findTransactionBySessionId).not.toHaveBeenCalled()
    expect(syncTransactionStatus).not.toHaveBeenCalled()
    expect(scoped).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})
