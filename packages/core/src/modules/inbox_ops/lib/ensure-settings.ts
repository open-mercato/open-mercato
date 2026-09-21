import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings } from '../data/entities'

export interface EnsureInboxSettingsScope {
  tenantId: string
  organizationId: string
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  if ((error as { code?: string }).code === '23505') return true
  const message = (error as { message?: string }).message
  return typeof message === 'string' && message.includes('duplicate key')
}

async function findExisting(em: EntityManager, scope: EnsureInboxSettingsScope) {
  return findOneWithDecryption(
    em,
    InboxSettings,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
}

// Lazily bootstraps the tenant's InboxSettings row when missing — e.g. a
// tenant provisioned before this module existed and never ran setup.ts's
// onTenantCreated hook. Idempotent: a second call finds the row just created.
export async function ensureInboxSettings(
  em: EntityManager,
  scope: EnsureInboxSettingsScope,
): Promise<InboxSettings> {
  const existing = await findExisting(em, scope)
  if (existing) return existing

  const domain = process.env.INBOX_OPS_DOMAIN || 'inbox.mercato.local'
  const slug = scope.organizationId.slice(0, 8)
  const inboxAddress = `ops-${slug}@${domain}`
  const settings = em.create(InboxSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    inboxAddress,
    isActive: true,
  })
  em.persist(settings)

  try {
    await em.flush()
  } catch (error) {
    // Two concurrent bootstraps (e.g. two tabs) race to insert the same
    // deterministic inboxAddress; the loser refetches the winner's row
    // instead of surfacing a raw unique-constraint error to the caller.
    if (!isUniqueViolation(error)) throw error
    const winner = await findExisting(em, scope)
    if (!winner) throw error
    return winner
  }

  return settings
}
