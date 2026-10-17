import type { ExplainConfidence } from '@open-mercato/shared/modules/insights/explain'
import { buildFieldChain } from './chain'
import { evaluateFieldChain, minConfidence } from './evaluate'
import { isChildEntry, isPlainRecord, readCurrentValue, readPath, readRecordUpdatedAt } from './paths'
import {
  EXPLAIN_DERIVED_MAX_DEPTH,
  type EngineDependency,
  type EngineDependencyTarget,
  type EngineFieldResult,
  type EngineHistoryEntry,
  type EngineSubject,
  type FieldTarget,
} from './types'

export * from './types'
export { buildFieldChain, deriveEntryCause, indexUndoTraces, isUndoTraceEntry } from './chain'
export { evaluateFieldChain, minConfidence } from './evaluate'
export { canonicalDecimal, canonicalValue, toResponseValue, valuesEqual } from './normalize'
export {
  DEFAULT_CUSTOM_FIELD_CONTAINERS,
  customFieldChangeKeys,
  hasCollectionItem,
  readCurrentValue,
  readCustomFieldKeys,
  readPath,
  readRecordUpdatedAt,
} from './paths'
export * from './target'

export type ExplainFieldInput = {
  history: readonly EngineHistoryEntry[]
  target: FieldTarget
  subject: EngineSubject
  current: Record<string, unknown>
  now: Date
  truncated: boolean
  continuation: boolean
  danglingLogIds?: ReadonlySet<string>
  noHistoryReasonKey?: string | null
  graceMs?: number
  resolveDependency?: (key: string) => EngineDependencyTarget | null
}

function resolveCurrentUpdatedAt(current: Record<string, unknown>, target: FieldTarget): string | null {
  const collection = target.collection
  if (collection) {
    const list = readPath(current, collection.currentPath ?? collection.snapshotPath)
    if (list.found && Array.isArray(list.value)) {
      const item = list.value.find((candidate) => {
        if (!isPlainRecord(candidate)) return false
        const lookup = readPath(candidate, collection.itemIdPath)
        return lookup.found && lookup.value !== null && String(lookup.value) === collection.itemId
      })
      const itemUpdatedAt = readRecordUpdatedAt(item)
      if (itemUpdatedAt) return itemUpdatedAt
    }
  }
  return readRecordUpdatedAt(current)
}

function isOwnRow(entry: EngineHistoryEntry, subject: EngineSubject): boolean {
  return entry.resourceKind !== null
    && subject.resourceKinds.includes(entry.resourceKind)
    && entry.resourceId === subject.resourceId
}

function isDeclaredItemRow(entry: EngineHistoryEntry, subject: EngineSubject, itemResourceKinds: readonly string[]): boolean {
  return entry.resourceKind !== null
    && isChildEntry(entry, subject.resourceKinds)
    && itemResourceKinds.includes(entry.resourceKind)
    && entry.parentResourceId === subject.resourceId
}

function collectionLastChangeAt(
  history: readonly EngineHistoryEntry[],
  subject: EngineSubject,
  snapshotPath: string,
  itemResourceKinds: readonly string[],
): string | null {
  for (const entry of history) {
    if (entry.executionState === 'failed') continue
    if (isDeclaredItemRow(entry, subject, itemResourceKinds)) return entry.at
    if (!isOwnRow(entry, subject)) continue
    const changes = isPlainRecord(entry.changes) ? entry.changes : null
    const mentioned = (changes !== null && Object.prototype.hasOwnProperty.call(changes, snapshotPath))
      || (Array.isArray(entry.changedFields) && entry.changedFields.includes(snapshotPath))
    if (mentioned) return entry.at
  }
  return null
}

function explainDependencies(
  input: ExplainFieldInput,
  target: FieldTarget,
  depth: number,
  visited: Set<string>,
): EngineDependency[] {
  if (!target.derived || !input.resolveDependency || depth > EXPLAIN_DERIVED_MAX_DEPTH) return []
  const dependencies: EngineDependency[] = []
  for (const key of target.derived.dependsOn) {
    if (visited.has(key)) continue
    const resolved = input.resolveDependency(key)
    if (!resolved) continue
    if (resolved.kind === 'collection') {
      dependencies.push({
        field: resolved.key,
        labelKey: resolved.labelKey,
        verdict: null,
        confidence: 'inferred',
        lastChangeAt: collectionLastChangeAt(input.history, input.subject, resolved.snapshotPath, resolved.itemResourceKinds),
        dependencies: [],
      })
      continue
    }
    const nextVisited = new Set(visited)
    nextVisited.add(key)
    const result = evaluateTarget(input, resolved.target)
    const confidence: ExplainConfidence = minConfidence(result.confidence, 'inferred')
    dependencies.push({
      field: resolved.target.key,
      labelKey: resolved.target.labelKey,
      verdict: result.verdict,
      confidence,
      lastChangeAt: result.lastChangeAt,
      dependencies: depth < EXPLAIN_DERIVED_MAX_DEPTH
        ? explainDependencies(input, resolved.target, depth + 1, nextVisited)
        : [],
    })
  }
  return dependencies
}

function evaluateTarget(input: ExplainFieldInput, target: FieldTarget): EngineFieldResult {
  const chain = buildFieldChain(input.history, target, input.subject)
  return evaluateFieldChain(chain, target, {
    current: readCurrentValue(input.current, target),
    currentUpdatedAt: resolveCurrentUpdatedAt(input.current, target),
    now: input.now,
    graceMs: input.graceMs,
    truncated: input.truncated,
    continuation: input.continuation,
    danglingLogIds: input.danglingLogIds,
    noHistoryReasonKey: input.noHistoryReasonKey ?? null,
  })
}

export function explainField(input: ExplainFieldInput): EngineFieldResult {
  const result = evaluateTarget(input, input.target)
  if (!input.target.derived) return result
  return {
    ...result,
    dependencies: explainDependencies(input, input.target, 1, new Set([input.target.key])),
  }
}

export function collectExternalCausedByLogIds(history: readonly EngineHistoryEntry[]): string[] {
  const known = new Set(history.map((entry) => entry.logId))
  const external = new Set<string>()
  for (const entry of history) {
    const causedBy = entry.causedByLogId ?? null
    if (causedBy && !known.has(causedBy)) external.add(causedBy)
  }
  return Array.from(external)
}
