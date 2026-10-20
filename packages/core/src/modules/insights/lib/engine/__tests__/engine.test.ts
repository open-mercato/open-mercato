import { explainField, collectExternalCausedByLogIds, deriveEntryCause, indexUndoTraces } from '../index'
import { buildDependencyResolver, needsChildHistory, resolveFieldTarget } from '../target'
import type { EngineHistoryEntry, FieldTarget } from '../types'
import {
  ALLOW_ALL,
  DEAL_SUBJECT,
  RECORD_ID,
  USER_ID,
  WORKFLOW_ID,
  dealEntry,
  dealResource,
  envelope,
  nextLogId,
} from './fixtures'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const OLD_UPDATE = '2026-10-08T11:00:00.000Z'

function statusTarget(): FieldTarget {
  const resolution = resolveFieldTarget(dealResource(), 'status', null, ALLOW_ALL)
  if (!resolution.ok) throw new Error('[internal] status target missing')
  return resolution.target
}

function targetFor(field: string, itemId: string | null = null, resource = dealResource()): FieldTarget {
  const resolution = resolveFieldTarget(resource, field, itemId, ALLOW_ALL)
  if (!resolution.ok) throw new Error(`[internal] target ${field} missing: ${resolution.error}`)
  return resolution.target
}

function undoTrace(at: string, source: EngineHistoryEntry, status: { from: unknown; to: unknown }): EngineHistoryEntry {
  return dealEntry(at, {
    status,
    causeKind: 'undo',
    causeId: source.logId,
    causation: { correlationId: 'c', frames: [{ kind: 'user' }, { kind: 'undo', id: source.logId }] },
    historyAction: 'undo',
    sourceLogId: source.logId,
  })
}

function run(
  history: EngineHistoryEntry[],
  current: Record<string, unknown>,
  options: {
    target?: FieldTarget
    truncated?: boolean
    continuation?: boolean
    danglingLogIds?: Set<string>
    noHistoryReasonKey?: string | null
    resource?: ReturnType<typeof dealResource>
    subject?: typeof DEAL_SUBJECT
  } = {},
) {
  const resource = options.resource ?? dealResource()
  return explainField({
    history,
    target: options.target ?? statusTarget(),
    subject: options.subject ?? DEAL_SUBJECT,
    current,
    now: NOW,
    truncated: options.truncated ?? false,
    continuation: options.continuation ?? false,
    danglingLogIds: options.danglingLogIds,
    noHistoryReasonKey: options.noHistoryReasonKey ?? null,
    resolveDependency: buildDependencyResolver(resource, ALLOW_ALL),
  })
}

