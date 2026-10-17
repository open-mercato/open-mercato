import { isUuid } from '@open-mercato/shared/lib/causation/types'
import {
  PROCESS_ACTIVITY_VALUE_PATTERN,
  PROCESS_LEGACY_CAUSE_KIND,
  type ProcessActivityKind,
  type ProcessFieldValueKind,
} from '@open-mercato/shared/modules/insights/process'
import type { ActionLogFieldHistoryEntry } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { isPlainRecord, readFirstPath } from '../engine/paths'
import type { RegisteredProcess, RegisteredProcessField, RegisteredProcessMilestone } from './registry'
import { comparableRawValue, sanitizeActivityValue } from './values'

export type ProcessSourceEntry = Pick<
  ActionLogFieldHistoryEntry,
  | 'logId'
  | 'cursorAt'
  | 'commandId'
  | 'actionType'
  | 'executionState'
  | 'actorUserId'
  | 'actorKind'
  | 'resourceKind'
  | 'resourceId'
  | 'parentResourceKind'
  | 'parentResourceId'
  | 'snapshotBefore'
  | 'snapshotAfter'
  | 'changes'
  | 'causeKind'
  | 'causeId'
  | 'organizationId'
  | 'causation'
  | 'historyAction'
  | 'sourceLogId'
>

export type DerivedActivity = {
  processKey: string
  caseKind: string
  caseId: string
  seq: number
  activityKind: ProcessActivityKind
  activityKey: string
  keyPrefix: string
  keyIncludesValue: boolean
  followupField: string | null
  followupValue: string | null
  valueKind: ProcessFieldValueKind | null
}

export type DerivedEventBase = {
  sourceLogId: string
  occurredAt: string
  actorUserId: string | null
  causeKind: string
  causeId: string | null
  viaSyncRun: boolean
  voided: boolean
}

export type LogDerivation =
  | { kind: 'events'; base: DerivedEventBase; activities: DerivedActivity[] }
  | { kind: 'void'; sourceLogId: string; voidedByLogId: string }
  | { kind: 'skip'; reason: 'failed' | 'no_match' | 'no_activity' | 'undo_without_source' }

type ActivityDraft = Omit<DerivedActivity, 'processKey' | 'caseKind' | 'caseId' | 'seq'>

type LogShape = 'create' | 'delete' | 'update'

const VOIDED_STATES: ReadonlySet<string> = new Set(['undone', 'redone'])

const PERSON_CAUSE_KINDS: ReadonlySet<string> = new Set(['user', 'agent'])

function resolveLogShape(entry: ProcessSourceEntry): LogShape {
  const hasBefore = isPlainRecord(entry.snapshotBefore)
  const hasAfter = isPlainRecord(entry.snapshotAfter)
  if (!hasBefore && hasAfter) return 'create'
  if (hasBefore && !hasAfter) return 'delete'
  if (!hasBefore && !hasAfter) {
    if (entry.actionType === 'create') return 'create'
    if (entry.actionType === 'delete') return 'delete'
  }
  return 'update'
}

function readChange(changes: Record<string, unknown> | null, keys: readonly string[]): { from: unknown; to: unknown } | null {
  if (!changes) return null
  for (const key of keys) {
    const change = changes[key]
    if (isPlainRecord(change) && (Object.prototype.hasOwnProperty.call(change, 'to') || Object.prototype.hasOwnProperty.call(change, 'from'))) {
      return { from: change.from ?? null, to: change.to ?? null }
    }
  }
  return null
}

/**
 * The new value of a field changed by an update row, or `undefined` when the row does not
 * prove a change. Snapshot values at the declared paths win when both sides contain them;
 * otherwise the recorded `changes` under the declared change keys are used.
 */
export function resolveFieldChange(entry: ProcessSourceEntry, field: RegisteredProcessField): { value: unknown } | undefined {
  const before = readFirstPath(entry.snapshotBefore, field.snapshotPaths)
  const after = readFirstPath(entry.snapshotAfter, field.snapshotPaths)
  if (before.found && after.found) {
    return comparableRawValue(before.value) === comparableRawValue(after.value) ? undefined : { value: after.value }
  }
  const change = readChange(entry.changes, field.changeKeys)
  if (!change) return undefined
  return comparableRawValue(change.from) === comparableRawValue(change.to) ? undefined : { value: change.to }
}

function resolveInitialValue(entry: ProcessSourceEntry, field: RegisteredProcessField): { value: unknown } | undefined {
  const after = readFirstPath(entry.snapshotAfter, field.snapshotPaths)
  if (after.found) return { value: after.value }
  const change = readChange(entry.changes, field.changeKeys)
  return change ? { value: change.to } : undefined
}

