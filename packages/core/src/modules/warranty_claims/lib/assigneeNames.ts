import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import { readSafeDecryptedString } from './decryptionSafety'

export const ASSIGNEE_NAME_LOOKUP_LIMIT = 100

export type AssigneeNameLookupDeps = {
  container: { resolve: (name: string) => unknown }
  tenantId: string | null
  organizationId: string | null
  organizationIds?: readonly string[] | null
}

const assigneeOrganizationId = Symbol('warranty_claims.assigneeOrganizationId')

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function resolveAuthUserEntityId(): EntityId | null {
  const registry = E as unknown as Record<string, Record<string, string> | undefined>
  const value = registry.auth?.user
  return typeof value === 'string' ? (value as EntityId) : null
}

function resolveStaffMemberEntityId(): EntityId | null {
  const registry = E as unknown as Record<string, Record<string, string> | undefined>
  const value = registry.staff?.staff_team_member
  return typeof value === 'string' ? (value as EntityId) : null
}

function toDisplayName(record: Record<string, unknown>): string | null {
  return readSafeDecryptedString(record.name) ?? readSafeDecryptedString(record.email)
}

function readOrganizationId(record: Record<string, unknown>): string | null {
  const hidden = (record as Record<PropertyKey, unknown>)[assigneeOrganizationId]
  if (typeof hidden === 'string' && hidden.length) return hidden
  const value = record.organizationId ?? record.organization_id
  return typeof value === 'string' && value.length ? value : null
}

function organizationFilter(deps: AssigneeNameLookupDeps): string | { $in: string[] } | null {
  if (deps.organizationId) return deps.organizationId
  if (!Array.isArray(deps.organizationIds)) return null
  const organizationIds = Array.from(new Set(deps.organizationIds.filter((id) => typeof id === 'string' && id.length)))
  return organizationIds.length ? { $in: organizationIds } : null
}

async function queryAssigneeRecords(
  deps: AssigneeNameLookupDeps,
  userIds: string[],
  entityId: EntityId | null,
): Promise<Record<string, unknown>[]> {
  const organizationScope = organizationFilter(deps)
  if (!deps.tenantId || !userIds.length || !entityId) return []
  if (!deps.organizationId && !organizationScope) return []
  const queryEngine = deps.container.resolve('queryEngine') as QueryEngine
  const result = await queryEngine.query<Record<string, unknown>>(entityId, {
    tenantId: deps.tenantId,
    filters: {
      id: { $in: userIds.slice(0, ASSIGNEE_NAME_LOOKUP_LIMIT) },
      ...(organizationScope ? { organization_id: organizationScope } : {}),
      deleted_at: null,
      is_confirmed: true,
    },
    fields: ['id', 'name', 'email', 'tenant_id', 'organization_id', 'is_confirmed'],
    page: { page: 1, pageSize: ASSIGNEE_NAME_LOOKUP_LIMIT },
  })
  return (result.items ?? []).map(toRecord).filter((record): record is Record<string, unknown> => record !== null)
}

export function attachAssigneeOrganizationId<T extends Record<string, unknown>>(record: T, organizationId: string | null): T {
  Object.defineProperty(record, assigneeOrganizationId, { value: organizationId, enumerable: false })
  return record
}

export function collectAssigneeUserIds(items: readonly unknown[]): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    const record = toRecord(item)
    if (!record) continue
    const value = record.assigneeUserId
    if (typeof value === 'string' && value.length) ids.add(value)
    if (ids.size >= ASSIGNEE_NAME_LOOKUP_LIMIT) break
  }
  return [...ids]
}

export async function resolveAssigneeDisplayNames(
  deps: AssigneeNameLookupDeps,
  userIds: string[],
  entityId: EntityId | null = resolveAuthUserEntityId(),
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  try {
    const records = await queryAssigneeRecords(deps, userIds, entityId)
    for (const record of records) {
      const id = record.id
      if (typeof id !== 'string' || !id.length) continue
      const displayName = toDisplayName(record)
      if (displayName) names.set(id, displayName)
    }
  } catch {
    return names
  }
  return names
}

export async function isAssignableStaffUser(
  deps: AssigneeNameLookupDeps,
  userId: string,
  entityId: EntityId | null = resolveStaffMemberEntityId(),
): Promise<boolean> {
  if (!deps.tenantId || !deps.organizationId || !userId || !entityId) return false
  try {
    const queryEngine = deps.container.resolve('queryEngine') as QueryEngine
    const result = await queryEngine.query<Record<string, unknown>>(entityId, {
      tenantId: deps.tenantId,
      filters: {
        user_id: userId,
        organization_id: deps.organizationId,
        deleted_at: null,
        is_active: true,
      },
      fields: ['id', 'user_id', 'organization_id', 'is_active'],
      page: { page: 1, pageSize: 1 },
    })
    if (!result.items?.length) return false
    const names = await resolveAssigneeDisplayNames(deps, [userId])
    return names.has(userId)
  } catch {
    return false
  }
}

export async function decorateItemsWithAssigneeNames(
  items: readonly unknown[],
  deps: AssigneeNameLookupDeps,
): Promise<void> {
  const records = items.map(toRecord).filter((record): record is Record<string, unknown> => record !== null)
  if (!records.length) return
  for (const record of records) {
    if (!('assigneeName' in record)) record.assigneeName = null
  }
  const userIds = collectAssigneeUserIds(records)
  if (!userIds.length) return
  if (deps.organizationId) {
    const names = await resolveAssigneeDisplayNames(deps, userIds)
    if (!names.size) return
    for (const record of records) {
      const assigneeUserId = record.assigneeUserId
      if (typeof assigneeUserId === 'string' && names.has(assigneeUserId)) {
        record.assigneeName = names.get(assigneeUserId) ?? null
      }
    }
    return
  }
  try {
    const recordOrganizationIds = Array.from(new Set(records.map(readOrganizationId).filter((id): id is string => id !== null)))
    const lookupDeps = deps.organizationIds === null
      ? { ...deps, organizationIds: recordOrganizationIds }
      : deps
    const assignees = await queryAssigneeRecords(lookupDeps, userIds, resolveAuthUserEntityId())
    const namesByOrganizationAndUser = new Map<string, string>()
    for (const assignee of assignees) {
      const userId = assignee.id
      const organizationId = readOrganizationId(assignee)
      const displayName = toDisplayName(assignee)
      if (typeof userId === 'string' && organizationId && displayName) {
        namesByOrganizationAndUser.set(`${organizationId}:${userId}`, displayName)
      }
    }
    for (const record of records) {
      const userId = record.assigneeUserId
      const organizationId = readOrganizationId(record)
      if (typeof userId !== 'string' || !organizationId) continue
      record.assigneeName = namesByOrganizationAndUser.get(`${organizationId}:${userId}`) ?? null
    }
  } catch {
    return
  }
}
