import { sanitizeCausation, type CausationFrame } from '@open-mercato/shared/lib/causation/types'
import { valuesEqual } from './normalize'
import { isChildEntry, lookupChanges, resolveEntrySide, UNKNOWN_VALUE, type ChangeLookup } from './paths'
import type {
  EngineCause,
  EngineChainEntry,
  EngineChainState,
  EngineHistoryEntry,
  EngineSubject,
  FieldTarget,
  ResolvedValue,
} from './types'

const NO_MENTION: ChangeLookup = { mentioned: false, from: UNKNOWN_VALUE, to: UNKNOWN_VALUE }

function toChainState(executionState: string | null): EngineChainState {
  if (executionState === 'undone') return 'undone'
  if (executionState === 'redone') return 'redone'
  return 'done'
}

function frameToCause(frame: CausationFrame, envelopeVerified: boolean): EngineCause {
  return {
    kind: frame.kind,
    id: frame.id ?? null,
    ref: frame.ref ?? null,
    legacy: false,
    derivedFromActor: frame.meta?.derivedFrom === 'actor',
    envelopeVerified,
    frames: [frame],
  }
}

/**
 * Derives the recorded cause of one entry. The cause columns are trusted as `proven`
 * evidence only when the decrypted envelope is present, still sanitizes, and its
 * innermost frame kind equals the row's `cause_kind` (`envelopeVerified`).
 */
export function deriveEntryCause(entry: EngineHistoryEntry): { cause: EngineCause; origin: EngineCause | null } {
  const envelope = sanitizeCausation(entry.causation ?? null)
  const frames = envelope?.frames ?? []
  const innermost = frames.length > 0 ? frames[frames.length - 1] : null
  if (entry.causeKind) {
    const innermostMatches = innermost !== null && innermost.kind === entry.causeKind
    const cause: EngineCause = {
      kind: entry.causeKind,
      id: entry.causeId ?? (innermostMatches ? innermost.id ?? null : null),
      ref: innermostMatches ? innermost.ref ?? null : null,
      legacy: false,
      derivedFromActor: innermostMatches && innermost.meta?.derivedFrom === 'actor',
      envelopeVerified: innermostMatches,
      frames,
    }
    const origin = frames.length > 1 ? frameToCause(frames[0], innermostMatches) : null
    return { cause, origin }
  }
  const isLegacyUndo = isUndoTraceEntry(entry)
  const kind = isLegacyUndo ? 'undo' : entry.actorUserId ? 'user' : 'unknown'
  return {
    cause: {
      kind,
      id: isLegacyUndo ? entry.sourceLogId ?? null : null,
      ref: null,
      legacy: true,
      derivedFromActor: false,
      envelopeVerified: false,
      frames: [],
    },
    origin: null,
  }
}

/**
 * True for the trace row the command bus writes when it undoes an entry. Its snapshots
 * are the undone entry's snapshots swapped, not a fresh read of the record. Nested
 * commands executed inside an undo handler share the undo cause but are not traces.
 */
export function isUndoTraceEntry(entry: EngineHistoryEntry): boolean {
  return entry.historyAction === 'undo'
}

function undoTraceSourceLogId(entry: EngineHistoryEntry): string | null {
  if (!isUndoTraceEntry(entry)) return null
  return entry.sourceLogId ?? (entry.causeKind === 'undo' ? entry.causeId : null)
}

export function indexUndoTraces(history: readonly EngineHistoryEntry[]): Map<string, string> {
  const traces = new Map<string, string>()
  for (const entry of history) {
    const sourceLogId = undoTraceSourceLogId(entry)
    if (sourceLogId && !traces.has(sourceLogId)) traces.set(sourceLogId, entry.logId)
  }
  return traces
}

function isDeclaredCollectionItemRow(entry: EngineHistoryEntry, target: FieldTarget, subject: EngineSubject): boolean {
  const collection = target.collection
  if (!collection || entry.resourceKind === null) return false
  if (!isChildEntry(entry, subject.resourceKinds)) return false
  if (!collection.itemResourceKinds.includes(entry.resourceKind)) return false
  if (entry.resourceId !== collection.itemId) return false
  const parentResourceId = entry.parentResourceId ?? null
  return parentResourceId === null || parentResourceId === subject.resourceId
}