function valueDraft(
  kind: ProcessActivityKind,
  keyPrefix: string,
  followupField: string,
  field: RegisteredProcessField,
  rawValue: unknown,
): ActivityDraft {
  const value = sanitizeActivityValue(rawValue, field.valueKind)
  return {
    activityKind: kind,
    activityKey: `${keyPrefix}${value}`,
    keyPrefix,
    keyIncludesValue: true,
    followupField,
    followupValue: value,
    valueKind: field.valueKind,
  }
}

function lifecycleDraft(kind: ProcessActivityKind, key: string): ActivityDraft {
  return { activityKind: kind, activityKey: key, keyPrefix: key, keyIncludesValue: false, followupField: null, followupValue: null, valueKind: null }
}

function hasAnyStagePath(snapshot: unknown, process: RegisteredProcess): boolean {
  return process.stageFields.some((field) => readFirstPath(snapshot, field.snapshotPaths).found)
}

/**
 * A row that has both snapshots but whose "before" holds none of the process's stage paths
 * while its "after" does brings the record into the process (e.g. an order materialized from
 * a quote, logged with the quote as "before"); it is projected as a create.
 */
function resolveRootShape(entry: ProcessSourceEntry, process: RegisteredProcess, shape: LogShape): LogShape {
  if (shape !== 'update' || process.stageFields.length === 0) return shape
  if (!isPlainRecord(entry.snapshotBefore) || !isPlainRecord(entry.snapshotAfter)) return shape
  return !hasAnyStagePath(entry.snapshotBefore, process) && hasAnyStagePath(entry.snapshotAfter, process) ? 'create' : shape
}

function deriveRootDrafts(entry: ProcessSourceEntry, process: RegisteredProcess, logShape: LogShape): ActivityDraft[] {
  const shape = resolveRootShape(entry, process, logShape)
  if (shape === 'delete') return [lifecycleDraft('lifecycle', 'deleted')]
  const drafts: ActivityDraft[] = []
  if (shape === 'create') {
    drafts.push(lifecycleDraft('lifecycle', 'created'))
    for (const field of process.stageFields) {
      const initial = resolveInitialValue(entry, field)
      if (!initial) continue
      drafts.push(valueDraft('stage', `${field.key}:`, field.key, field, initial.value))
    }
    return drafts
  }
  for (const field of process.stageFields) {
    const change = resolveFieldChange(entry, field)
    if (!change) continue
    drafts.push(valueDraft('stage', `${field.key}:`, field.key, field, change.value))
  }
  for (const field of process.followupFields) {
    const change = resolveFieldChange(entry, field)
    if (!change) continue
    const value = sanitizeActivityValue(change.value, field.valueKind)
    drafts.push({
      activityKind: 'followup',
      activityKey: `${field.key}:changed`,
      keyPrefix: `${field.key}:changed`,
      keyIncludesValue: false,
      followupField: field.key,
      followupValue: value,
      valueKind: field.valueKind,
    })
  }
  return drafts
}

function deriveMilestoneDrafts(entry: ProcessSourceEntry, milestone: RegisteredProcessMilestone, shape: LogShape): ActivityDraft[] {
  if (shape === 'delete') {
    return milestone.lifecycle.includes('deleted') ? [lifecycleDraft('milestone', `${milestone.key}.deleted`)] : []
  }
  const drafts: ActivityDraft[] = []
  if (shape === 'create') {
    if (milestone.lifecycle.includes('created')) drafts.push(lifecycleDraft('milestone', `${milestone.key}.created`))
    for (const field of milestone.fields) {
      const initial = resolveInitialValue(entry, field)
      if (!initial) continue
      const followupField = `${milestone.key}.${field.key}`
      drafts.push(valueDraft('milestone', `${followupField}:`, followupField, field, initial.value))
    }
    return drafts
  }
  for (const field of milestone.fields) {
    const change = resolveFieldChange(entry, field)
    if (!change) continue
    const followupField = `${milestone.key}.${field.key}`
    drafts.push(valueDraft('milestone', `${followupField}:`, followupField, field, change.value))
  }
  return drafts
}

function normalizeId(value: string | null | undefined): string | null {
  return isUuid(value) ? value.toLowerCase() : null
}

function resolveUndoSource(entry: ProcessSourceEntry): { undo: boolean; sourceLogId: string | null } {
  if (entry.causeKind === 'undo') {
    return { undo: true, sourceLogId: normalizeId(entry.causeId) ?? normalizeId(entry.sourceLogId) }
  }
  if (entry.historyAction === 'undo') return { undo: true, sourceLogId: normalizeId(entry.sourceLogId) }
  return { undo: false, sourceLogId: null }
}

