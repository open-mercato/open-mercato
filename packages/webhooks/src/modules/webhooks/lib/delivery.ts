import type { EntityManager } from '@mikro-orm/postgresql'
import { buildWebhookHeaders, generateMessageId } from '@open-mercato/shared/lib/webhooks'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WebhookDeliveryEntity, WebhookEntity } from '../data/entities'
import { emitWebhooksEvent } from '../events'
import { enqueueWebhookDelivery } from './queue'
import { isWebhookIntegrationEnabled, WEBHOOK_INTEGRATION_DISABLED_MESSAGE } from './integration-state'

export interface WebhookDeliveryJob {
  deliveryId: string
  tenantId: string
  organizationId: string
}

export interface CreateWebhookDeliveryInput {
  em: EntityManager
  webhook: WebhookEntity
  eventId: string
  payload: Record<string, unknown>
}

type ProcessWebhookDeliveryOptions = {
  scheduleRetries?: boolean
}

type WebhookBody = {
  type: string
  timestamp: string
  data: Record<string, unknown>
}

export async function createWebhookDelivery(input: CreateWebhookDeliveryInput): Promise<WebhookDeliveryEntity> {
  const bodyPayload: WebhookBody = {
    type: input.eventId,
    timestamp: new Date().toISOString(),
    data: input.payload,
  }
  const now = new Date()

  const delivery = input.em.create(WebhookDeliveryEntity, {
    webhookId: input.webhook.id,
    eventType: input.eventId,
    messageId: generateMessageId(),
    payload: bodyPayload,
    status: 'pending',
    attemptNumber: 0,
    maxAttempts: input.webhook.maxRetries,
    targetUrl: input.webhook.url,
    organizationId: input.webhook.organizationId,
    tenantId: input.webhook.tenantId,
    enqueuedAt: now,
    createdAt: now,
    updatedAt: now,
  })

  await input.em.flush()
  await emitWebhooksEvent('webhooks.delivery.enqueued', {
    deliveryId: delivery.id,
    webhookId: input.webhook.id,
    eventType: input.eventId,
    organizationId: input.webhook.organizationId,
    tenantId: input.webhook.tenantId,
  })
  return delivery
}

