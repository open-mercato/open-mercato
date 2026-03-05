import type { EntityManager } from '@mikro-orm/postgresql'
import { WebhookProcessedEvent } from '../data/entities'

export async function checkWebhookIdempotency(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  organizationId: string,
): Promise<boolean> {
  const existing = await em.findOne(WebhookProcessedEvent, {
    idempotencyKey,
    providerKey,
    organizationId,
  })
  return !!existing
}

export async function markWebhookProcessed(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  eventType: string,
  scope: { organizationId: string; tenantId: string },
): Promise<void> {
  const record = em.create(WebhookProcessedEvent, {
    idempotencyKey,
    providerKey,
    eventType,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await em.persistAndFlush(record)
}
