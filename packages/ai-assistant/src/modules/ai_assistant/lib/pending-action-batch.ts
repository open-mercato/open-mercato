/**
 * Batch narrowing for pending-action confirmation.
 *
 * The recheck classifies every previewed row of a bulk pending action as
 * fresh or stale. This helper turns that decision into the exact input the
 * tool handler runs with, so the handler only ever writes what the operator
 * previewed and what passed the recheck, plus the per-row versions captured
 * at preview so each write can assert them.
 *
 * Narrowing follows the `records[]` convention `prepareMutation` uses to
 * match previewed rows (`matchBatchPatch`): every entry carries a string
 * `recordId` (or `id`), matched exactly, and only the first entry for an id
 * is previewed. Input that does not follow the convention cannot be narrowed
 * safely, so a partially stale batch of that shape is refused.
 */
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { AiPendingAction } from '../data/entities'
import type { AiPendingActionFailedRecord } from './pending-action-types'
import type { AiToolDefinition } from './types'

export const PENDING_RECORD_NOT_PREVIEWED_CODE = 'record_not_previewed'
export const PENDING_RECORD_DUPLICATE_DROPPED_CODE = 'record_duplicate_dropped'

export type PendingActionExecutionPlan =
  | {
      kind: 'run'
      input: unknown
      expectedRecordVersions: Record<string, string>
      notPreviewedRecordIds: string[]
      droppedDuplicateRecordIds: string[]
    }
  | {
      kind: 'refuse'
      code: 'stale_version'
      staleRecordIds: string[]
    }

type PlannableAction = Pick<AiPendingAction, 'records' | 'normalizedInput' | 'recordVersion' | 'targetRecordId'>

type PlannableTool = Pick<AiToolDefinition, 'isBulk' | 'loadBeforeRecords'>

export type PendingActionBatchMessages = {
  recordNotPreviewed: string
  recordDuplicateDropped: string
  batchNotApplicable: string
  recordStale: string
  recordMissing: string
  allRecordsStale: string
  singleRecordStale: string
}

export async function resolvePendingActionBatchMessages(): Promise<PendingActionBatchMessages> {
  const { translate } = await resolveTranslations()
  return {
    recordStale: translate(
      'ai_assistant.errors.pendingRecordStale',
      'Record version changed since preview.',
    ),
    recordMissing: translate(
      'ai_assistant.errors.pendingRecordMissing',
      'Record no longer exists.',
    ),
    allRecordsStale: translate(
      'ai_assistant.errors.pendingAllRecordsStale',
      'All pending records are stale; the model must re-propose the batch.',
    ),
    singleRecordStale: translate(
      'ai_assistant.errors.pendingSingleRecordStale',
      'Record version changed since preview; re-propose the mutation.',
    ),
    recordNotPreviewed: translate(
      'ai_assistant.errors.pendingRecordNotPreviewed',
      'This record was not part of the approved preview, so it was not changed.',
    ),
    recordDuplicateDropped: translate(
      'ai_assistant.errors.pendingRecordDuplicateDropped',
      'This record was listed more than once. Only its first, previewed change was applied; the repeated entries were ignored.',
    ),
    batchNotApplicable: translate(
      'ai_assistant.errors.pendingBatchNotApplicable',
      'This batch no longer matches the approved preview, so it cannot be applied. Ask the assistant to re-propose the change.',
    ),
  }
}

export function toNotPreviewedFailedRecords(
  recordIds: string[],
  messages: PendingActionBatchMessages,
): AiPendingActionFailedRecord[] {
  return recordIds.map((recordId) => ({
    recordId,
    error: { code: PENDING_RECORD_NOT_PREVIEWED_CODE, message: messages.recordNotPreviewed },
  }))
}

export function toDuplicateDroppedFailedRecords(
  recordIds: string[],
  messages: PendingActionBatchMessages,
): AiPendingActionFailedRecord[] {
  return recordIds.map((recordId) => ({
    recordId,
    error: { code: PENDING_RECORD_DUPLICATE_DROPPED_CODE, message: messages.recordDuplicateDropped },
  }))
}

