import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CarrierWebhookProcessedEvent } from '../data/entities'

export async function claimWebhookProcessing(
  em: EntityManager,
  idempotencyKey: string,
  providerKey: string,
  scope: { organizationId: string; tenantId: string },
  eventType: string,
): Promise<boolean> {
  const record = em.create(CarrierWebhookProcessedEvent, {
    idempotencyKey,
    providerKey,
    eventType,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  try {
    await em.persist(record).flush()
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
    CarrierWebhookProcessedEvent,
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
  await em.remove(existing).flush()
}
