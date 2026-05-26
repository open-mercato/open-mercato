import { extractChangeRows, isRecord } from './changeRows'

export const ACTION_LOG_FILTER_TYPES = ['create', 'edit', 'delete', 'assign'] as const
export const ACTION_LOG_PROJECTION_TYPES = [...ACTION_LOG_FILTER_TYPES, 'system'] as const
export const ACTION_LOG_SOURCE_KEYS = ['ui', 'api', 'system'] as const

export type ActionLogFilterType = (typeof ACTION_LOG_FILTER_TYPES)[number]
export type ActionLogProjectionType = (typeof ACTION_LOG_PROJECTION_TYPES)[number]
export type ActionLogSourceKey = (typeof ACTION_LOG_SOURCE_KEYS)[number]

type ProjectionInput = {
  actorUserId?: string | null
  actionLabel?: string | null
  changes?: Record<string, unknown> | null
  commandId: string
  context?: Record<string, unknown> | null
  snapshotBefore?: unknown
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function deriveActionLogActionType(input: Pick<ProjectionInput, 'actionLabel' | 'commandId'>): ActionLogProjectionType {
  const normalizedCommandId = normalizeText(input.commandId)
  const normalizedLabel = normalizeText(input.actionLabel)

  if (
    normalizedCommandId.endsWith('.create') ||
    normalizedCommandId.endsWith('.add') ||
    normalizedLabel.includes('create') ||
    normalizedLabel.includes('add')
  ) {
    return 'create'
  }

  if (
    normalizedCommandId.endsWith('.delete') ||
    normalizedCommandId.endsWith('.remove') ||
    normalizedLabel.includes('delete') ||
    normalizedLabel.includes('remove')
  ) {
    return 'delete'
  }

  if (
    normalizedCommandId.endsWith('.assign') ||
    normalizedCommandId.endsWith('.unassign') ||
    normalizedLabel.includes('assign') ||
    normalizedLabel.includes('unassign')
  ) {
    return 'assign'
  }

  if (
    normalizedCommandId.endsWith('.update') ||
    normalizedCommandId.endsWith('.edit') ||
    normalizedCommandId.endsWith('.upsert') ||
    normalizedLabel.includes('update') ||
    normalizedLabel.includes('edit') ||
    normalizedLabel.includes('upsert')
  ) {
    return 'edit'
  }

  return 'system'
}

export function deriveActionLogSource(
  context: Record<string, unknown> | null | undefined,
  actorUserId: string | null | undefined,
): ActionLogSourceKey {
  const rawSource = isRecord(context) ? context.source : undefined
  const normalizedSource = typeof rawSource === 'string' ? rawSource.trim().toLowerCase() : ''

  if (normalizedSource === 'api') return 'api'
  if (normalizedSource === 'system') return 'system'
  if (normalizedSource === 'ui') return 'ui'

  return actorUserId ? 'ui' : 'system'
}

export function deriveActionLogChangedFields(
  changes: Record<string, unknown> | null | undefined,
  snapshotBefore: unknown,
): string[] {
  return Array.from(
    new Set(
      extractChangeRows(changes, snapshotBefore)
        .map((entry) => entry.field)
        .filter((value) => typeof value === 'string' && value.trim().length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

export function deriveActionLogProjection(input: ProjectionInput): {
  actionType: ActionLogProjectionType
  changedFields: string[]
  primaryChangedField: string | null
  sourceKey: ActionLogSourceKey
} {
  const changedFields = deriveActionLogChangedFields(input.changes, input.snapshotBefore)

  return {
    actionType: deriveActionLogActionType(input),
    changedFields,
    primaryChangedField: changedFields[0] ?? null,
    sourceKey: deriveActionLogSource(input.context, input.actorUserId),
  }
}
