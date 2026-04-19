/**
 * Whitelist-based client serializer for {@link AiPendingAction} (Phase 3 WS-C,
 * Step 5.7). The pending-action table carries server-internal fields
 * (`normalizedInput`, `createdByUserId`, `idempotencyKey`) that MUST NOT be
 * exposed to the browser: `normalizedInput` can contain raw tool arguments
 * including PII or credentials; `createdByUserId` leaks an internal principal
 * when the UI never needs it (the `resolvedByUserId` field is the only
 * actor the UI renders); `idempotencyKey` is a deterministic hash that,
 * combined with `(tenantId, organizationId, agentId)`, lets an attacker
 * collide deduplication windows by crafting identical normalized inputs.
 *
 * This helper is shared by the GET /api/ai/actions/:id reconnect route
 * (Step 5.7) and re-used by the confirm (Step 5.8) and cancel (Step 5.9)
 * response bodies so the UI always sees the same shape.
 *
 * The serializer is deliberately WHITELIST-based: adding a new internal
 * column to the entity must never leak to the client as a side-effect of
 * a generic `{...row}` copy. Any new client-visible field MUST be added
 * here explicitly with a matching update to {@link SerializedPendingAction}.
 */

import type {
  AiPendingActionExecutionResult,
  AiPendingActionFailedRecord,
  AiPendingActionFieldDiff,
  AiPendingActionQueueMode,
  AiPendingActionRecordDiff,
  AiPendingActionStatus,
} from './pending-action-types'

/**
 * Client-visible subset of {@link AiPendingAction}. Never includes
 * `normalizedInput`, `createdByUserId`, or `idempotencyKey` — see the
 * module-level doc above.
 */
export interface SerializedPendingAction {
  id: string
  agentId: string
  toolName: string
  status: AiPendingActionStatus
  fieldDiff: AiPendingActionFieldDiff[]
  records: AiPendingActionRecordDiff[] | null
  failedRecords: AiPendingActionFailedRecord[] | null
  sideEffectsSummary: string | null
  attachmentIds: string[]
  targetEntityType: string | null
  targetRecordId: string | null
  recordVersion: string | null
  queueMode: AiPendingActionQueueMode
  executionResult: AiPendingActionExecutionResult | null
  createdAt: string
  expiresAt: string
  resolvedAt: string | null
  resolvedByUserId: string | null
}

/**
 * Minimal row shape the serializer accepts. Defined by name rather than
 * importing the entity class directly so this module stays usable in test
 * contexts that stub the ORM row without loading MikroORM decorators.
 */
export interface SerializablePendingActionRow {
  id: string
  agentId: string
  toolName: string
  status: AiPendingActionStatus
  fieldDiff?: AiPendingActionFieldDiff[] | null
  records?: AiPendingActionRecordDiff[] | null
  failedRecords?: AiPendingActionFailedRecord[] | null
  sideEffectsSummary?: string | null
  attachmentIds?: string[] | null
  targetEntityType?: string | null
  targetRecordId?: string | null
  recordVersion?: string | null
  queueMode?: AiPendingActionQueueMode | null
  executionResult?: AiPendingActionExecutionResult | null
  createdAt: Date | string
  expiresAt: Date | string
  resolvedAt?: Date | string | null
  resolvedByUserId?: string | null
}

function dateToIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

function optionalDateToIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return dateToIso(value)
}

/**
 * Build the client-facing view of a pending action. Strips server-internal
 * fields (`normalizedInput`, `createdByUserId`, `idempotencyKey`) and
 * normalizes Date instances to ISO-8601 strings so the result round-trips
 * through JSON without losing precision.
 */
export function serializePendingActionForClient(
  row: SerializablePendingActionRow,
): SerializedPendingAction {
  return {
    id: row.id,
    agentId: row.agentId,
    toolName: row.toolName,
    status: row.status,
    fieldDiff: Array.isArray(row.fieldDiff) ? row.fieldDiff : [],
    records: Array.isArray(row.records) && row.records.length > 0 ? row.records : null,
    failedRecords:
      Array.isArray(row.failedRecords) && row.failedRecords.length > 0
        ? row.failedRecords
        : null,
    sideEffectsSummary: row.sideEffectsSummary ?? null,
    attachmentIds: Array.isArray(row.attachmentIds) ? row.attachmentIds : [],
    targetEntityType: row.targetEntityType ?? null,
    targetRecordId: row.targetRecordId ?? null,
    recordVersion: row.recordVersion ?? null,
    queueMode: (row.queueMode ?? 'inline') as AiPendingActionQueueMode,
    executionResult: row.executionResult ?? null,
    createdAt: dateToIso(row.createdAt),
    expiresAt: dateToIso(row.expiresAt),
    resolvedAt: optionalDateToIso(row.resolvedAt),
    resolvedByUserId: row.resolvedByUserId ?? null,
  }
}
