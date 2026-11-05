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

jest.mock('@open-mercato/shared/lib/webhooks', () => ({
  buildWebhookHeaders: jest.fn(() => ({})),
  generateMessageId: jest.fn(() => 'msg-1'),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitWebhooksEvent } from '../../events'

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const emitWebhooksEventMock = emitWebhooksEvent as jest.MockedFunction<typeof emitWebhooksEvent>

describe('processWebhookDeliveryJob — URL safety guard', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    globalThis.fetch = jest.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS
  })

  function buildEm(delivery: Record<string, unknown>) {
    return {
      findOne: jest.fn(async () => delivery),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
  }

  it('blocks delivery to a webhook whose URL is a private IP literal', async () => {
    const delivery = {
      id: 'delivery-1',
      tenantId: 't',
      organizationId: 'o',
      webhookId: 'w-1',
      status: 'pending',
      payload: { type: 'x', timestamp: new Date().toISOString(), data: {} },
      enqueuedAt: new Date(),
      eventType: 'x',
      maxAttempts: 3,
      attemptNumber: 0,
      messageId: 'msg-1',
      responseBody: null,
      responseHeaders: null,
      responseStatus: null,
      nextRetryAt: null,
      errorMessage: null,
      lastAttemptAt: null,
      deliveredAt: null,
      durationMs: null,
    }
    const webhook = {
      id: 'w-1',
      url: 'http://169.254.169.254/latest/meta-data/',
      isActive: true,
      timeoutMs: 1000,
      httpMethod: 'POST',
      customHeaders: null,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      autoDisableThreshold: 0,
      maxRetries: 3,
      secret: 'secret',
      previousSecret: null,
      tenantId: 't',
      organizationId: 'o',
    }
    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    const em = buildEm(delivery)
    const result = await processWebhookDeliveryJob(em, {
      deliveryId: 'delivery-1',
      tenantId: 't',
      organizationId: 'o',
    }, { scheduleRetries: false })

    expect(result?.status).toBe('failed')
    expect((globalThis.fetch as jest.Mock).mock.calls).toHaveLength(0)
    expect(delivery.errorMessage).toMatch(/private or reserved/i)
    expect(emitWebhooksEventMock).toHaveBeenCalledWith(
      'webhooks.delivery.failed',
      expect.objectContaining({ willRetry: false, errorMessage: expect.stringMatching(/private/i) }),
    )
  })

  it('blocks delivery to a localhost hostname', async () => {
    const delivery = {
      id: 'delivery-2',
      tenantId: 't',
      organizationId: 'o',
      webhookId: 'w-2',
      status: 'pending',
      payload: { type: 'x', timestamp: new Date().toISOString(), data: {} },
      enqueuedAt: new Date(),
      eventType: 'x',
      maxAttempts: 3,
      attemptNumber: 0,
      messageId: 'msg-1',
      responseBody: null,
      responseHeaders: null,
      responseStatus: null,
      nextRetryAt: null,
      errorMessage: null,
      lastAttemptAt: null,
      deliveredAt: null,
      durationMs: null,
    }
    const webhook = {
      id: 'w-2',
      url: 'http://localhost:6379/',
      isActive: true,
      timeoutMs: 1000,
      httpMethod: 'POST',
      customHeaders: null,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      autoDisableThreshold: 0,
      maxRetries: 3,
      secret: 'secret',
      previousSecret: null,
      tenantId: 't',
      organizationId: 'o',
    }
    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    const em = buildEm(delivery)
    const result = await processWebhookDeliveryJob(em, {
      deliveryId: 'delivery-2',
      tenantId: 't',
      organizationId: 'o',
    }, { scheduleRetries: false })

    expect(result?.status).toBe('failed')
    expect((globalThis.fetch as jest.Mock).mock.calls).toHaveLength(0)
  })

  it('allows delivery when OM_WEBHOOKS_ALLOW_PRIVATE_URLS is set', async () => {
    process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS = '1'
    const delivery = {
      id: 'delivery-3',
      tenantId: 't',
      organizationId: 'o',
      webhookId: 'w-3',
      status: 'pending',
      payload: { type: 'x', timestamp: new Date().toISOString(), data: {} },
      enqueuedAt: new Date(),
      eventType: 'x',
      maxAttempts: 3,
      attemptNumber: 0,
      messageId: 'msg-1',
      responseBody: null,
      responseHeaders: null,
      responseStatus: null,
      nextRetryAt: null,
      errorMessage: null,
      lastAttemptAt: null,
      deliveredAt: null,
      durationMs: null,
    }
    const webhook = {
      id: 'w-3',
      url: 'http://127.0.0.1:3001/dev',
      isActive: true,
      timeoutMs: 1000,
      httpMethod: 'POST',
      customHeaders: null,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      autoDisableThreshold: 0,
      maxRetries: 3,
      secret: 'secret',
      previousSecret: null,
      tenantId: 't',
      organizationId: 'o',
    }
    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    const em = buildEm(delivery)
    const result = await processWebhookDeliveryJob(em, {
      deliveryId: 'delivery-3',
      tenantId: 't',
      organizationId: 'o',
    }, { scheduleRetries: false })

    expect(result?.status).toBe('delivered')
    expect((globalThis.fetch as jest.Mock).mock.calls).toHaveLength(1)
    expect((globalThis.fetch as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({ redirect: 'manual' }),
    )
  })
})
