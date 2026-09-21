import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings } from '../data/entities'

export interface EnsureInboxSettingsScope {
  tenantId: string
  organizationId: string
}

// Lazily bootstraps the tenant's InboxSettings row when missing — e.g. a
// tenant provisioned before this module existed and never ran setup.ts's
// onTenantCreated hook. Idempotent: a second call finds the row just created.
export async function ensureInboxSettings(
  em: EntityManager,
  scope: EnsureInboxSettingsScope,
): Promise<InboxSettings> {
  const existing = await findOneWithDecryption(
    em,
    InboxSettings,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
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
  await em.flush()
  return settings
}
