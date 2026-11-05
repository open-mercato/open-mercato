import { describe, it, expect, jest, afterEach } from '@jest/globals'
import {
  clearGatewayAdapters,
  registerGatewayAdapter,
  type GatewayAdapter,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { markQueueJobOrigin } from '@open-mercato/shared/lib/queue/dispatchOrigin'
import { processPaymentGatewayWebhookJob } from '../webhook-processor'
import type { IntegrationLogService } from '../../integrations/log-service'
import type { PaymentGatewayService } from './gateway-service'

jest.mock('../webhook-utils', () => ({
  claimWebhookProcessing: jest.fn(async () => true),
  releaseWebhookClaim: jest.fn(async () => {}),
}))

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

describe('processPaymentGatewayWebhookJob status mapping', () => {
  afterEach(() => {
    clearGatewayAdapters()
  })

  it('hands the adapter the verified event along with the provider status and event type', async () => {
    const scope = { organizationId: 'o-1', tenantId: 't-1' }
    const mapStatus = jest.fn<GatewayAdapter['mapStatus']>(() => 'partially_refunded' as UnifiedPaymentStatus)
    registerGatewayAdapter({ providerKey: 'acme', mapStatus } as unknown as GatewayAdapter)
    const syncTransactionStatus = jest.fn(async () => {})
    const deps = {
      em: {} as never,
      paymentGatewayService: {
        findTransaction: jest.fn(async () => ({ id: 'tx-1', ...scope })),
        findTransactionBySessionId: jest.fn(),
        syncTransactionStatus,
      } as unknown as PaymentGatewayService,
      integrationLogService: {
        scoped: jest.fn(),
        write: jest.fn(async () => {}),
      } as unknown as IntegrationLogService,
    }
    const data = { id: 'ch_1', status: 'succeeded', amount: 1000, amount_refunded: 400 }
    const event = {
      eventType: 'charge.refunded',
      eventId: 'evt_1',
      idempotencyKey: 'evt_1',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      data,
      apiVersion: '2025-03-31.basil',
    }

    await processPaymentGatewayWebhookJob(deps, markQueueJobOrigin({
      providerKey: 'acme',
      event,
      transactionId: 'tx-1',
      scope,
    }, 'inbound-webhook'))

    expect(mapStatus).toHaveBeenCalledTimes(1)
    expect(mapStatus).toHaveBeenCalledWith('succeeded', 'charge.refunded', event)
    const passedEvent = mapStatus.mock.calls[0][2]
    expect(passedEvent?.timestamp).toBeInstanceOf(Date)
    expect(syncTransactionStatus).toHaveBeenCalledWith(
      'tx-1',
      expect.objectContaining({ unifiedStatus: 'partially_refunded', providerStatus: 'charge.refunded', providerData: data }),
      scope,
    )
  })

  it('hands the adapter a Date timestamp for an event revived from a queued JSON job', async () => {
    const scope = { organizationId: 'o-1', tenantId: 't-1' }
    const mapStatus = jest.fn<GatewayAdapter['mapStatus']>(() => 'unknown' as UnifiedPaymentStatus)
    registerGatewayAdapter({ providerKey: 'acme', mapStatus } as unknown as GatewayAdapter)
    const deps = {
      em: {} as never,
      paymentGatewayService: {
        findTransaction: jest.fn(async () => ({ id: 'tx-1', ...scope })),
        findTransactionBySessionId: jest.fn(),
        syncTransactionStatus: jest.fn(async () => {}),
      } as unknown as PaymentGatewayService,
      integrationLogService: {
        scoped: jest.fn(),
        write: jest.fn(async () => {}),
      } as unknown as IntegrationLogService,
    }
    const queued = JSON.parse(JSON.stringify(markQueueJobOrigin({
      providerKey: 'acme',
      event: {
        eventType: 'charge.refunded',
        eventId: 'evt_2',
        idempotencyKey: 'evt_2',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        data: { id: 'ch_1' },
      },
      transactionId: 'tx-1',
      scope,
    }, 'inbound-webhook')))

    await processPaymentGatewayWebhookJob(deps, queued)

    const passedEvent = mapStatus.mock.calls[0][2]
    expect(passedEvent?.timestamp).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })
})
