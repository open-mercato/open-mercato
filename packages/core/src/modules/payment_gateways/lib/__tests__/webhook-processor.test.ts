import { describe, it, expect, jest } from '@jest/globals'
import { processPaymentGatewayWebhookJob } from '../webhook-processor'
import type { IntegrationLogService } from '../../integrations/log-service'
import type { PaymentGatewayService } from './gateway-service'

const makeDeps = () => ({
  em: {} as never,
  paymentGatewayService: {
    findTransaction: jest.fn(),
    findTransactionBySessionId: jest.fn(),
  } as unknown as PaymentGatewayService,
  integrationLogService: {
    scoped: jest.fn(),
    write: jest.fn(),
  } as unknown as IntegrationLogService,
})

const baseEvent = {
  idempotencyKey: 'evt_1',
  eventType: 'payment_intent.succeeded',
  data: { id: 'cs_test_1' },
}

describe('processPaymentGatewayWebhookJob dispatch-origin enforcement (#5213)', () => {
  it('drops jobs that were not enqueued by the trusted inbound webhook route', async () => {
    const deps = makeDeps()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    await processPaymentGatewayWebhookJob(deps, {
      providerKey: 'stripe',
      event: baseEvent,
      transactionId: 'tx-1',
      scope: { organizationId: 'o-1', tenantId: 't-1' },
      _jobOrigin: 'scheduler',
    } as never)

    expect(deps.paymentGatewayService.findTransaction).not.toHaveBeenCalled()
    expect(deps.paymentGatewayService.findTransactionBySessionId).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('drops unmarked legacy jobs (fail closed)', async () => {
    const deps = makeDeps()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    await processPaymentGatewayWebhookJob(deps, {
      providerKey: 'stripe',
      event: baseEvent,
      transactionId: 'tx-1',
      scope: { organizationId: 'o-1', tenantId: 't-1' },
    } as never)

    expect(deps.paymentGatewayService.findTransaction).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