describe('explain engine — verdicts', () => {
  it('explains a value with consistent post-foundation history as proven', () => {
    const older = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'negotiation' } })
    const newer = dealEntry('2026-10-08T10:00:00.000Z', { status: { from: 'negotiation', to: 'won' } })
    const result = run([newer, older], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('proven')
    expect(result.gaps).toEqual([])
    expect(result.chain.map((entry) => entry.logId)).toEqual([newer.logId, older.logId])
    expect(result.chain[0].cause).toEqual(expect.objectContaining({ kind: 'workflow', id: WORKFLOW_ID, legacy: false }))
    expect(result.chain[0].origin).toEqual(expect.objectContaining({ kind: 'user' }))
    expect(result.chain.every((entry) => entry.confidence === 'proven')).toBe(true)
    expect(result.summary).toEqual({
      key: 'insights.explain.summary.explained',
      params: { logId: newer.logId, causeKind: 'workflow', at: newer.at, changes: 2 },
    })
    expect(result.lastChangeAt).toBe(newer.at)
  })

  it('reports unexplained when the current value differs outside the grace window', () => {
    const entry = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' } })
    const result = run([entry], { status: 'lost', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('unexplained')
    expect(result.confidence).toBe('unknown')
    expect(result.gaps).toEqual([
      { afterLogId: entry.logId, beforeLogId: null, reason: 'current_differs', at: OLD_UPDATE },
    ])
    expect(result.chain[0].confidence).toBe('inferred')
    expect(result.hints).toEqual(expect.arrayContaining([
      { key: 'insights.explain.hints.unloggedWriter', params: { writerId: 'customers.reconcile', labelKey: 'customers.explain.writers.reconcile' } },
    ]))
    expect(result.summary.key).toBe('insights.explain.summary.unexplained')
  })

  it('reports pending when the record changed within the grace window', () => {
    const entry = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' } })
    const result = run([entry], { status: 'lost', updatedAt: '2026-10-08T11:59:00.000Z' })

    expect(result.verdict).toBe('pending')
    expect(result.confidence).toBe('unknown')
    expect(result.gaps).toEqual([])
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.pending', params: { graceSeconds: 120 } }]))
  })

  it('treats a missing updatedAt as outside the grace window', () => {
    const entry = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' } })
    expect(run([entry], { status: 'lost' }).verdict).toBe('unexplained')
  })

  it('reports no_history when nothing touched the field', () => {
    const untouched = dealEntry('2026-10-08T09:00:00.000Z', {
      changedFields: ['deal.title'],
      changes: { 'deal.title': { from: 'a', to: 'b' } },
      snapshotBefore: { deal: { status: 'open', title: 'a' } },
      snapshotAfter: { deal: { status: 'open', title: 'b' } },
    })
    const result = run([untouched], { status: 'open' })

    expect(result.verdict).toBe('no_history')
    expect(result.confidence).toBe('unknown')
    expect(result.chain).toEqual([])
    expect(result.summary).toEqual({ key: 'insights.explain.summary.noHistory', params: {} })
  })

  it('uses the module no-history reason when declared', () => {
    const result = run([], { status: 'open' }, { noHistoryReasonKey: 'customer_groups.explain.noHistory' })

    expect(result.summary).toEqual({
      key: 'insights.explain.summary.noHistoryModule',
      params: { reasonKey: 'customer_groups.explain.noHistory' },
    })
    expect(result.hints).toEqual(expect.arrayContaining([
      { key: 'insights.explain.hints.noHistoryModule', params: { reasonKey: 'customer_groups.explain.noHistory' } },
    ]))
  })

  it('reports partially_explained and an unlogged_change gap between inconsistent entries', () => {
    const older = dealEntry('2026-10-08T08:00:00.000Z', { status: { from: 'open', to: 'negotiation' } })
    const newer = dealEntry('2026-10-08T10:00:00.000Z', { status: { from: 'qualified', to: 'won' } })
    const result = run([newer, older], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('partially_explained')
    expect(result.confidence).toBe('inferred')
    expect(result.gaps).toEqual([
      { afterLogId: older.logId, beforeLogId: newer.logId, reason: 'unlogged_change', at: newer.at },
    ])
    expect(result.chain.map((entry) => entry.confidence)).toEqual(['inferred', 'inferred'])
    expect(result.summary).toEqual(expect.objectContaining({ key: 'insights.explain.summary.partiallyExplained' }))
    expect(result.summary.params.gaps).toBe(1)
  })

  it('never reports a gap when one side lacks the declared path, and infers the entry instead', () => {
    const older = dealEntry('2026-10-08T08:00:00.000Z', {
      status: { from: 'open', to: 'negotiation' },
      snapshotAfter: { deal: { id: RECORD_ID } },
      changes: { 'deal.status': { from: 'open', to: 'negotiation' } },
    })
    const newer = dealEntry('2026-10-08T10:00:00.000Z', { status: { from: 'qualified', to: 'won' } })
    const result = run([newer, older], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.gaps).toEqual([])
    expect(result.verdict).toBe('explained')
    expect(result.chain[1].to).toEqual({ known: true, value: 'negotiation', source: 'changes' })
    expect(result.chain[1].confidence).toBe('inferred')
    expect(result.chain[0].confidence).toBe('proven')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.valueFromChanges', params: {} }]))
  })

  it('reports partially_explained when the newest entry has no value for the field', () => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z', {
      snapshotBefore: { deal: { id: RECORD_ID } },
      snapshotAfter: { deal: { id: RECORD_ID } },
      changes: null,
      changedFields: ['deal.status'],
    })
    const result = run([entry], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('partially_explained')
    expect(result.chain[0].confidence).toBe('unknown')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.missingSnapshot', params: {} }]))
  })

  it('reports partially_explained when the current value cannot be read', () => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z')
    const result = run([entry], { updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('partially_explained')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.currentUnavailable', params: {} }]))
  })

  it('does not report a false gap for equal decimals with different scale', () => {
    const target = targetFor('valueAmount')
    const older = dealEntry('2026-10-08T08:00:00.000Z', {
      changedFields: ['deal.valueAmount'],
      snapshotBefore: { deal: { valueAmount: null } },
      snapshotAfter: { deal: { valueAmount: '10.0000' } },
      changes: null,
    })
    const newer = dealEntry('2026-10-08T10:00:00.000Z', {
      changedFields: ['deal.valueAmount'],
      snapshotBefore: { deal: { valueAmount: '10' } },
      snapshotAfter: { deal: { valueAmount: '12.5000' } },
      changes: null,
    })
    const result = run([newer, older], { valueAmount: 12.5, updatedAt: OLD_UPDATE }, { target })

    expect(result.gaps).toEqual([])
    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('proven')
  })
})

