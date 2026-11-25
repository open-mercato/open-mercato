import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import {
  ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY,
  canonicalizeActorSubject,
  resolveActionLogActorSubject,
} from '../../lib/actorSubject'
import type { AccessLog } from '../../data/entities'

type DisplayEntry = Pick<AccessLog, 'id' | 'actorUserId' | 'contextJson' | 'tenantId' | 'organizationId'>
type DisplayActor = { entry: DisplayEntry; actorId: string; kind: 'user' | 'api_key' | 'legacy' }

type DisplayMaps = {
  actors: Record<string, string>
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

export async function loadAuditLogActorNames(
  em: EntityManager,
  entries: readonly DisplayEntry[],
  options?: { translate?: TranslateWithFallbackFn },
): Promise<Record<string, string>> {
  const translate = options?.translate
  const actors = entries.flatMap((entry): DisplayActor[] => {
    if (!entry.actorUserId) return []
    if (entry.contextJson?.[ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY] === undefined) {
      return [{ entry, actorId: entry.actorUserId, kind: 'legacy' }]
    }
    const subject = canonicalizeActorSubject(resolveActionLogActorSubject(entry))
    return subject ? [{ entry, actorId: subject.storageId, kind: subject.kind }] : []
  })
  const userIds = toUniqueArray(actors.filter(({ kind }) => kind !== 'api_key').map(({ actorId }) => actorId))
  const users = userIds.length
    ? await findWithDecryption(em, User, { id: { $in: userIds } }, {
        fields: ['id', 'name', 'email', 'deletedAt', 'tenantId', 'organizationId'],
      })
    : []
  const usersById = new Map(users.map((user) => [String(user.id), user]))

  const keyFilters = actors.flatMap(({ entry, actorId, kind }): FilterQuery<ApiKey>[] => {
    if (kind !== 'api_key' && (kind !== 'legacy' || usersById.has(actorId))) return []
    return [{
      id: actorId,
      tenantId: entry.tenantId,
      $or: entry.organizationId ? [{ organizationId: null }, { organizationId: entry.organizationId }] : [{ organizationId: null }],
    }]
  })
  const keys = keyFilters.length && getEntityIds(false).api_keys?.api_key
    ? await findWithDecryption(em, ApiKey, { $or: keyFilters }, {
        fields: ['id', 'name', 'deletedAt', 'tenantId', 'organizationId'],
      })
    : []
  const keysById = new Map(keys.map((key) => [String(key.id), key]))
  const actorNames: Record<string, string> = {}
  for (const { entry, actorId, kind } of actors) {
    const user = kind === 'api_key' ? undefined : usersById.get(actorId)
    if (user) {
      if (!user.deletedAt) actorNames[entry.id] = (user.name || user.email) ?? actorId
      continue
    }
    if (kind === 'user') continue
    const key = keysById.get(actorId)
    if (!key || (key.tenantId ?? null) !== entry.tenantId || (key.organizationId && key.organizationId !== entry.organizationId)) continue
    actorNames[entry.id] = key.deletedAt
      ? translate?.('audit_logs.actor.api_key_revoked', 'API key: {name} (revoked)', { name: key.name }) ?? `API key: ${key.name} (revoked)`
      : translate?.('audit_logs.actor.api_key', 'API key: {name}', { name: key.name }) ?? `API key: ${key.name}`
  }
  return actorNames
}

export async function loadAuditLogDisplayMaps(
  em: EntityManager,
  entries: readonly DisplayEntry[],
  options?: { translate?: TranslateWithFallbackFn },
): Promise<DisplayMaps> {
  const tenantIds = toUniqueArray(entries.flatMap(({ tenantId }) => tenantId ? [tenantId] : []))
  const organizationIds = toUniqueArray(entries.flatMap(({ organizationId }) => organizationId ? [organizationId] : []))
  const [actors, tenants, organizations] = await Promise.all([
    loadAuditLogActorNames(em, entries, options),
    tenantIds.length
      ? findWithDecryption(em, Tenant, { id: { $in: tenantIds }, deletedAt: null })
      : Promise.resolve([]),
    organizationIds.length
      ? findWithDecryption(em, Organization, { id: { $in: organizationIds }, deletedAt: null })
      : Promise.resolve([]),
  ])

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
    actors,
    tenants: tenantsMap,
    organizations: organizationsMap,
  }
}
