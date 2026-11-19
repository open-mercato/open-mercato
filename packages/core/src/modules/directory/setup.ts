import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { slugify } from '@open-mercato/shared/lib/slugify'
import { allocateOrganizationSlug, isOrganizationSlugConflict } from './lib/organizationSlug'

async function backfillOrganizationSlugs(em: EntityManager, tenantId: string) {
  const orgs = await findWithDecryption(em, Organization, {
    tenant: tenantId,
    slug: null,
    deletedAt: null,
  }, { orderBy: { createdAt: 'ASC', id: 'ASC' } }, { tenantId })

  const assigned = new Map<Organization, string>()
  const reserved = new Set<string>()
  for (const org of orgs) {
    const base = slugify(org.name)
    if (!base) continue
    const slug = await allocateOrganizationSlug(em, tenantId, base, { reserved })
    assigned.set(org, slug)
    reserved.add(slug)
  }
  for (const [org, slug] of assigned) org.slug = slug
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['directory.tenants.*'],
    admin: ['directory.organizations.view', 'directory.organizations.manage'],
  },

  async seedDefaults({ em, tenantId }) {
    const manager = em as EntityManager
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await manager.transactional((transaction) => backfillOrganizationSlugs(transaction, tenantId), { clear: true })
        return
      } catch (error) {
        if (attempt === maxAttempts || !isOrganizationSlugConflict(error)) throw error
      }
    }
  },
}

export default setup