function readEntryId(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  const recordId = typeof record.recordId === 'string' && record.recordId.length > 0 ? record.recordId : null
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : null
  if (recordId && id && recordId !== id) return null
  return recordId ?? id
}

function readBatchEntries(input: unknown): unknown[] | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const records = (input as Record<string, unknown>).records
  if (!Array.isArray(records) || records.length === 0) return null
  return records.every((entry) => readEntryId(entry) !== null) ? records : null
}

function collectVersions(
  recordIds: Iterable<string>,
  versionById: Map<string, string | null>,
): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const recordId of recordIds) {
    const version = versionById.get(recordId)
    if (typeof version === 'string' && version.length > 0) versions[recordId] = version
  }
  return versions
}

export function planPendingActionExecution(
  action: PlannableAction,
  tool: PlannableTool,
  staleRecords: AiPendingActionFailedRecord[] | null | undefined,
): PendingActionExecutionPlan {
  const previewed = Array.isArray(action.records) ? action.records : []
  if (previewed.length === 0) {
    if (tool.isBulk === true && typeof tool.loadBeforeRecords === 'function') {
      return { kind: 'refuse', code: 'stale_version', staleRecordIds: [] }
    }
    const expectedRecordVersions: Record<string, string> = {}
    if (
      typeof action.targetRecordId === 'string' &&
      action.targetRecordId.length > 0 &&
      typeof action.recordVersion === 'string' &&
      action.recordVersion.length > 0
    ) {
      expectedRecordVersions[action.targetRecordId] = action.recordVersion
    }
    return {
      kind: 'run',
      input: action.normalizedInput,
      expectedRecordVersions,
      notPreviewedRecordIds: [],
      droppedDuplicateRecordIds: [],
    }
  }

  const versionById = new Map<string, string | null>()
  for (const record of previewed) {
    if (!record || typeof record.recordId !== 'string') continue
    if (!versionById.has(record.recordId)) versionById.set(record.recordId, record.recordVersion ?? null)
  }
  const staleRecordIds = (staleRecords ?? [])
    .filter((entry): entry is AiPendingActionFailedRecord => Boolean(entry) && typeof entry.recordId === 'string')
    .map((entry) => entry.recordId)
  const staleIds = new Set(staleRecordIds)
  const refuse: PendingActionExecutionPlan = { kind: 'refuse', code: 'stale_version', staleRecordIds }

  const entries = readBatchEntries(action.normalizedInput)
  if (!entries) {
    if (staleIds.size > 0) return refuse
    return {
      kind: 'run',
      input: action.normalizedInput,
      expectedRecordVersions: collectVersions(versionById.keys(), versionById),
      notPreviewedRecordIds: [],
      droppedDuplicateRecordIds: [],
    }
  }

  const kept: unknown[] = []
  const keptIds = new Set<string>()
  const notPreviewed = new Set<string>()
  const droppedDuplicates = new Set<string>()
  const seen = new Set<string>()
  for (const entry of entries) {
    const recordId = readEntryId(entry) as string
    if (!versionById.has(recordId)) {
      notPreviewed.add(recordId)
      continue
    }
    if (seen.has(recordId)) {
      droppedDuplicates.add(recordId)
      continue
    }
    seen.add(recordId)
    if (staleIds.has(recordId)) continue
    kept.push(entry)
    keptIds.add(recordId)
  }
  if (kept.length === 0) return refuse

  return {
    kind: 'run',
    input:
      kept.length === entries.length
        ? action.normalizedInput
        : { ...(action.normalizedInput as Record<string, unknown>), records: kept },
    expectedRecordVersions: collectVersions(keptIds, versionById),
    notPreviewedRecordIds: Array.from(notPreviewed),
    droppedDuplicateRecordIds: Array.from(droppedDuplicates),
  }
}
