import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WebhookProcessedEvent } from '../data/entities'

export async function checkWebhookIdempotency(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  organizationId: string,
): Promise<boolean> {
  const existing = await findOneWithDecryption(
    em,
    WebhookProcessedEvent,
    {
      idempotencyKey,
      providerKey,
      organizationId,
    },
    undefined,
    { organizationId },
  )
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
