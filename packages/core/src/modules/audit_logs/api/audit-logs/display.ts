import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'

type IdBuckets = {
  userIds: Iterable<string>
  tenantIds: Iterable<string>
  organizationIds: Iterable<string>
}

type DisplayMaps = {
  users: Record<string, string>
  tenants: Record<string, string>
  organizations: Record<string, string>
}

function toUniqueArray(values: Iterable<string>): string[] {
  const set = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim?.() ?? value
    if (trimmed) set.add(trimmed)
  }
  return Array.from(set)
}

export async function loadAuditLogDisplayMaps(em: EntityManager, ids: IdBuckets): Promise<DisplayMaps> {
  const userIds = toUniqueArray(ids.userIds)
  const tenantIds = toUniqueArray(ids.tenantIds)
  const organizationIds = toUniqueArray(ids.organizationIds)

  const [users, tenants, organizations] = await Promise.all([
    userIds.length
      ? em.find(User, { id: { $in: userIds as any }, deletedAt: null })
      : Promise.resolve([]),
    tenantIds.length
      ? em.find(Tenant, { id: { $in: tenantIds as any }, deletedAt: null })
      : Promise.resolve([]),
    organizationIds.length
      ? em.find(Organization, { id: { $in: organizationIds as any }, deletedAt: null })
      : Promise.resolve([]),
  ])

  const usersMap = users.reduce<Record<string, string>>((acc, user) => {
    const id = String(user.id)
    const display = typeof user.name === 'string' && user.name.length ? user.name : user.email
    acc[id] = display ?? id
    return acc
  }, {})

  const tenantsMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
    const id = String(tenant.id)
    acc[id] = typeof tenant.name === 'string' && tenant.name.length ? tenant.name : id
    return acc
  }, {})

  const organizationsMap = organizations.reduce<Record<string, string>>((acc, organization) => {
    const id = String(organization.id)
    acc[id] = typeof organization.name === 'string' && organization.name.length ? organization.name : id
    return acc
  }, {})

  return {
    users: usersMap,
    tenants: tenantsMap,
    organizations: organizationsMap,
  }
}
