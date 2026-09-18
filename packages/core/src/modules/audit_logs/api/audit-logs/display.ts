import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'

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

export async function loadAuditLogDisplayMaps(
  em: EntityManager,
  ids: IdBuckets,
  options?: { translate?: TranslateWithFallbackFn },
): Promise<DisplayMaps> {
  const translate = options?.translate
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

  // Action/access log actors written by an API key store the bare `api_keys.id`
  // (the `api_key:` prefix is stripped at write time — see ActionLogService.sanitizeActor).
  // Resolve any actor id the User lookup missed against api_keys so callers never
  // fall back to rendering the raw UUID, including for keys that were later revoked.
  // The api_keys module is optional (see module-decoupling.test.ts) — its entity
  // metadata is only registered with the ORM when the module is enabled, so this
  // lookup must be skipped rather than attempted when the module is disabled.
  const unresolvedUserIds = userIds.filter((id) => !usersMap[id])
  const entityIds = getEntityIds(false)
  if (unresolvedUserIds.length && entityIds.api_keys?.api_key) {
    const apiKeyFilter: FilterQuery<ApiKey> = { id: { $in: unresolvedUserIds } }
    const apiKeys = await em.find(ApiKey, apiKeyFilter)
    for (const apiKey of apiKeys) {
      const id = String(apiKey.id)
      const label = apiKey.deletedAt
        ? translate?.('audit_logs.actor.api_key_revoked', 'API key: {name} (revoked)', { name: apiKey.name }) ?? `API key: ${apiKey.name} (revoked)`
        : translate?.('audit_logs.actor.api_key', 'API key: {name}', { name: apiKey.name }) ?? `API key: ${apiKey.name}`
      usersMap[id] = label
    }
  }

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
