import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { slugify } from '@open-mercato/shared/lib/slugify'

async function backfillOrganizationSlugs(em: EntityManager, tenantId: string) {
  const filter: FilterQuery<Organization> = {
    tenant: tenantId,
    slug: null,
    deletedAt: null,
  } as unknown as FilterQuery<Organization>
  const orgs = await em.find(Organization, filter)
  if (!orgs.length) return

  const existingSlugs = new Set<string>()
  const allFilter: FilterQuery<Organization> = {
    tenant: tenantId,
    deletedAt: null,
  } as unknown as FilterQuery<Organization>
  const allOrgs = await em.find(Organization, allFilter, { fields: ['slug'] as any })
  for (const org of allOrgs) {
    if (org.slug) existingSlugs.add(org.slug)
  }

  for (const org of orgs) {
    const base = slugify(org.name)
    if (!base) continue
    let candidate = base
    let suffix = 0
    while (existingSlugs.has(candidate)) {
      suffix += 1
      candidate = `${base}-${suffix}`
    }
    org.slug = candidate
    existingSlugs.add(candidate)
  }
  await em.flush()
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['directory.tenants.*'],
    admin: ['directory.organizations.view', 'directory.organizations.manage'],
  },

  async seedDefaults({ em, tenantId }) {
    await backfillOrganizationSlugs(em as EntityManager, tenantId)
  },
}

export default setup
