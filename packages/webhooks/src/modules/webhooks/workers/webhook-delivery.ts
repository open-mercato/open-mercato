import type { EntityManager } from '@mikro-orm/postgresql'
import { WebhookEntity, WebhookDeliveryEntity } from '../data/entities'
import { buildWebhookHeaders, generateMessageId } from '@open-mercato/shared/lib/webhooks'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata = {
  queue: 'webhook-deliveries',
  id: 'webhooks:delivery-worker',
  concurrency: 10,
}

interface WebhookDeliveryJob {
  webhookId: string
  eventId: string
  payload: Record<string, unknown>
  tenantId: string
  organizationId: string
}

export default async function handler(
  job: { data: WebhookDeliveryJob },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const { webhookId, eventId, payload, tenantId, organizationId } = job.data
  const em = (ctx.resolve('em') as EntityManager).fork()

  const webhook = await findOneWithDecryption(
    em,
    WebhookEntity,
    { id: webhookId, isActive: true, deletedAt: null },
    {},
    { tenantId, organizationId },
  )

  if (!webhook) return

  const messageId = generateMessageId()
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify({
    type: eventId,
    timestamp: new Date().toISOString(),
    data: payload,
  })

  const now = new Date()
  const delivery = em.create(WebhookDeliveryEntity, {
    webhookId: webhook.id,
    eventType: eventId,
    messageId,
    payload: JSON.parse(body),
    status: 'sending',
    attemptNumber: 0,
    maxAttempts: webhook.maxRetries,
    targetUrl: webhook.url,
    organizationId: webhook.organizationId,
    tenantId: webhook.tenantId,
    enqueuedAt: now,
    createdAt: now,
    updatedAt: now,
  })

  await em.flush()

  const headers = buildWebhookHeaders(
    messageId,
    timestamp,
    body,
    webhook.secret,
    webhook.previousSecret,
  )

  const startTime = Date.now()

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

    const durationMs = Date.now() - startTime
    const responseBody = await response.text().catch(() => '')

    delivery.responseStatus = response.status
    delivery.responseBody = responseBody.slice(0, 4096)
    delivery.durationMs = durationMs
    delivery.lastAttemptAt = new Date()
    delivery.attemptNumber += 1

    if (response.ok) {
      delivery.status = 'delivered'
      delivery.deliveredAt = new Date()
      webhook.consecutiveFailures = 0
      webhook.lastSuccessAt = new Date()
    } else {
      const shouldRetry = shouldRetryStatus(response.status) && delivery.attemptNumber < delivery.maxAttempts
      if (shouldRetry) {
        delivery.status = 'pending'
        delivery.nextRetryAt = calculateNextRetry(delivery.attemptNumber)
      } else {
        delivery.status = 'failed'
      }
      webhook.consecutiveFailures += 1
      webhook.lastFailureAt = new Date()

      if (webhook.autoDisableThreshold > 0 && webhook.consecutiveFailures >= webhook.autoDisableThreshold) {
        webhook.isActive = false
      }
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    delivery.durationMs = durationMs
    delivery.lastAttemptAt = new Date()
    delivery.attemptNumber += 1
    delivery.errorMessage = error instanceof Error ? error.message : 'Unknown error'

    const shouldRetry = delivery.attemptNumber < delivery.maxAttempts
    if (shouldRetry) {
      delivery.status = 'pending'
      delivery.nextRetryAt = calculateNextRetry(delivery.attemptNumber)
    } else {
      delivery.status = 'failed'
    }

    webhook.consecutiveFailures += 1
    webhook.lastFailureAt = new Date()

    if (webhook.autoDisableThreshold > 0 && webhook.consecutiveFailures >= webhook.autoDisableThreshold) {
      webhook.isActive = false
    }
  }

  await em.flush()
}

function shouldRetryStatus(status: number): boolean {
  if (status >= 200 && status < 300) return false
  if (status === 408 || status === 429) return true
  if (status >= 500) return true
  return false
}

function calculateNextRetry(attemptNumber: number): Date {
  const baseDelay = 1000
  const delayMs = baseDelay * Math.pow(2, attemptNumber - 1)
  const jitter = Math.random() * 1000
  return new Date(Date.now() + delayMs + jitter)
}
