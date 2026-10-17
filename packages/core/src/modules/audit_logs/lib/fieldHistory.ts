import { isCauseKind, isUuid, sanitizeCausation, CAUSATION_CONTEXT_KEY } from '@open-mercato/shared/lib/causation/types'
import type { ExplainHistoryEntry } from '@open-mercato/shared/modules/insights/explain'
import { isRecord } from './changeRows'
import { ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY, canonicalizeActorSubject } from './actorSubject'

export const FIELD_HISTORY_MAX_LIMIT = 500
export const FIELD_HISTORY_STATEMENT_TIMEOUT_MS = 5000

export type ActionLogHistoryCursor = {
  at: string
  id: string
}

export type ActionLogFieldHistoryQuery = {
  tenantId: string
  organizationIds: string[] | null
  resourceKinds: string[]
  resourceId: string
  includeChildren?: boolean
  before?: ActionLogHistoryCursor | null
  limit: number
}

export type ActionLogFieldHistoryEntry = ExplainHistoryEntry & {
  cursorAt: string
  organizationId: string | null
  actionLabel: string | null
  onBehalfOfUserId: string | null
  parentResourceKind: string | null
  parentResourceId: string | null
  correlationId: string | null
  causedByLogId: string | null
  causation: ExplainHistoryEntry['causation']
  historyAction: string | null
  sourceLogId: string | null
  actorKind: ActionLogActorKind
}

export type ActionLogActorKind = 'user' | 'api_key' | 'system'

export type ActionLogFieldHistoryPage = {
  entries: ActionLogFieldHistoryEntry[]
  nextBefore: ActionLogHistoryCursor | null
}

export type ActionLogScopeReference = {
  id: string
  organizationId: string | null
  resourceKind: string | null
  resourceId: string | null
}

export type ActionLogCauseCoverageRow = {
  resourceKind: string | null
  causeKind: string | null
  count: number
}

export type ActionLogHistoryTable = {
  id: string
  tenant_id: string | null
  organization_id: string | null
  actor_user_id: string | null
  on_behalf_of_user_id: string | null
  command_id: string
  action_label: string | null
  action_type: string | null
  resource_kind: string | null
  resource_id: string | null
  parent_resource_kind: string | null
  parent_resource_id: string | null
  execution_state: string
  snapshot_before: unknown
  snapshot_after: unknown
  changes_json: unknown
  changed_fields: string[] | null
  context_json: unknown
  cause_kind: string | null
  cause_id: string | null
  correlation_id: string | null
  caused_by_log_id: string | null
  created_at: Date
  deleted_at: Date | null
}

export type ActionLogHistoryDatabase = {
  action_logs: ActionLogHistoryTable
}

export const FIELD_HISTORY_COLUMNS = [
  'action_logs.id',
  'action_logs.tenant_id',
  'action_logs.organization_id',
  'action_logs.actor_user_id',
  'action_logs.on_behalf_of_user_id',
  'action_logs.command_id',
  'action_logs.action_label',
  'action_logs.action_type',
  'action_logs.resource_kind',
  'action_logs.resource_id',
  'action_logs.parent_resource_kind',
  'action_logs.parent_resource_id',
  'action_logs.execution_state',
  'action_logs.snapshot_before',
  'action_logs.snapshot_after',
  'action_logs.changes_json',
  'action_logs.changed_fields',
  'action_logs.context_json',
  'action_logs.cause_kind',
  'action_logs.cause_id',
  'action_logs.correlation_id',
  'action_logs.caused_by_log_id',
  'action_logs.created_at',
] as const

const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/
const SECOND_PRECISION_LENGTH = 19

/**
 * Accepts a UTC `YYYY-MM-DDTHH:MM:SS[.ffffff]Z` timestamp only when it names a real
 * instant: the date must round-trip to the second, so `2026-02-31T00:00:00Z` (which
 * `Date` silently rolls over to March) is rejected.
 */
export function isValidHistoryTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CURSOR_TIMESTAMP_PATTERN.test(value)) return false
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return false
  return new Date(parsed).toISOString().slice(0, SECOND_PRECISION_LENGTH) === value.slice(0, SECOND_PRECISION_LENGTH)
}

export function isValidHistoryCursor(cursor: ActionLogHistoryCursor | null | undefined): cursor is ActionLogHistoryCursor {
  if (!cursor) return false
  if (!isUuid(cursor.id)) return false
  return isValidHistoryTimestamp(cursor.at)
}

export function clampHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 1
  return Math.min(Math.max(Math.trunc(limit), 1), FIELD_HISTORY_MAX_LIMIT)
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return new Date(0).toISOString()
}

function readChangedFields(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function resolveActorKind(actorUserId: string | null, context: Record<string, unknown> | null): ActionLogActorKind {
  if (!actorUserId) return 'system'
  const subject = context ? canonicalizeActorSubject(context[ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY]) : null
  if (subject && subject.storageId === actorUserId) return subject.kind
  return 'user'
}

export function mapFieldHistoryRow(
  decrypted: Record<string, unknown>,
  cursorAt: string,
): ActionLogFieldHistoryEntry {
  const context = isRecord(decrypted.context_json) ? decrypted.context_json : null
  const changes = isRecord(decrypted.changes_json) ? decrypted.changes_json : null
  const causeKind = isCauseKind(decrypted.cause_kind) ? decrypted.cause_kind : null
  const actorUserId = readText(decrypted.actor_user_id)
  return {
    logId: String(decrypted.id),
    at: toIsoString(decrypted.created_at),
    cursorAt,
    commandId: readText(decrypted.command_id),
    actionType: readText(decrypted.action_type),
    executionState: readText(decrypted.execution_state),
    actorUserId,
    resourceKind: readText(decrypted.resource_kind),
    resourceId: readText(decrypted.resource_id),
    changedFields: readChangedFields(decrypted.changed_fields),
    snapshotBefore: decrypted.snapshot_before ?? null,
    snapshotAfter: decrypted.snapshot_after ?? null,
    changes,
    causeKind,
    causeId: readText(decrypted.cause_id),
    organizationId: readText(decrypted.organization_id),
    actionLabel: readText(decrypted.action_label),
    onBehalfOfUserId: readText(decrypted.on_behalf_of_user_id),
    parentResourceKind: readText(decrypted.parent_resource_kind),
    parentResourceId: readText(decrypted.parent_resource_id),
    correlationId: readText(decrypted.correlation_id),
    causedByLogId: readText(decrypted.caused_by_log_id),
    causation: context ? sanitizeCausation(context[CAUSATION_CONTEXT_KEY]) : null,
    historyAction: context ? readText(context.historyAction) : null,
    sourceLogId: context && isUuid(context.sourceLogId) ? context.sourceLogId : null,
    actorKind: resolveActorKind(actorUserId, context),
  }
}
