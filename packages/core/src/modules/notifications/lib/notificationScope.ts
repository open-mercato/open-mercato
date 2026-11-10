import { sql, type RawBuilder } from 'kysely'

export type NotificationReadOrganizationScope = {
  organizationId?: string | null
  organizationIds?: string[] | null
}

type NotificationReadScopeWhere = {
  organizationId?: null
  $or?: Array<
    | { organizationId: { $in: string[] } }
    | { organizationId: null }
  >
}

function resolveOrganizationIds(scope: NotificationReadOrganizationScope): string[] | null {
  if (scope.organizationIds === null) return null
  if (scope.organizationIds === undefined) return null
  const candidates = scope.organizationIds
  return Array.from(new Set(candidates.filter((value) => value.trim().length > 0)))
}

export function buildNotificationReadScopeWhere(
  scope: NotificationReadOrganizationScope,
): NotificationReadScopeWhere {
  const organizationIds = resolveOrganizationIds(scope)
  if (organizationIds === null) return {}
  if (organizationIds.length === 0) return { organizationId: null }
  return {
    $or: [
      { organizationId: { $in: organizationIds } },
      { organizationId: null },
    ],
  }
}

export function buildNotificationReadScopeSql(
  scope: NotificationReadOrganizationScope,
): RawBuilder<boolean> | null {
  const organizationIds = resolveOrganizationIds(scope)
  if (organizationIds === null) return null
  const column = sql.ref('organization_id')
  if (organizationIds.length === 0) return sql<boolean>`${column} is null`
  return sql<boolean>`(${column} in (${sql.join(organizationIds.map((id) => sql.val(id)))}) or ${column} is null)`
}

export function getNotificationReadScopeTagOrganizationIds(
  scope: NotificationReadOrganizationScope,
): Array<string | null> {
  const organizationIds = resolveOrganizationIds(scope)
  return organizationIds === null ? [null] : [...organizationIds, null]
}
