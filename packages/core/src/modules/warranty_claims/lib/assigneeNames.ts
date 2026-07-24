import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'

export const ASSIGNEE_NAME_LOOKUP_LIMIT = 100

export type AssigneeNameLookupDeps = {
  container: { resolve: (name: string) => unknown }
  tenantId: string | null
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function resolveAuthUserEntityId(): EntityId | null {
  const registry = E as unknown as Record<string, Record<string, string> | undefined>
  const value = registry.auth?.user
  return typeof value === 'string' ? (value as EntityId) : null
}

function toDisplayName(record: Record<string, unknown>): string | null {
  const name = record.name
  if (typeof name === 'string' && name.trim().length) return name
  const email = record.email
  if (typeof email === 'string' && email.trim().length) return email
  return null
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
  if (!deps.tenantId || !userIds.length || !entityId) return names
  try {
    const queryEngine = deps.container.resolve('queryEngine') as QueryEngine
    const result = await queryEngine.query<Record<string, unknown>>(entityId, {
      tenantId: deps.tenantId,
      filters: { id: { $in: userIds.slice(0, ASSIGNEE_NAME_LOOKUP_LIMIT) } },
      fields: ['id', 'name', 'email', 'tenant_id', 'organization_id'],
      page: { page: 1, pageSize: ASSIGNEE_NAME_LOOKUP_LIMIT },
    })
    for (const item of result.items ?? []) {
      const record = toRecord(item)
      if (!record) continue
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
  const names = await resolveAssigneeDisplayNames(deps, userIds)
  if (!names.size) return
  for (const record of records) {
    const assigneeUserId = record.assigneeUserId
    if (typeof assigneeUserId === 'string' && names.has(assigneeUserId)) {
      record.assigneeName = names.get(assigneeUserId) ?? null
    }
  }
}