function hasSyncRunFrame(entry: ProcessSourceEntry): boolean {
  if (entry.causeKind === 'sync_run') return true
  return Boolean(entry.causation?.frames?.some((frame) => frame.kind === 'sync_run'))
}

/**
 * The cause id stored in plaintext: an identifier matching `PROCESS_ACTIVITY_VALUE_PATTERN`
 * (subscriber or schedule ids) or a UUID (lower-cased); anything else, and every person cause,
 * is dropped.
 */
function storableCauseId(entry: ProcessSourceEntry): string | null {
  if (!entry.causeKind || PERSON_CAUSE_KINDS.has(entry.causeKind)) return null
  const causeId = entry.causeId
  if (typeof causeId !== 'string') return null
  if (isUuid(causeId)) return causeId.toLowerCase()
  return PROCESS_ACTIVITY_VALUE_PATTERN.test(causeId) ? causeId : null
}

function buildBase(entry: ProcessSourceEntry): DerivedEventBase {
  return {
    sourceLogId: entry.logId.toLowerCase(),
    occurredAt: entry.cursorAt,
    actorUserId: entry.actorKind === 'system' ? null : normalizeId(entry.actorUserId),
    causeKind: entry.causeKind ?? PROCESS_LEGACY_CAUSE_KIND,
    causeId: storableCauseId(entry),
    viaSyncRun: hasSyncRunFrame(entry),
    voided: VOIDED_STATES.has(entry.executionState ?? ''),
  }
}

/**
 * Derives the process activities of one audit row (pure). An undo trace (cause kind `undo`,
 * or a legacy `historyAction: 'undo'` context) never yields activities: it voids the events
 * of the row it undid. A row already undone or redone at ingest yields voided events, so a
 * re-scan reproduces the same `(source_log_id, process_key, seq)` keys. Failed rows yield
 * nothing. Rows recorded before causation tracking keep `cause_kind = 'legacy'`. The cause id
 * of a person (`user`, `agent`) is never copied: actors are only stored as pseudonyms; other
 * cause ids are kept only when they are identifiers or UUIDs.
 */
export function deriveLogActivities(entry: ProcessSourceEntry, processes: readonly RegisteredProcess[]): LogDerivation {
  if (entry.executionState === 'failed') return { kind: 'skip', reason: 'failed' }
  const undo = resolveUndoSource(entry)
  if (undo.undo) {
    if (!undo.sourceLogId) return { kind: 'skip', reason: 'undo_without_source' }
    return { kind: 'void', sourceLogId: undo.sourceLogId, voidedByLogId: entry.logId.toLowerCase() }
  }
  const shape = resolveLogShape(entry)
  const activities: DerivedActivity[] = []
  let matched = false
  for (const process of processes) {
    const drafts: Array<{ caseId: string; draft: ActivityDraft }> = []
    const rootCaseId = entry.resourceKind && process.logResourceKinds.includes(entry.resourceKind)
      ? normalizeId(entry.resourceId)
      : null
    if (rootCaseId) {
      matched = true
      for (const draft of deriveRootDrafts(entry, process, shape)) drafts.push({ caseId: rootCaseId, draft })
    }
    for (const exit of process.exits) {
      if (!entry.commandId || !exit.commandIds.includes(entry.commandId)) continue
      if (!entry.resourceKind || !exit.logResourceKinds.includes(entry.resourceKind)) continue
      const lookup = readFirstPath(entry.snapshotBefore, exit.caseIdPaths)
      const exitCaseId = lookup.found && typeof lookup.value === 'string' ? normalizeId(lookup.value) : null
      if (!exitCaseId) continue
      matched = true
      drafts.push({ caseId: exitCaseId, draft: lifecycleDraft('lifecycle', exit.key) })
    }
    for (const milestone of process.milestones) {
      if (!entry.resourceKind || !milestone.logResourceKinds.includes(entry.resourceKind)) continue
      if (!entry.parentResourceKind || !milestone.parentResourceKinds.includes(entry.parentResourceKind)) continue
      const parentCaseId = normalizeId(entry.parentResourceId)
      if (!parentCaseId) continue
      matched = true
      for (const draft of deriveMilestoneDrafts(entry, milestone, shape)) drafts.push({ caseId: parentCaseId, draft })
    }
    drafts.forEach(({ caseId, draft }, index) => {
      activities.push({ ...draft, processKey: process.processKey, caseKind: process.resourceKind, caseId, seq: index })
    })
  }
  if (!matched) return { kind: 'skip', reason: 'no_match' }
  if (activities.length === 0) return { kind: 'skip', reason: 'no_activity' }
  return { kind: 'events', base: buildBase(entry), activities }
}