export async function processWebhookDeliveryJob(
  em: EntityManager,
  job: WebhookDeliveryJob,
  options: ProcessWebhookDeliveryOptions = {},
): Promise<{ status: string; deliveryId: string } | null> {
  const delivery = await em.findOne(WebhookDeliveryEntity, {
    id: job.deliveryId,
    tenantId: job.tenantId,
    organizationId: job.organizationId,
  })

  if (!delivery) return null

  const webhook = await findOneWithDecryption(
    em,
    WebhookEntity,
    {
      id: delivery.webhookId,
      tenantId: job.tenantId,
      organizationId: job.organizationId,
      deletedAt: null,
    },
    {},
    { tenantId: job.tenantId, organizationId: job.organizationId },
  )

  if (!webhook) {
    delivery.status = 'failed'
    delivery.errorMessage = 'Webhook not found'
    delivery.nextRetryAt = null
    await em.flush()
    return { status: delivery.status, deliveryId: delivery.id }
  }

  if (!webhook.isActive) {
    delivery.status = 'expired'
    delivery.errorMessage = 'Webhook is inactive'
    delivery.nextRetryAt = null
    await em.flush()
    return { status: delivery.status, deliveryId: delivery.id }
  }

  const integrationEnabled = await isWebhookIntegrationEnabled(em, {
    tenantId: webhook.tenantId,
    organizationId: webhook.organizationId,
  })

  if (!integrationEnabled) {
    delivery.status = 'expired'
    delivery.errorMessage = WEBHOOK_INTEGRATION_DISABLED_MESSAGE
    delivery.nextRetryAt = null
    await em.flush()
    return { status: delivery.status, deliveryId: delivery.id }
  }

  const bodyPayload = normalizeWebhookBody(delivery.eventType, delivery.payload)
  delivery.payload = bodyPayload
  delivery.status = 'sending'
  delivery.lastAttemptAt = new Date()
  delivery.errorMessage = null
  await em.flush()

  const body = JSON.stringify(bodyPayload)
  const timestamp = Math.floor(Date.now() / 1000)
  const headers = buildWebhookHeaders(
    delivery.messageId,
    timestamp,
    body,
    webhook.secret,
    webhook.previousSecret,
  )

  const attemptStartedAt = Date.now()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), webhook.timeoutMs)

    const response = await fetch(webhook.url, {
      method: webhook.httpMethod,
      headers: {
        'content-type': 'application/json',
        ...headers,
        ...(webhook.customHeaders ?? {}),
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    delivery.attemptNumber += 1
    delivery.responseStatus = response.status
    delivery.responseBody = (await response.text()).slice(0, 4096)
    delivery.responseHeaders = Object.fromEntries(response.headers.entries())
    delivery.durationMs = Date.now() - delivery.enqueuedAt.getTime()
    delivery.lastAttemptAt = new Date()

    if (response.ok) {
      delivery.status = 'delivered'
      delivery.deliveredAt = new Date()
      delivery.nextRetryAt = null
      webhook.consecutiveFailures = 0
      webhook.lastSuccessAt = new Date()

      await emitWebhooksEvent('webhooks.delivery.succeeded', {
        deliveryId: delivery.id,
        webhookId: webhook.id,
        eventType: delivery.eventType,
        organizationId: delivery.organizationId,
        tenantId: delivery.tenantId,
      })

      await em.flush()
      return { status: delivery.status, deliveryId: delivery.id }
    }

    webhook.consecutiveFailures += 1
    webhook.lastFailureAt = new Date()

    await handleFailedDelivery({
      em,
      webhook,
      delivery,
      canRetry: shouldRetryStatus(response.status),
      scheduleRetries: options.scheduleRetries !== false,
      fallbackMessage: `HTTP ${response.status}`,
    })

    await emitWebhooksEvent('webhooks.delivery.failed', {
      deliveryId: delivery.id,
      webhookId: webhook.id,
      eventType: delivery.eventType,
      responseStatus: response.status,
      organizationId: delivery.organizationId,
      tenantId: delivery.tenantId,
      willRetry: delivery.status === 'pending',
    })

    return { status: delivery.status, deliveryId: delivery.id }
  } catch (error) {
    delivery.attemptNumber += 1
    delivery.durationMs = Date.now() - delivery.enqueuedAt.getTime()
    delivery.lastAttemptAt = new Date()
    delivery.errorMessage = error instanceof Error ? error.message : 'Unknown delivery error'

    webhook.consecutiveFailures += 1
    webhook.lastFailureAt = new Date()

    await handleFailedDelivery({
      em,
      webhook,
      delivery,
      canRetry: true,
      scheduleRetries: options.scheduleRetries !== false,
      fallbackMessage: delivery.errorMessage,
    })

    await emitWebhooksEvent('webhooks.delivery.failed', {
      deliveryId: delivery.id,
      webhookId: webhook.id,
      eventType: delivery.eventType,
      errorMessage: delivery.errorMessage,
      durationMs: Date.now() - attemptStartedAt,
      organizationId: delivery.organizationId,
      tenantId: delivery.tenantId,
      willRetry: delivery.status === 'pending',
    })

    return { status: delivery.status, deliveryId: delivery.id }
  }
}

type HandleFailedDeliveryInput = {
  em: EntityManager
  webhook: WebhookEntity
  delivery: WebhookDeliveryEntity
  canRetry: boolean
  scheduleRetries: boolean
  fallbackMessage: string
}

async function handleFailedDelivery(input: HandleFailedDeliveryInput): Promise<void> {
  const { delivery, webhook } = input
  const retriesRemaining = delivery.attemptNumber < Math.max(delivery.maxAttempts, 1)
  const shouldRetry = input.canRetry && retriesRemaining

  if (shouldRetry) {
    const nextRetryAt = calculateNextRetry(delivery.attemptNumber)
    delivery.status = 'pending'
    delivery.nextRetryAt = nextRetryAt

    await input.em.flush()

    if (input.scheduleRetries) {
      try {
        await enqueueWebhookDelivery(
          {
            deliveryId: delivery.id,
            tenantId: delivery.tenantId,
            organizationId: delivery.organizationId,
          },
          Math.max(nextRetryAt.getTime() - Date.now(), 0),
        )
      } catch (error) {
        delivery.status = 'failed'
        delivery.nextRetryAt = null
        delivery.errorMessage = error instanceof Error
          ? `Retry scheduling failed: ${error.message}`
          : 'Retry scheduling failed'
      }
    }
  } else {
    delivery.status = 'expired'
    delivery.nextRetryAt = null

    await emitWebhooksEvent('webhooks.delivery.exhausted', {
      deliveryId: delivery.id,
      webhookId: webhook.id,
      eventType: delivery.eventType,
      organizationId: delivery.organizationId,
      tenantId: delivery.tenantId,
      errorMessage: delivery.errorMessage ?? input.fallbackMessage,
    })
  }

  if (webhook.autoDisableThreshold > 0 && webhook.consecutiveFailures >= webhook.autoDisableThreshold) {
    webhook.isActive = false
    await emitWebhooksEvent('webhooks.webhook.disabled', {
      webhookId: webhook.id,
      organizationId: webhook.organizationId,
      tenantId: webhook.tenantId,
      consecutiveFailures: webhook.consecutiveFailures,
    })
  }

  await input.em.flush()
}

function normalizeWebhookBody(eventType: string, payload: Record<string, unknown>): WebhookBody {
  const candidateType = typeof payload.type === 'string' ? payload.type : null
  const candidateTimestamp = typeof payload.timestamp === 'string' ? payload.timestamp : null
  const candidateData = isRecord(payload.data) ? payload.data : null

  if (candidateType && candidateTimestamp && candidateData) {
    return {
      type: candidateType,
      timestamp: candidateTimestamp,
      data: candidateData,
    }
  }

  return {
    type: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldRetryStatus(status: number): boolean {
  if (status >= 200 && status < 300) return false
  if (status === 408 || status === 429) return true
  return status >= 500
}

function calculateNextRetry(attemptNumber: number): Date {
  const baseDelayMs = 1000
  const jitterMs = Math.floor(Math.random() * 1000)
  const delayMs = baseDelayMs * Math.pow(2, Math.max(attemptNumber - 1, 0)) + jitterMs
  return new Date(Date.now() + delayMs)
}