describe('explain engine — confidence', () => {
  it('infers legacy rows and labels them as recorded user actions', () => {
    const legacy = dealEntry('2026-10-08T10:00:00.000Z', { causeKind: null, causeId: null, causation: null })
    const result = run([legacy], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('inferred')
    expect(result.chain[0].cause).toEqual(expect.objectContaining({ kind: 'user', legacy: true }))
    expect(result.summary.key).toBe('insights.explain.summary.explainedLegacy')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.legacyRows', params: { count: 1 } }]))
  })

  it('marks legacy rows without an actor as unknown', () => {
    const legacy = dealEntry('2026-10-08T10:00:00.000Z', { causeKind: null, causeId: null, causation: null, actorUserId: null })
    const result = run([legacy], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.chain[0].cause.kind).toBe('unknown')
    expect(result.chain[0].confidence).toBe('unknown')
    expect(result.confidence).toBe('unknown')
  })

  it('marks rows whose cause is unknown as unknown', () => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z', {
      causeKind: 'unknown',
      causeId: null,
      causation: { correlationId: 'c', frames: [{ kind: 'unknown' }] },
    })
    expect(run([entry], { status: 'won', updatedAt: OLD_UPDATE }).confidence).toBe('unknown')
  })

  it('infers rows whose cause was derived from the actor', () => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z', {
      causeKind: 'user',
      causeId: null,
      causation: { correlationId: 'c', frames: [{ kind: 'user', meta: { derivedFrom: 'actor' } }] },
    })
    const result = run([entry], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.chain[0].cause.derivedFromActor).toBe(true)
    expect(result.confidence).toBe('inferred')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.actorFallback', params: {} }]))
  })

  it('infers rows whose caused_by_log_id does not resolve', () => {
    const parentLogId = nextLogId()
    const entry = dealEntry('2026-10-08T10:00:00.000Z', { causedByLogId: parentLogId })
    const result = run([entry], { status: 'won', updatedAt: OLD_UPDATE }, { danglingLogIds: new Set([parentLogId]) })

    expect(result.chain[0].danglingCausedBy).toBe(true)
    expect(result.confidence).toBe('inferred')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.danglingCause', params: {} }]))
    expect(collectExternalCausedByLogIds([entry])).toEqual([parentLogId])
  })

  it('caps overall confidence at inferred when the scan was truncated', () => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z')
    const result = run([entry], { status: 'won', updatedAt: OLD_UPDATE }, { truncated: true })

    expect(result.chain[0].confidence).toBe('proven')
    expect(result.confidence).toBe('inferred')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.truncated', params: {} }]))
  })

  it('infers stale identity-map snapshots and shows the recorded change values', () => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z', {
      snapshotBefore: { deal: { status: 'won' } },
      snapshotAfter: { deal: { status: 'won' } },
      changes: { 'deal.status': { from: 'open', to: 'won' } },
    })
    const result = run([entry], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.chain).toHaveLength(1)
    expect(result.chain[0].stale).toBe(true)
    expect(result.chain[0].from).toEqual({ known: true, value: 'open', source: 'changes' })
    expect(result.chain[0].confidence).toBe('inferred')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.staleSnapshot', params: {} }]))
  })

  it('flags entries less than 5 ms apart as order-uncertain without inventing a gap', () => {
    const first = dealEntry('2026-10-08T10:00:00.000Z', { status: { from: 'open', to: 'negotiation' } })
    const second = dealEntry('2026-10-08T10:00:00.003Z', { status: { from: 'negotiation', to: 'won' } })
    const result = run([first, second], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.chain.every((entry) => entry.orderUncertain)).toBe(true)
    expect(result.gaps).toEqual([])
    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('inferred')
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.orderUncertain', params: {} }]))
  })

  it('treats a record creation as a proven change from an empty value', () => {
    const created = dealEntry('2026-10-08T10:00:00.000Z', {
      commandId: 'customers.deals.create',
      actionType: 'create',
      snapshotBefore: null,
      snapshotAfter: { deal: { status: 'open' } },
      changes: null,
      changedFields: [],
    })
    const result = run([created], { status: 'open', updatedAt: OLD_UPDATE })

    expect(result.chain[0].from).toEqual({ known: true, value: null, source: 'implicit' })
    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('proven')
  })
})

describe('explain engine — relevance', () => {
  it('includes legacy rows with no changed_fields when the snapshot contains the path', () => {
    const legacy = dealEntry('2026-10-08T10:00:00.000Z', {
      causeKind: null,
      causation: null,
      changedFields: null,
      changes: null,
      snapshotBefore: null,
      snapshotAfter: { deal: { status: 'won' } },
    })
    const result = run([legacy], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.chain).toHaveLength(1)
    expect(result.chain[0].from.known).toBe(false)
    expect(result.verdict).toBe('explained')
  })

  it('skips rows with a field list that does not mention the field and only one snapshot side', () => {
    const partial = dealEntry('2026-10-08T10:00:00.000Z', {
      changedFields: ['deal.title'],
      changes: { 'deal.title': { from: 'a', to: 'b' } },
      snapshotBefore: null,
      snapshotAfter: { deal: { status: 'won' } },
    })
    expect(run([partial], { status: 'won' }).chain).toEqual([])
  })

  it('skips failed executions', () => {
    const failed = dealEntry('2026-10-08T10:00:00.000Z', { executionState: 'failed' })
    expect(run([failed], { status: 'won' }).verdict).toBe('no_history')
  })

  it('ignores rows of other records', () => {
    const foreign = dealEntry('2026-10-08T10:00:00.000Z', { resourceId: 'another-record' })
    expect(run([foreign], { status: 'won' }).chain).toEqual([])
  })
})

