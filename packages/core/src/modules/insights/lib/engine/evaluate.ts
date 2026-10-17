import type { ExplainConfidence, ExplainVerdict } from '@open-mercato/shared/modules/insights/explain'
import { valuesEqual } from './normalize'
import {
  EXPLAIN_ORDER_UNCERTAIN_MS,
  EXPLAIN_PENDING_GRACE_MS,
  type EngineChainEntry,
  type EngineEvaluationContext,
  type EngineFieldResult,
  type EngineGap,
  type EngineHint,
  type EngineSummary,
  type FieldTarget,
  type ResolvedValue,
} from './types'

const CONFIDENCE_RANK: Record<ExplainConfidence, number> = { unknown: 0, inferred: 1, proven: 2 }

export function minConfidence(left: ExplainConfidence, right: ExplainConfidence): ExplainConfidence {
  return CONFIDENCE_RANK[left] <= CONFIDENCE_RANK[right] ? left : right
}

function isSnapshotBacked(value: ResolvedValue): boolean {
  return value.known && (value.source === 'snapshot' || value.source === 'implicit')
}

function timeOf(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function effectiveAfter(entry: EngineChainEntry, chainLogIds: ReadonlySet<string>): ResolvedValue {
  if (entry.state === 'undone' && (!entry.undoneBy || !chainLogIds.has(entry.undoneBy))) return entry.from
  return entry.to
}

function markOrderUncertainty(chain: EngineChainEntry[]): void {
  for (let index = 0; index < chain.length - 1; index += 1) {
    const newer = timeOf(chain[index].at)
    const older = timeOf(chain[index + 1].at)
    if (newer === null || older === null) continue
    if (Math.abs(newer - older) < EXPLAIN_ORDER_UNCERTAIN_MS) {
      chain[index].orderUncertain = true
      chain[index + 1].orderUncertain = true
    }
  }
}

function detectChainGaps(chain: EngineChainEntry[], target: FieldTarget): EngineGap[] {
  const gaps: EngineGap[] = []
  const chainLogIds = new Set(chain.map((entry) => entry.logId))
  const kind = target.valueKind
  for (let index = 0; index < chain.length - 1; index += 1) {
    const newer = chain[index]
    const older = chain[index + 1]
    const olderAfter = effectiveAfter(older, chainLogIds)
    if (!isSnapshotBacked(newer.from) || !isSnapshotBacked(olderAfter)) continue
    if (valuesEqual(newer.from.value, olderAfter.value, kind)) continue
    const swappedConsistent = newer.orderUncertain
      && older.orderUncertain
      && isSnapshotBacked(older.from)
      && isSnapshotBacked(newer.to)
      && valuesEqual(older.from.value, newer.to.value, kind)
    if (swappedConsistent) continue
    newer.adjacentGap = true
    older.adjacentGap = true
    gaps.push({ afterLogId: older.logId, beforeLogId: newer.logId, reason: 'unlogged_change', at: newer.at })
  }
  return gaps
}

function isWithinGrace(updatedAt: string | null, now: Date, graceMs: number): boolean {
  const updated = timeOf(updatedAt)
  if (updated === null) return false
  return now.getTime() - updated < graceMs
}

function entryConfidence(entry: EngineChainEntry, derived: boolean): ExplainConfidence {
  if (!entry.from.known && !entry.to.known) return 'unknown'
  if (entry.cause.legacy) return entry.cause.kind === 'unknown' ? 'unknown' : 'inferred'
  if (entry.cause.kind === 'unknown') return 'unknown'
  const consistent = isSnapshotBacked(entry.from) && isSnapshotBacked(entry.to) && !entry.stale && !entry.adjacentGap
  const reliableCause = entry.cause.envelopeVerified && !entry.cause.derivedFromActor && !entry.danglingCausedBy
  if (consistent && reliableCause && !entry.orderUncertain && !derived) return 'proven'
  return 'inferred'
}

type HeadOutcome =
  | { kind: 'empty' }
  | { kind: 'unverifiable' }
  | { kind: 'match'; index: number; viaOrderUncertainSibling: boolean }
  | { kind: 'mismatch' }

function evaluateHead(
  chain: EngineChainEntry[],
  current: ResolvedValue,
  target: FieldTarget,
): HeadOutcome {
  if (chain.length === 0) return { kind: 'empty' }
  const chainLogIds = new Set(chain.map((entry) => entry.logId))
  const head = chain[0]
  const headValue = effectiveAfter(head, chainLogIds)
  if (!headValue.known || !current.known) return { kind: 'unverifiable' }
  if (valuesEqual(current.value, headValue.value, target.valueKind)) {
    return { kind: 'match', index: 0, viaOrderUncertainSibling: false }
  }
  const sibling = chain[1]
  if (head.orderUncertain && sibling?.orderUncertain) {
    const siblingValue = effectiveAfter(sibling, chainLogIds)
    if (siblingValue.known && valuesEqual(current.value, siblingValue.value, target.valueKind)) {
      return { kind: 'match', index: 1, viaOrderUncertainSibling: true }
    }
  }
  return { kind: 'mismatch' }
}

function attributedEntry(chain: EngineChainEntry[], head: HeadOutcome): EngineChainEntry | null {
  if (head.kind === 'match') return chain[head.index] ?? null
  return chain[0] ?? null
}

function buildSummary(
  verdict: ExplainVerdict,
  chain: EngineChainEntry[],
  gaps: EngineGap[],
  head: HeadOutcome,
  context: EngineEvaluationContext,
  derived: boolean,
): EngineSummary {
  if (verdict === 'no_history') {
    return context.noHistoryReasonKey
      ? { key: 'insights.explain.summary.noHistoryModule', params: { reasonKey: context.noHistoryReasonKey } }
      : { key: 'insights.explain.summary.noHistory', params: {} }
  }
  const attributed = attributedEntry(chain, head)
  if (!attributed) return { key: 'insights.explain.summary.notInScannedHistory', params: {} }
  const base = {
    logId: attributed.logId,
    causeKind: attributed.cause.kind,
    at: attributed.at,
    changes: chain.length,
  }
  if (verdict === 'pending') return { key: 'insights.explain.summary.pending', params: base }
  if (verdict === 'unexplained') return { key: 'insights.explain.summary.unexplained', params: base }
  const unlogged = gaps.filter((gap) => gap.reason === 'unlogged_change').length
  if (verdict === 'partially_explained') {
    return { key: 'insights.explain.summary.partiallyExplained', params: { ...base, gaps: unlogged } }
  }
  if (head.kind === 'match' && head.viaOrderUncertainSibling) {
    return { key: 'insights.explain.summary.explainedOrderUncertain', params: base }
  }
  if (derived) return { key: 'insights.explain.summary.derived', params: base }
  if (attributed.cause.legacy) return { key: 'insights.explain.summary.explainedLegacy', params: base }
  return { key: 'insights.explain.summary.explained', params: base }
}

function buildHints(
  verdict: ExplainVerdict,
  chain: EngineChainEntry[],
  gaps: EngineGap[],
  head: HeadOutcome,
  target: FieldTarget,
  context: EngineEvaluationContext,
): EngineHint[] {
  const hints: EngineHint[] = []
  const legacyCount = chain.filter((entry) => entry.cause.legacy).length
  if (legacyCount > 0) hints.push({ key: 'insights.explain.hints.legacyRows', params: { count: legacyCount } })
  if (chain.some((entry) => entry.cause.derivedFromActor)) {
    hints.push({ key: 'insights.explain.hints.actorFallback', params: {} })
  }
  if (chain.some((entry) => entry.stale)) hints.push({ key: 'insights.explain.hints.staleSnapshot', params: {} })
  if (chain.some((entry) => entry.from.source === 'changes' || entry.to.source === 'changes')) {
    hints.push({ key: 'insights.explain.hints.valueFromChanges', params: {} })
  }
  if (chain.some((entry) => entry.orderUncertain)) hints.push({ key: 'insights.explain.hints.orderUncertain', params: {} })
  if (chain.some((entry) => entry.danglingCausedBy)) hints.push({ key: 'insights.explain.hints.danglingCause', params: {} })
  if (head.kind === 'unverifiable') {
    hints.push({
      key: context.current.known ? 'insights.explain.hints.missingSnapshot' : 'insights.explain.hints.currentUnavailable',
      params: {},
    })
  }
  if (verdict === 'pending') {
    hints.push({
      key: 'insights.explain.hints.pending',
      params: { graceSeconds: Math.round((context.graceMs ?? EXPLAIN_PENDING_GRACE_MS) / 1000) },
    })
  }
  const unloggedSuspected = verdict === 'unexplained' || gaps.some((gap) => gap.reason === 'unlogged_change')
  if (unloggedSuspected) {
    for (const writer of target.unloggedWriters) {
      hints.push({ key: 'insights.explain.hints.unloggedWriter', params: { writerId: writer.id, labelKey: writer.labelKey } })
    }
  }
  if (context.noHistoryReasonKey) {
    hints.push({ key: 'insights.explain.hints.noHistoryModule', params: { reasonKey: context.noHistoryReasonKey } })
  }
  if (target.derived) {
    hints.push({ key: 'insights.explain.hints.derived', params: { dependsOn: target.derived.dependsOn.join(', ') } })
  }
  if (context.truncated) hints.push({ key: 'insights.explain.hints.truncated', params: {} })
  if (context.continuation) hints.push({ key: 'insights.explain.hints.continuation', params: {} })
  return hints
}

export function evaluateFieldChain(
  inputChain: readonly EngineChainEntry[],
  target: FieldTarget,
  context: EngineEvaluationContext,
): EngineFieldResult {
  const chain = inputChain.map((entry) => ({
    ...entry,
    orderUncertain: false,
    adjacentGap: false,
    danglingCausedBy: entry.causedByLogId !== null && (context.danglingLogIds?.has(entry.causedByLogId) ?? false),
  }))
  const derived = target.derived !== null
  const graceMs = context.graceMs ?? EXPLAIN_PENDING_GRACE_MS
  markOrderUncertainty(chain)
  const gaps = detectChainGaps(chain, target)

  let verdict: ExplainVerdict
  const scanIncomplete = context.truncated || context.continuation
  const head = context.continuation ? null : evaluateHead(chain, context.current, target)
  if (chain.length === 0) {
    verdict = scanIncomplete ? 'partially_explained' : 'no_history'
  } else if (!head) {
    verdict = gaps.length > 0 ? 'partially_explained' : 'explained'
  } else if (head.kind === 'unverifiable') {
    verdict = 'partially_explained'
  } else if (head.kind === 'match') {
    verdict = gaps.length > 0 ? 'partially_explained' : 'explained'
  } else if (isWithinGrace(context.currentUpdatedAt, context.now, graceMs)) {
    verdict = 'pending'
  } else {
    verdict = 'unexplained'
    chain[0].adjacentGap = true
    gaps.unshift({
      afterLogId: chain[0].logId,
      beforeLogId: null,
      reason: 'current_differs',
      at: context.currentUpdatedAt,
    })
  }

  for (const entry of chain) entry.confidence = entryConfidence(entry, derived)
  if (context.continuation && chain.length > 0) chain[0].confidence = minConfidence(chain[0].confidence, 'inferred')

  const headOutcome: HeadOutcome = head ?? { kind: 'empty' }
  const attributed = attributedEntry(chain, headOutcome)
  let confidence: ExplainConfidence
  if (!attributed) {
    confidence = 'unknown'
  } else if (verdict === 'explained') {
    confidence = attributed.confidence
  } else if (verdict === 'partially_explained') {
    confidence = minConfidence(attributed.confidence, 'inferred')
  } else {
    confidence = 'unknown'
  }
  if (headOutcome.kind === 'match' && headOutcome.viaOrderUncertainSibling) confidence = minConfidence(confidence, 'inferred')
  if (derived) confidence = minConfidence(confidence, 'inferred')
  if (scanIncomplete) confidence = minConfidence(confidence, 'inferred')

  return {
    field: target.key,
    verdict,
    confidence,
    summary: buildSummary(verdict, chain, gaps, headOutcome, context, derived),
    chain,
    gaps,
    hints: buildHints(verdict, chain, gaps, headOutcome, target, context),
    lastChangeAt: chain[0]?.at ?? null,
    dependencies: [],
  }
}
