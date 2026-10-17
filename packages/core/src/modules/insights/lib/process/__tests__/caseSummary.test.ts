import {
  CASE_EVENT_LIMIT,
  buildCaseAggregate,
  compareCaseEventPositions,
  computeVariantHash,
  summarizeCase,
  type CaseEventRow,
} from '../caseSummary'
import { testRegistry } from './processTestSupport'

const [process] = testRegistry().processes

let minute = 0

function event(activityKey: string, overrides: Partial<CaseEventRow> = {}): CaseEventRow {
  minute += 1
  const [field, value] = activityKey.includes(':') ? activityKey.split(':') : [null, null]
  const activityKind = overrides.activityKind
    ?? (activityKey === 'created' || activityKey === 'deleted' ? 'lifecycle' : field && field.includes('.') ? 'milestone' : 'stage')
  return {
    activityKey,
    activityKind,
    occurredAt: new Date(Date.UTC(2026, 9, 8, 10, minute)).toISOString(),
    sourceLogId: `00000000-0000-4000-8000-${String(minute).padStart(12, '0')}`,
    seq: 0,
    actorPseudonym: 'tk1:actor-a',
    causeKind: 'user',
    viaSyncRun: false,
    followupField: activityKind === 'stage' || activityKind === 'milestone' ? field : null,
    followupValue: activityKind === 'stage' || activityKind === 'milestone' ? value : null,
    ...overrides,
  }
}

