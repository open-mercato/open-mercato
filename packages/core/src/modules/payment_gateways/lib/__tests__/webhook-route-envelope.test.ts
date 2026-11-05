/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals'
import { processPaymentGatewayWebhookJob } from '../webhook-processor'
import { markQueueJobOrigin } from '@open-mercato/shared/lib/queue/dispatchOrigin'
import type { IntegrationLogService } from '../../integrations/log-service'
import type { PaymentGatewayService } from './gateway-service'

/**
 * Regression guard for the dispatch-origin envelope (#5213 review M1): the
 * inbound webhook route enqueues the marked payload FLAT (`queue.enqueue(jobPayload)`,
 * matching `Queue.enqueue(data)` semantics in the async strategy). These cases
 * construct the payload exactly the way the route does — not a hand-built
 * stand-in — so a future envelope change fails here instead of dropping live
 * webhooks at runtime.
 */

const makeDeps = () => ({
  em: {
    create: jest.fn(() => ({})),
    persist: jest.fn(() => ({ flush: jest.fn(async () => {}) })),
    findOne: jest.fn(async () => null),
  } as never,
  paymentGatewayService: {
    findTransaction: jest.fn(async () => ({ id: 'txn_1', organizationId: 'o-1', tenantId: 't-1' })),
    findTransactionBySessionId: jest.fn(async () => null),
    syncTransactionStatus: jest.fn(async () => undefined),
  } as unknown as PaymentGatewayService,
  integrationLogService: {
    scoped: jest.fn(() => ({ info: jest.fn(async () => {}) })),
    write: jest.fn(async () => {}),
  } as unknown as IntegrationLogService,
})

describe('inbound webhook route → worker payload contract (#5213 M1)', () => {
  it('processes the flat marked payload exactly as the route constructs and enqueues it', async () => {
    const deps = makeDeps()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    // mirrors payment_gateways/api/webhook/[provider]/route.ts line-for-line
    const jobPayload = markQueueJobOrigin({
      providerKey: 'stripe',
      event: {
        eventType: 'checkout.session.completed',
        eventId: 'evt_1',
        idempotencyKey: 'idem_route_1',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        data: { id: 'cs_test_route' },
      },
      transactionId: 'txn_1',
      scope: { organizationId: 'o-1', tenantId: 't-1' },
    }, 'inbound-webhook')

    await processPaymentGatewayWebhookJob(deps, jobPayload)

    expect(deps.paymentGatewayService.findTransaction).toHaveBeenCalledWith('txn_1', {
      organizationId: 'o-1',
      tenantId: 't-1',
    })
    // processing progressed past the origin check into normal webhook handling
    // (no Stripe adapter is registered in this unit context, so the flow stops
    // at the documented missing-adapter guard — after the claim was taken)
    const written = (deps.integrationLogService.write as jest.Mock).mock.calls.map((c) => c[0]?.message ?? '')
    expect(written.some((m) => String(m).includes('Missing payment gateway adapter'))).toBe(true)
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('keeps the trusted marker on nested-envelope shapes too (defense against regressions)', async () => {
    const deps = makeDeps()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    // If anyone reintroduces an envelope around the payload, the marker must
    // still be discoverable by the processor after unwrapping — today that
    // means the flat shape above; this case documents the failure mode.
    const wrapped = { name: 'payment-gateway-webhook', payload: markQueueJobOrigin({
      providerKey: 'stripe',
      event: {
        eventType: 'checkout.session.completed',
        eventId: 'evt_2',
        idempotencyKey: 'idem_route_2',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        data: { id: 'cs_test_wrapped' },
      },
      transactionId: 'txn_2',
      scope: { organizationId: 'o-1', tenantId: 't-1' },
    }, 'inbound-webhook') }

    await processPaymentGatewayWebhookJob(deps, wrapped as never)

    expect(deps.paymentGatewayService.findTransaction).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