function belongsToSubject(entry: EngineHistoryEntry, target: FieldTarget, subject: EngineSubject): boolean {
  const ownRow = entry.resourceKind !== null
    && subject.resourceKinds.includes(entry.resourceKind)
    && entry.resourceId === subject.resourceId
  if (ownRow) return true
  return isDeclaredCollectionItemRow(entry, target, subject)
}

function markSynthesized(value: ResolvedValue): ResolvedValue {
  return value.known ? { ...value, source: 'synthesized' } : value
}

function pickValues(
  before: ResolvedValue,
  after: ResolvedValue,
  changes: ChangeLookup,
  target: FieldTarget,
  legacyFieldList: boolean,
): { from: ResolvedValue; to: ResolvedValue; stale: boolean; relevant: boolean } {
  const kind = target.valueKind
  const valueChanged = before.known && after.known && !valuesEqual(before.value, after.value, kind)
  const snapshotsEqual = before.known && after.known && !valueChanged
  const from = before.known ? before : changes.from
  const to = after.known ? after : changes.to
  if (valueChanged) return { from, to, stale: false, relevant: true }
  if (changes.mentioned) {
    if (!snapshotsEqual) return { from, to, stale: false, relevant: true }
    const changesDiffer = changes.from.known
      && changes.to.known
      && !valuesEqual(changes.from.value, changes.to.value, kind)
    return changesDiffer
      ? { from: changes.from, to: changes.to, stale: true, relevant: true }
      : { from, to, stale: true, relevant: true }
  }
  const snapshotHasPath = before.source === 'snapshot' || after.source === 'snapshot'
  return { from, to, stale: false, relevant: legacyFieldList && snapshotHasPath && !snapshotsEqual }
}

export function buildFieldChain(
  history: readonly EngineHistoryEntry[],
  target: FieldTarget,
  subject: EngineSubject,
): EngineChainEntry[] {
  const undoTraces = indexUndoTraces(history)
  const chain: EngineChainEntry[] = []
  for (const entry of history) {
    if (entry.executionState === 'failed') continue
    if (!belongsToSubject(entry, target, subject)) continue
    const childRow = target.collection !== null && isChildEntry(entry, subject.resourceKinds)
    const allowChangeLookup = target.collection === null || childRow
    const changes = allowChangeLookup ? lookupChanges(entry, target.changeKeys) : NO_MENTION
    const before = resolveEntrySide(entry, 'before', target, subject.resourceKinds)
    const after = resolveEntrySide(entry, 'after', target, subject.resourceKinds)
    const picked = pickValues(before, after, changes, target, entry.changedFields === null)
    if (!picked.relevant) continue
    const { cause, origin } = deriveEntryCause(entry)
    const state = toChainState(entry.executionState)
    chain.push({
      logId: entry.logId,
      at: entry.at,
      cursorAt: readCursorAt(entry),
      state,
      actionType: entry.actionType,
      commandId: entry.commandId,
      from: isUndoTraceEntry(entry) ? markSynthesized(picked.from) : picked.from,
      to: picked.to,
      actorUserId: entry.actorUserId,
      onBehalfOfUserId: entry.onBehalfOfUserId ?? null,
      organizationId: entry.organizationId ?? null,
      cause,
      origin,
      causedByLogId: entry.causedByLogId ?? null,
      correlationId: entry.correlationId ?? null,
      undoneBy: state === 'undone' ? undoTraces.get(entry.logId) ?? null : null,
      stale: picked.stale,
      orderUncertain: false,
      adjacentGap: false,
      danglingCausedBy: false,
      confidence: 'unknown',
    })
  }
  return chain
}

function readCursorAt(entry: EngineHistoryEntry): string | null {
  const candidate = (entry as EngineHistoryEntry & { cursorAt?: unknown }).cursorAt
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}