describe('summarizeCase', () => {
  beforeEach(() => {
    minute = 0
  })

  it('returns null for a case without events', () => {
    expect(summarizeCase(process, [])).toBeNull()
  })

  it('marks a case completed when a stage field reaches an end state', () => {
    const rows = [event('created'), event('status:open'), event('status:won')]
    const summary = summarizeCase(process, rows)
    expect(summary).toEqual(expect.objectContaining({
      status: 'completed',
      startedAt: rows[0].occurredAt,
      lastActivityAt: rows[2].occurredAt,
      endedAt: rows[2].occurredAt,
      eventCount: 3,
      reworkCount: 0,
      truncated: false,
    }))
    expect(summary?.variantKeys).toEqual(['created', 'status:open', 'status:won'])
    expect(summary?.variantHash).toBe(computeVariantHash(['created', 'status:open', 'status:won']))
    expect(summary?.dimensions.stages).toEqual({ status: 'won' })
  })

  it('reopens a completed case and counts re-entries as rework', () => {
    const rows = [event('created'), event('status:open'), event('status:won'), event('status:open')]
    const summary = summarizeCase(process, rows)
    expect(summary).toEqual(expect.objectContaining({ status: 'open', endedAt: null, reworkCount: 1 }))
  })

  it('moves the end time to the latest end-state decision', () => {
    const rows = [event('created'), event('status:won'), event('status:lost')]
    expect(summarizeCase(process, rows)?.endedAt).toBe(rows[2].occurredAt)
  })

  it('completes a case on a declared exit', () => {
    const exiting = testRegistry({
      version: 1,
      processes: [{
        processKey: 'test.quote',
        labelKey: 'x',
        resourceKind: 'test.quote',
        entityId: 'test:quote',
        requiredFeatures: ['test.view'],
        stageFields: [{ key: 'status', labelKey: 'x', valueKind: 'dictionary', snapshotPaths: ['quote.status'] }],
        exits: [{ key: 'converted', labelKey: 'x', commandIds: ['test.quotes.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['quote.id'] }],
      }],
    }).processes[0]
    const rows = [event('created'), event('status:sent'), event('converted', { activityKind: 'lifecycle' })]
    expect(summarizeCase(exiting, rows)).toEqual(expect.objectContaining({ status: 'completed', endedAt: rows[2].occurredAt }))
    expect(summarizeCase(exiting, rows.slice(0, 2))).toEqual(expect.objectContaining({ status: 'open', endedAt: null }))
  })

  it('reports a deleted case with its deletion time', () => {
    const rows = [event('created'), event('status:open'), event('deleted')]
    expect(summarizeCase(process, rows)).toEqual(expect.objectContaining({ status: 'deleted', endedAt: rows[2].occurredAt }))
  })

  it('collapses consecutive duplicates in the variant and keeps follow-ups out of it', () => {
    const rows = [
      event('created'),
      event('ownerUserId:changed', { activityKind: 'followup', followupField: 'ownerUserId', followupValue: 'tk1:owner' }),
      event('payment.created', { activityKind: 'milestone' }),
      event('payment.created', { activityKind: 'milestone' }),
    ]
    expect(summarizeCase(process, rows)?.variantKeys).toEqual(['created', 'payment.created'])
  })

  it('computes actors, automation share and cause buckets', () => {
    const rows = [
      event('created', { causeKind: 'legacy', actorPseudonym: 'tk1:a' }),
      event('status:open', { causeKind: 'workflow', actorPseudonym: null, viaSyncRun: true }),
      event('status:won', { causeKind: 'user', actorPseudonym: 'tk1:b' }),
      event('payment.created', { activityKind: 'milestone', causeKind: 'schedule', actorPseudonym: 'tk1:a' }),
    ]
    const summary = summarizeCase(process, rows)
    expect(summary).toEqual(expect.objectContaining({ distinctActorCount: 2, automatedShare: 0.5 }))
    expect(summary?.dimensions).toEqual(expect.objectContaining({
      causeKinds: { legacy: 1, workflow: 1, user: 1, schedule: 1 },
      legacyEvents: 1,
      syncRunEvents: 1,
    }))
  })

  it('bounds the variant to the first events but keeps whole-case figures exact through the aggregate', () => {
    const rows = [
      event('created', { actorPseudonym: 'tk1:first' }),
      ...Array.from({ length: CASE_EVENT_LIMIT + 5 }, (_unused, index) => event(index % 2 === 0 ? 'status:open' : 'status:negotiation', {
        actorPseudonym: `tk1:actor-${index % 3}`,
        causeKind: index % 4 === 0 ? 'workflow' : 'user',
      })),
      event('status:won', { actorPseudonym: 'tk1:closer', causeKind: 'legacy', viaSyncRun: true }),
    ]
    const summary = summarizeCase(process, rows.slice(0, CASE_EVENT_LIMIT), buildCaseAggregate(rows))
    const last = rows[rows.length - 1]
    expect(summary).toEqual(expect.objectContaining({
      eventCount: rows.length,
      truncated: true,
      status: 'completed',
      startedAt: rows[0].occurredAt,
      lastActivityAt: last.occurredAt,
      endedAt: last.occurredAt,
      distinctActorCount: 5,
    }))
    expect(summary?.variantKeys).toHaveLength(CASE_EVENT_LIMIT)
    expect(summary?.dimensions).toEqual(expect.objectContaining({ stages: { status: 'won' }, legacyEvents: 1, syncRunEvents: 1 }))
    expect(summary?.dimensions.causeKinds).toEqual({ user: 379, workflow: 127, legacy: 1 })
    expect(summary?.automatedShare).toBe(Math.round((127 / rows.length) * 10000) / 10000)
  })

  it('matches a full replay for the final state of a truncated case', () => {
    const rows = [
      event('created'),
      ...Array.from({ length: CASE_EVENT_LIMIT }, (_unused, index) => event(index % 2 === 0 ? 'status:won' : 'status:open')),
      event('deleted'),
      event('created'),
      event('status:lost'),
      event('ownerUserId:changed', { activityKind: 'followup', followupField: 'ownerUserId', followupValue: 'tk1:owner' }),
    ]
    const truncated = summarizeCase(process, rows.slice(0, CASE_EVENT_LIMIT), buildCaseAggregate(rows))
    const replayed = summarizeCase(process, rows.slice(-4))
    expect(truncated).toEqual(expect.objectContaining({ status: 'completed', endedAt: rows[rows.length - 2].occurredAt }))
    expect(replayed).toEqual(expect.objectContaining({ status: truncated?.status, endedAt: truncated?.endedAt }))
    expect(truncated?.dimensions.stages).toEqual({ status: 'lost' })
  })

  it('reports a case deleted after its event window as deleted', () => {
    const rows = [
      event('created'),
      ...Array.from({ length: CASE_EVENT_LIMIT + 2 }, () => event('status:open')),
      event('deleted'),
    ]
    expect(summarizeCase(process, rows.slice(0, CASE_EVENT_LIMIT), buildCaseAggregate(rows)))
      .toEqual(expect.objectContaining({ status: 'deleted', endedAt: rows[rows.length - 1].occurredAt, lastActivityAt: rows[rows.length - 1].occurredAt }))
  })

  it('orders events by time at microsecond precision, then source row and sequence', () => {
    const base = { occurredAt: '2026-10-08T10:00:00.000001Z', sourceLogId: '00000000-0000-4000-8000-000000000002', seq: 0 }
    expect(compareCaseEventPositions(base, { ...base, occurredAt: '2026-10-08T10:00:00.000002Z' })).toBeLessThan(0)
    expect(compareCaseEventPositions(base, { ...base, occurredAt: '2026-10-08T10:00:00.000Z' })).toBeGreaterThan(0)
    expect(compareCaseEventPositions(base, { ...base, sourceLogId: '00000000-0000-4000-8000-000000000001' })).toBeGreaterThan(0)
    expect(compareCaseEventPositions(base, { ...base, seq: 1 })).toBeLessThan(0)
    expect(compareCaseEventPositions(base, { ...base })).toBe(0)
  })
})
