import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings } from '../data/entities'

export interface EnsureInboxSettingsScope {
  tenantId: string
  organizationId: string
}

export interface EnsureInboxSettingsResult {
  // The manager the returned `settings` row is actually managed by — a
  // concurrent-bootstrap recovery returns a clean fork, never the manager
  // whose insert just failed, so callers must flush further writes through
  // this manager rather than the one they passed in.
  em: EntityManager
  settings: InboxSettings
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
): Promise<EnsureInboxSettingsResult> {
  const existing = await findExisting(em, scope)
  if (existing) return { em, settings: existing }

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
    // Recover on a clean fork: `em`'s unit of work still owns the
    // half-persisted `settings` entity scheduled for the failed insert, so
    // flushing `em` again later (e.g. after a caller-side PATCH mutation)
    // would retry that same rejected insert.
    if (!isUniqueViolation(error)) throw error
    const recoveryEm = em.fork()
    const winner = await findExisting(recoveryEm, scope)
    if (!winner) throw error
    return { em: recoveryEm, settings: winner }
  }

  return { em, settings }
}