describe('explain engine — undo and redo', () => {
  it('links undo trace rows to the source and keeps the chain consistent', () => {
    const source = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' }, executionState: 'undone' })
    const trace = undoTrace('2026-10-08T09:30:00.000Z', source, { from: 'won', to: 'open' })
    const result = run([trace, source], { status: 'open', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('explained')
    expect(result.gaps).toEqual([])
    expect(result.chain[1]).toEqual(expect.objectContaining({ state: 'undone', undoneBy: trace.logId }))
    expect(result.chain[0].cause).toEqual(expect.objectContaining({ kind: 'undo', id: source.logId }))
  })

  it('marks the undo trace value before the undo as synthesized and never proves it', () => {
    const source = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' }, executionState: 'undone' })
    const trace = undoTrace('2026-10-08T09:30:00.000Z', source, { from: 'won', to: 'open' })
    const result = run([trace, source], { status: 'open', updatedAt: OLD_UPDATE })

    expect(result.chain[0].from).toEqual({ known: true, value: 'won', source: 'synthesized' })
    expect(result.chain[0].to).toEqual({ known: true, value: 'open', source: 'snapshot' })
    expect(result.chain[0].confidence).toBe('inferred')
    expect(result.chain[1].confidence).toBe('proven')
    expect(result.confidence).toBe('inferred')
  })

  it('does not compare the synthesized undo value with the previous entry', () => {
    const source = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' }, executionState: 'undone' })
    const otherChange = dealEntry('2026-10-08T09:10:00.000Z', { status: { from: 'won', to: 'lost' } })
    const trace = undoTrace('2026-10-08T09:30:00.000Z', source, { from: 'won', to: 'open' })
    const result = run([trace, otherChange, source], { status: 'open', updatedAt: OLD_UPDATE })

    expect(result.gaps).toEqual([])
    expect(result.chain[0].adjacentGap).toBe(false)
    expect(result.chain[0].confidence).toBe('inferred')
    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('inferred')
  })

  it('treats only rows marked as undo history as traces, not nested writes that share the undo cause', () => {
    const source = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' }, executionState: 'undone' })
    const trace = undoTrace('2026-10-08T09:30:00.000Z', source, { from: 'won', to: 'open' })
    const nested = dealEntry('2026-10-08T09:30:01.000Z', {
      status: { from: 'open', to: 'lost' },
      causeKind: 'undo',
      causeId: source.logId,
      causation: { correlationId: 'c', frames: [{ kind: 'user' }, { kind: 'undo', id: source.logId }] },
    })
    const history = [nested, trace, source]
    const result = run(history, { status: 'lost', updatedAt: OLD_UPDATE })

    expect(indexUndoTraces(history).get(source.logId)).toBe(trace.logId)
    expect(result.chain[2].undoneBy).toBe(trace.logId)
    expect(result.chain[0].from).toEqual({ known: true, value: 'open', source: 'snapshot' })
    expect(result.chain[0].confidence).toBe('proven')
    expect(result.gaps).toEqual([])
  })

  it('represents redo rows with their source log and the redone state', () => {
    const source = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' }, executionState: 'redone' })
    const trace = undoTrace('2026-10-08T09:30:00.000Z', source, { from: 'won', to: 'open' })
    const redo = dealEntry('2026-10-08T09:45:00.000Z', {
      status: { from: 'open', to: 'won' },
      causeKind: 'redo',
      causeId: source.logId,
      causation: { correlationId: 'c', frames: [{ kind: 'user' }, { kind: 'redo', id: source.logId }] },
    })
    const result = run([redo, trace, source], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('explained')
    expect(result.gaps).toEqual([])
    expect(result.chain.map((entry) => entry.state)).toEqual(['done', 'done', 'redone'])
    expect(result.chain[0].cause).toEqual(expect.objectContaining({ kind: 'redo', id: source.logId }))
  })

  it('does not report a gap for an undone entry whose trace is not part of the chain', () => {
    const source = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' }, executionState: 'undone' })
    const later = dealEntry('2026-10-08T10:00:00.000Z', { status: { from: 'open', to: 'lost' } })
    const result = run([later, source], { status: 'lost', updatedAt: OLD_UPDATE })

    expect(result.gaps).toEqual([])
    expect(result.verdict).toBe('explained')
  })

  it('detects legacy undo traces from the copied context', () => {
    const source = dealEntry('2026-10-08T09:00:00.000Z', {
      status: { from: 'open', to: 'won' },
      executionState: 'undone',
      causeKind: null,
      causation: null,
    })
    const trace = dealEntry('2026-10-08T09:30:00.000Z', {
      status: { from: 'won', to: 'open' },
      causeKind: null,
      causeId: null,
      causation: null,
      historyAction: 'undo',
      sourceLogId: source.logId,
    })
    const result = run([trace, source], { status: 'open', updatedAt: OLD_UPDATE })

    expect(result.chain[0].cause).toEqual(expect.objectContaining({ kind: 'undo', id: source.logId, legacy: true }))
    expect(result.chain[1].undoneBy).toBe(trace.logId)
    expect(result.confidence).toBe('inferred')
  })
})

describe('explain engine — custom fields, collections and derived fields', () => {
  it('reads custom fields from the snapshot container and cf_ change keys', () => {
    const target = targetFor('cf:priority')
    const entry = dealEntry('2026-10-08T10:00:00.000Z', {
      changedFields: ['cf_priority'],
      snapshotBefore: { deal: { status: 'open' }, custom: { priority: 'low' } },
      snapshotAfter: { deal: { status: 'open' }, custom: { priority: 'high' } },
      changes: { cf_priority: { from: 'low', to: 'high' } },
    })
    const result = run([entry], { customFields: { priority: 'high' }, updatedAt: OLD_UPDATE }, { target })

    expect(target.changeKeys).toEqual(expect.arrayContaining(['cf_priority', 'cf:priority', 'custom.priority']))
    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('proven')
    expect(result.chain[0].to).toEqual({ known: true, value: 'high', source: 'snapshot' })
  })

  it('treats a missing key in a present custom container as an empty value', () => {
    const target = targetFor('cf:priority')
    const entry = dealEntry('2026-10-08T10:00:00.000Z', {
      changedFields: ['cf_priority'],
      snapshotBefore: { custom: {} },
      snapshotAfter: { custom: { cf_priority: 'high' } },
      changes: null,
    })
    const result = run([entry], { cf_priority: 'high', updatedAt: OLD_UPDATE }, { target })

    expect(result.chain[0].from).toEqual({ known: true, value: null, source: 'implicit' })
    expect(result.verdict).toBe('explained')
  })

  it('explains a collection item from parent snapshots and its own child rows', () => {
    const lineId = 'line-1'
    const resource = dealResource({
      resourceKind: 'sales.order',
      collections: [{
        key: 'lines',
        labelKey: 'sales.lines',
        snapshotPath: 'lines',
        itemIdPath: 'id',
        itemResourceKinds: ['sales.order_line'],
        fields: [{ key: 'unitPrice', labelKey: 'sales.lines.unitPrice', valueKind: 'money', snapshotPaths: ['unitPrice'] }],
      }],
    })
    const subject = { resourceKinds: ['sales.order'], resourceId: RECORD_ID }
    const target = targetFor('lines.unitPrice', lineId, resource)
    const created = dealEntry('2026-10-08T08:00:00.000Z', {
      resourceKind: 'sales.order',
      changedFields: ['lines'],
      changes: { lines: { from: [], to: [{ id: lineId, unitPrice: '5.00' }] } },
      snapshotBefore: { lines: [] },
      snapshotAfter: { lines: [{ id: lineId, unitPrice: '5.00' }, { id: 'line-2', unitPrice: '1' }] },
    })
    const otherLine = dealEntry('2026-10-08T08:30:00.000Z', {
      resourceKind: 'sales.order_line',
      resourceId: 'line-2',
      parentResourceKind: 'sales.order',
      parentResourceId: RECORD_ID,
      changedFields: ['unitPrice'],
      changes: { unitPrice: { from: '1', to: '2' } },
      snapshotBefore: { unitPrice: '1' },
      snapshotAfter: { unitPrice: '2' },
    })
    const ownLine = dealEntry('2026-10-08T09:00:00.000Z', {
      resourceKind: 'sales.order_line',
      resourceId: lineId,
      parentResourceKind: 'sales.order',
      parentResourceId: RECORD_ID,
      changedFields: ['unitPrice'],
      changes: { unitPrice: { from: '5', to: '7.5' } },
      snapshotBefore: { unitPrice: '5' },
      snapshotAfter: { unitPrice: '7.50' },
    })
    const result = run(
      [ownLine, otherLine, created],
      { lines: [{ id: lineId, unitPrice: 7.5 }], updatedAt: OLD_UPDATE },
      { target, resource, subject },
    )

    expect(result.chain.map((entry) => entry.logId)).toEqual([ownLine.logId, created.logId])
    expect(result.chain[1].from).toEqual({ known: true, value: null, source: 'implicit' })
    expect(result.gaps).toEqual([])
    expect(result.verdict).toBe('explained')
  })

  it('reports derived fields as inferred with dependency pointers limited to depth 2', () => {
    const resource = dealResource({
      fields: [
        { key: 'total', labelKey: 'total', valueKind: 'money', snapshotPaths: ['deal.total'], derived: { dependsOn: ['subtotal', 'lines'] } },
        { key: 'subtotal', labelKey: 'subtotal', valueKind: 'money', snapshotPaths: ['deal.subtotal'], derived: { dependsOn: ['base'] } },
        { key: 'base', labelKey: 'base', valueKind: 'money', snapshotPaths: ['deal.base'], derived: { dependsOn: ['deep'] } },
        { key: 'deep', labelKey: 'deep', valueKind: 'money', snapshotPaths: ['deal.deep'] },
      ],
      collections: [{ key: 'lines', labelKey: 'lines', snapshotPath: 'lines', itemIdPath: 'id', fields: [] }],
    })
    const target = targetFor('total', null, resource)
    const entry = dealEntry('2026-10-08T10:00:00.000Z', {
      changedFields: ['deal.subtotal', 'deal.total', 'lines'],
      snapshotBefore: { deal: { total: '1', subtotal: '1' } },
      snapshotAfter: { deal: { total: '2', subtotal: '2' } },
      changes: null,
    })
    const result = run([entry], { total: '2', subtotal: '2', updatedAt: OLD_UPDATE }, { target, resource })

    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('inferred')
    expect(result.chain[0].confidence).toBe('inferred')
    expect(result.summary.key).toBe('insights.explain.summary.derived')
    expect(result.dependencies.map((dependency) => dependency.field)).toEqual(['subtotal', 'lines'])
    expect(result.dependencies[0]).toEqual(expect.objectContaining({ verdict: 'explained', confidence: 'inferred' }))
    expect(result.dependencies[0].dependencies.map((dependency) => dependency.field)).toEqual(['base'])
    expect(result.dependencies[0].dependencies[0].dependencies).toEqual([])
    expect(result.dependencies[1]).toEqual(expect.objectContaining({ verdict: null, lastChangeAt: entry.at }))
  })

  it('omits dependencies the viewer cannot read', () => {
    const resource = dealResource({
      fields: [
        { key: 'total', labelKey: 'total', valueKind: 'money', snapshotPaths: ['deal.total'], derived: { dependsOn: ['margin', 'missing'] } },
        { key: 'margin', labelKey: 'margin', valueKind: 'money', snapshotPaths: ['deal.margin'], requiredFeatures: ['finance.view'] },
      ],
    })
    const gate = (features: readonly string[] | undefined) => !(features ?? []).includes('finance.view')
    const result = explainField({
      history: [],
      target: targetFor('total', null, resource),
      subject: DEAL_SUBJECT,
      current: { total: '1' },
      now: NOW,
      truncated: false,
      continuation: false,
      resolveDependency: buildDependencyResolver(resource, gate),
    })

    expect(result.dependencies).toEqual([])
  })

  it('does not loop on cyclic dependencies', () => {
    const resource = dealResource({
      fields: [
        { key: 'alpha', labelKey: 'alpha', valueKind: 'number', snapshotPaths: ['alpha'], derived: { dependsOn: ['beta'] } },
        { key: 'beta', labelKey: 'beta', valueKind: 'number', snapshotPaths: ['beta'], derived: { dependsOn: ['alpha'] } },
      ],
    })
    const result = run([], { alpha: 1, beta: 1 }, { target: targetFor('alpha', null, resource), resource })

    expect(result.dependencies).toHaveLength(1)
    expect(result.dependencies[0].dependencies).toEqual([])
  })
})

describe('explain engine — continuation pages', () => {
  it('skips the current-value comparison on continuation pages', () => {
    const entry = dealEntry('2026-10-08T09:00:00.000Z', { status: { from: 'open', to: 'won' } })
    const result = run([entry], { status: 'lost', updatedAt: OLD_UPDATE }, { continuation: true })

    expect(result.verdict).toBe('explained')
    expect(result.gaps).toEqual([])
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.continuation', params: {} }]))
  })

  it('caps the newest entry of a continuation page at inferred because its newer neighbour is on another page', () => {
    const toC = dealEntry('2026-10-01T12:00:03.000Z', { status: { from: 'B', to: 'C' } })
    const toBPrime = dealEntry('2026-10-01T12:00:02.000Z', { status: { from: 'A', to: 'Bprime' } })
    const toA = dealEntry('2026-10-01T12:00:01.000Z', { status: { from: 'Z', to: 'A' } })

    const firstPage = run([toC, toBPrime, toA], { status: 'C', updatedAt: OLD_UPDATE })
    expect(firstPage.verdict).toBe('partially_explained')
    expect(firstPage.chain.map((entry) => entry.confidence)).toEqual(['inferred', 'inferred', 'proven'])

    const nextPage = run([toBPrime, toA], { status: 'C', updatedAt: OLD_UPDATE }, { continuation: true })
    expect(nextPage.verdict).toBe('explained')
    expect(nextPage.chain.map((entry) => entry.confidence)).toEqual(['inferred', 'proven'])
    expect(nextPage.confidence).toBe('inferred')
  })

  it.each([
    ['a truncated scan', { truncated: true }],
    ['a continuation page', { continuation: true }],
  ])('never reports no_history for an empty chain on %s', (_label, options) => {
    const untouched = dealEntry('2026-10-08T09:00:00.000Z', {
      changedFields: ['deal.title'],
      changes: { 'deal.title': { from: 'a', to: 'b' } },
      snapshotBefore: { deal: { status: 'open', title: 'a' } },
      snapshotAfter: { deal: { status: 'open', title: 'b' } },
    })
    const result = run([untouched], { status: 'open', updatedAt: OLD_UPDATE }, options)

    expect(result.verdict).toBe('partially_explained')
    expect(result.confidence).toBe('unknown')
    expect(result.chain).toEqual([])
    expect(result.lastChangeAt).toBeNull()
    expect(result.summary).toEqual({ key: 'insights.explain.summary.notInScannedHistory', params: {} })
  })
})

describe('explain engine — order uncertainty', () => {
  it('attributes the summary to the order-uncertain sibling that matches the current value', () => {
    const userChange = dealEntry('2026-10-01T12:00:03.000Z', {
      status: { from: 'X', to: 'Y' },
      causeKind: 'user',
      causeId: USER_ID,
      causation: { correlationId: 'c', frames: [{ kind: 'user', id: USER_ID }] },
    })
    const workflowChange = dealEntry('2026-10-01T12:00:03.002Z', { status: { from: 'Y', to: 'Z' } })
    const result = run([workflowChange, userChange], { status: 'Y', updatedAt: OLD_UPDATE })

    expect(result.verdict).toBe('explained')
    expect(result.confidence).toBe('inferred')
    expect(result.summary).toEqual({
      key: 'insights.explain.summary.explainedOrderUncertain',
      params: { logId: userChange.logId, causeKind: 'user', at: userChange.at, changes: 2 },
    })
    expect(result.chain.find((entry) => entry.logId === result.summary.params.logId)?.actorUserId).toBe(userChange.actorUserId)
  })

  it('keeps the regular summary when the newest entry itself matches', () => {
    const first = dealEntry('2026-10-08T10:00:00.000Z', { status: { from: 'open', to: 'negotiation' } })
    const second = dealEntry('2026-10-08T10:00:00.003Z', { status: { from: 'negotiation', to: 'won' } })
    const result = run([second, first], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.summary.key).toBe('insights.explain.summary.explained')
    expect(result.summary.params.logId).toBe(second.logId)
    expect(result.summary.params.causeKind).toBe('workflow')
    expect(result.summary.params.at).toBe(second.at)
  })
})

describe('explain engine — envelope verification', () => {
  it('proves a cause only when the stored envelope confirms the cause column', () => {
    const verified = dealEntry('2026-10-08T10:00:00.000Z')
    expect(deriveEntryCause(verified).cause.envelopeVerified).toBe(true)
    expect(run([verified], { status: 'won', updatedAt: OLD_UPDATE }).confidence).toBe('proven')
  })

  it.each([
    ['a missing envelope', { causation: null }],
    ['an envelope whose innermost frame is another kind', { causation: envelope('business_rule', 'rule-1') }],
    ['an envelope that does not sanitize', { causation: { correlationId: '', frames: [{ kind: 'workflow' }] } }],
  ])('infers a cause column backed by %s', (_label, overrides) => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z', overrides as Partial<EngineHistoryEntry>)
    const result = run([entry], { status: 'won', updatedAt: OLD_UPDATE })

    expect(result.chain[0].cause).toEqual(expect.objectContaining({ kind: 'workflow', envelopeVerified: false }))
    expect(result.chain[0].confidence).toBe('inferred')
    expect(result.confidence).toBe('inferred')
  })
})

describe('explain engine — collection item rows', () => {
  const lineId = 'line-1'

  function orderResource(itemResourceKinds?: string[]) {
    return dealResource({
      resourceKind: 'sales.order',
      fields: [
        { key: 'total', labelKey: 'total', valueKind: 'money', snapshotPaths: ['order.total'], derived: { dependsOn: ['lines'] } },
      ],
      collections: [{
        key: 'lines',
        labelKey: 'sales.lines',
        snapshotPath: 'lines',
        itemIdPath: 'id',
        ...(itemResourceKinds ? { itemResourceKinds } : {}),
        fields: [{ key: 'unitPrice', labelKey: 'sales.lines.unitPrice', valueKind: 'money', snapshotPaths: ['unitPrice'] }],
      }],
    })
  }

  function childRow(resourceKind: string, at: string) {
    return dealEntry(at, {
      resourceKind,
      resourceId: lineId,
      parentResourceKind: 'sales.order',
      parentResourceId: RECORD_ID,
      changedFields: ['unitPrice'],
      changes: { unitPrice: { from: '5', to: '7.5' } },
      snapshotBefore: { unitPrice: '5' },
      snapshotAfter: { unitPrice: '7.5' },
    })
  }

  const subject = { resourceKinds: ['sales.order'], resourceId: RECORD_ID }

  it('ignores child rows and skips the child scan when the collection declares no item kinds', () => {
    const resource = orderResource()
    const target = targetFor('lines.unitPrice', lineId, resource)
    const result = run(
      [childRow('sales.order_line', '2026-10-08T09:00:00.000Z')],
      { lines: [{ id: lineId, unitPrice: '7.5' }], updatedAt: OLD_UPDATE },
      { target, resource, subject },
    )

    expect(needsChildHistory(resource, target)).toBe(false)
    expect(needsChildHistory(resource, targetFor('total', null, resource))).toBe(false)
    expect(result.chain).toEqual([])
  })

  it('reads only child rows of the declared item kinds', () => {
    const resource = orderResource(['sales.order_line'])
    const target = targetFor('lines.unitPrice', lineId, resource)
    const ownLine = childRow('sales.order_line', '2026-10-08T09:00:00.000Z')
    const payment = childRow('sales.payment', '2026-10-08T10:00:00.000Z')
    const result = run(
      [payment, ownLine],
      { lines: [{ id: lineId, unitPrice: '7.5' }], updatedAt: OLD_UPDATE },
      { target, resource, subject },
    )

    expect(needsChildHistory(resource, target)).toBe(true)
    expect(needsChildHistory(resource, targetFor('total', null, resource))).toBe(true)
    expect(result.chain.map((entry) => entry.logId)).toEqual([ownLine.logId])
  })

  it('does not let undeclared child rows set the collection dependency last change', () => {
    const payment = childRow('sales.payment', '2026-10-08T10:00:00.000Z')
    const line = childRow('sales.order_line', '2026-10-08T09:00:00.000Z')
    const declared = run([payment, line], { total: '1', updatedAt: OLD_UPDATE }, {
      target: targetFor('total', null, orderResource(['sales.order_line'])),
      resource: orderResource(['sales.order_line']),
      subject,
    })
    const undeclared = run([payment, line], { total: '1', updatedAt: OLD_UPDATE }, {
      target: targetFor('total', null, orderResource()),
      resource: orderResource(),
      subject,
    })

    expect(declared.dependencies).toEqual([expect.objectContaining({ field: 'lines', lastChangeAt: line.at })])
    expect(undeclared.dependencies).toEqual([expect.objectContaining({ field: 'lines', lastChangeAt: null })])
  })
})

describe('explain engine — restricted dependency names', () => {
  it('drops dependency keys the viewer cannot read from the target and the derived hint', () => {
    const resource = dealResource({
      fields: [
        { key: 'total', labelKey: 'total', valueKind: 'money', snapshotPaths: ['deal.total'], derived: { dependsOn: ['margin', 'subtotal', 'missing'] } },
        { key: 'margin', labelKey: 'margin', valueKind: 'money', snapshotPaths: ['deal.margin'], requiredFeatures: ['finance.view'] },
        { key: 'subtotal', labelKey: 'subtotal', valueKind: 'money', snapshotPaths: ['deal.subtotal'] },
      ],
    })
    const gate = (features: readonly string[] | undefined) => !(features ?? []).includes('finance.view')
    const resolution = resolveFieldTarget(resource, 'total', null, gate)
    if (!resolution.ok) throw new Error('[internal] total target missing')
    const result = explainField({
      history: [],
      target: resolution.target,
      subject: DEAL_SUBJECT,
      current: { total: '1' },
      now: NOW,
      truncated: false,
      continuation: false,
      resolveDependency: buildDependencyResolver(resource, gate),
    })

    expect(resolution.target.derived).toEqual({ dependsOn: ['subtotal'] })
    expect(result.hints).toEqual(expect.arrayContaining([{ key: 'insights.explain.hints.derived', params: { dependsOn: 'subtotal' } }]))
    expect(JSON.stringify(result)).not.toContain('margin')
  })
})

describe('explain engine — actor', () => {
  it('keeps actor identity on chain entries for later redaction', () => {
    const entry = dealEntry('2026-10-08T10:00:00.000Z', { causation: envelope('workflow', WORKFLOW_ID) })
    const result = run([entry], { status: 'won', updatedAt: OLD_UPDATE })
    expect(result.chain[0].actorUserId).toBe(USER_ID)
  })
})
