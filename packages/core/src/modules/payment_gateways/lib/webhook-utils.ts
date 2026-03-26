import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WebhookProcessedEvent } from '../data/entities'

export async function claimWebhookProcessing(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  scope: { organizationId: string; tenantId: string },
  eventType: string,
): Promise<boolean> {
  const record = em.create(WebhookProcessedEvent, {
    idempotencyKey,
    providerKey,
    eventType,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  try {
    await em.persistAndFlush(record)
    return true
  } catch (error: unknown) {
    if (error instanceof UniqueConstraintViolationException) {
      return false
    }
    throw error
  }
}

export async function releaseWebhookClaim(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  scope: { organizationId: string; tenantId: string },
): Promise<void> {
  const existing = await findOneWithDecryption(
    em,
    WebhookProcessedEvent,
    {
      idempotencyKey,
      providerKey,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )
  if (!existing) return
  await em.removeAndFlush(existing)
}
