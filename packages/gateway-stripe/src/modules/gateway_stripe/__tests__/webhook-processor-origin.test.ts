import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import handler from '../workers/webhook-processor'

const makeCtx = () => ({
  resolve: jest.fn(),
  jobId: 'job-1',
  attemptNumber: 1,
})

const baseEvent = {
  idempotencyKey: 'evt_1',
  eventType: 'payment_intent.succeeded',
  data: { id: 'cs_test_1' },
}

describe('gateway-stripe webhook processor dispatch-origin enforcement (#5213)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('drops scheduler-originated jobs before touching any service', async () => {
    const ctx = makeCtx()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    await handler({
      payload: {
        providerKey: 'stripe',
        event: baseEvent,
        transactionId: 'tx-1',
        scope: { organizationId: 'o-1', tenantId: 't-1' },
        _jobOrigin: 'scheduler',
      },
    } as never, ctx as never)

    expect(ctx.resolve).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('drops unmarked jobs (fail closed)', async () => {
    const ctx = makeCtx()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    await handler({
      payload: {
        providerKey: 'stripe',
        event: baseEvent,
        transactionId: 'tx-1',
        scope: { organizationId: 'o-1', tenantId: 't-1' },
      },
    } as never, ctx as never)

    expect(ctx.resolve).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
