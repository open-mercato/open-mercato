/** @jest-environment node */

const emitCustomersEvent = jest.fn<Promise<void>, unknown[]>(async () => {})
const lockEntityReferences = jest.fn(async () => {})
const setCustomFields = jest.fn(async () => {})
const findInteractionUserInScope = jest.fn()
const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

type EmLike = {
  find: (...args: unknown[]) => Promise<unknown>
  findOne: (...args: unknown[]) => Promise<unknown>
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: EmLike, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: EmLike, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

jest.mock('@open-mercato/shared/lib/entities/reference-lock', () => ({
  lockEntityReferences: (...args: unknown[]) => lockEntityReferences(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/data/engine', () => ({
  DefaultDataEngine: jest.fn().mockImplementation((em: { assertFlushed: (label: string) => void }) => ({
    setCustomFields: async (...args: unknown[]) => {
      em.assertFlushed('setCustomFields')
      return setCustomFields(...(args as []))
    },
  })),
}))

jest.mock('../../events', () => ({
  emitCustomersEvent: (...args: unknown[]) => emitCustomersEvent(...(args as [])),
}))

jest.mock('../../lib/interactionUsers', () => ({
  findInteractionUserInScope: (...args: unknown[]) => findInteractionUserInScope(...args),
}))

import type { CommandExecutionContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  registerEntityMergeParticipant,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerDealStageTransition,
  CustomerEntity,
  CustomerPipeline,
  CustomerPipelineStage,
} from '../../data/entities'
import { mergeDealsCommand } from '../deal-merge'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const survivorId = '33333333-3333-4333-8333-333333333333'
const sourceId = '44444444-4444-4444-8444-444444444444'
const personA = '55555555-5555-4555-8555-555555555551'
const personB = '55555555-5555-4555-8555-555555555552'
const personC = '55555555-5555-4555-8555-555555555553'
const companyA = '66666666-6666-4666-8666-666666666661'
const companyB = '66666666-6666-4666-8666-666666666662'
const pipelineId = '77777777-7777-4777-8777-777777777771'
const stageId = '77777777-7777-4777-8777-777777777772'
const otherStageId = '77777777-7777-4777-8777-777777777773'
const lossReasonId = '88888888-8888-4888-8888-888888888881'
const updatedAt = new Date('2026-11-24T10:00:00.000Z')

type Row = Record<string, unknown> & { id: string }

function makeDeal(id: string, overrides: Record<string, unknown> = {}): Row {
  return {
    id,
    tenantId,
    organizationId,
    title: `Deal ${id.slice(0, 4)}`,
    description: null,
    status: 'open',
    pipelineStage: null,
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: null,
    valueCurrency: null,
    probability: null,
    expectedCloseAt: null,
    ownerUserId: null,
    source: null,
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    ...overrides,
  }
}

function serialize(row: Row): string {
  return JSON.stringify(Object.entries(row).map(([key, value]) => {
    if (value instanceof Date) return [key, value.toISOString()]
    if (value && typeof value === 'object' && 'id' in value) return [key, (value as Row).id]
    return [key, value]
  }))
}

type HarnessOptions = {
  survivor?: Record<string, unknown>
  source?: Record<string, unknown> | null
  personLinks?: Array<{ id: string; deal: string; person: string; isPrimary: boolean }>
  companyLinks?: Array<{ id: string; deal: string; company: string }>
  transitions?: Array<Record<string, unknown> & { id: string; deal: string; stageId: string }>
  activityRows?: Row[]
  commentRows?: Row[]
  interactionRows?: Row[]
  linkedRows?: Row[]
}

function createHarness(options: HarnessOptions = {}) {
  const survivor = makeDeal(survivorId, options.survivor)
  const source = options.source === null ? null : makeDeal(sourceId, options.source)
  const deals = [survivor, ...(source ? [source] : [])]
  const dealById = new Map(deals.map((deal) => [deal.id, deal]))
  const entities: Row[] = [
    ...[personA, personB, personC].map((id) => ({ id, kind: 'person', tenantId, organizationId })),
    ...[companyA, companyB].map((id) => ({ id, kind: 'company', tenantId, organizationId })),
  ]
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const personLinks: Row[] = (options.personLinks ?? []).map((link) => ({
    ...link,
    deal: dealById.get(link.deal)!,
    person: entityById.get(link.person)!,
  }))
  const companyLinks: Row[] = (options.companyLinks ?? []).map((link) => ({
    ...link,
    deal: dealById.get(link.deal)!,
    company: entityById.get(link.company)!,
  }))
  const transitions: Row[] = (options.transitions ?? []).map((transition) => ({
    pipelineId,
    stageLabel: 'Stage',
    stageOrder: 1,
    transitionedByUserId: null,
    isActive: true,
    deletedAt: null,
    ...transition,
    deal: dealById.get(transition.deal)!,
  }))
  const tracked = (): Row[] => [...deals, ...personLinks, ...companyLinks, ...transitions]
  let flushed = new Map<Row, string>()
  const violations: string[] = []
  const pendingRemovals = new Set<Row>()
  const removed = new Set<Row>()
  const executeCalls: Array<{ sql: string; params: unknown[] }> = []
  const nativeUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const nativeDeletes: Array<Record<string, unknown>> = []
  let createdCount = 0

  const snapshot = () => {
    flushed = new Map(tracked().map((row) => [row, serialize(row)]))
  }
  const assertFlushed = (label: string) => {
    for (const row of tracked()) {
      const previous = flushed.get(row)
      if (previous !== undefined && previous !== serialize(row)) violations.push(`${label}:${row.id}`)
    }
  }
  const live = (rows: Row[]) => rows.filter((row) => !removed.has(row))
  const dealIdOf = (row: Row) => (row.deal as Row).id
  const inIds = (where: Record<string, unknown>, key: string): string[] => {
    const value = where[key] as { $in?: string[] } | string
    return typeof value === 'string' ? [value] : value?.$in ?? []
  }

  const em: Record<string, unknown> = {
    assertFlushed,
    find: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      assertFlushed('find')
      if (ctor === CustomerDeal) {
        const ids = inIds(where, 'id')
        return deals.filter((deal) => ids.includes(deal.id) && !deal.deletedAt)
      }
      if (ctor === CustomerEntity) {
        const ids = inIds(where, 'id')
        return entities.filter((entity) => ids.includes(entity.id) && entity.kind === where.kind)
      }
      const dealIds = inIds(where, 'deal')
      if (ctor === CustomerDealPersonLink) return live(personLinks).filter((row) => dealIds.includes(dealIdOf(row)))
      if (ctor === CustomerDealCompanyLink) return live(companyLinks).filter((row) => dealIds.includes(dealIdOf(row)))
      if (ctor === CustomerDealStageTransition) {
        return live(transitions).filter((row) => dealIds.includes(dealIdOf(row))
          && (where.deletedAt === undefined || row.deletedAt == null))
      }
      return []
    }),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      assertFlushed('findOne')
      if (ctor === CustomerPipeline) return where.id === pipelineId ? { id: pipelineId } : null
      if (ctor === CustomerPipelineStage) {
        if (where.id === stageId) return { id: stageId, pipelineId, label: 'Negotiation' }
        if (where.id === otherStageId) return { id: otherStageId, pipelineId: '99999999-9999-4999-8999-999999999999', label: 'Other' }
        return null
      }
      if (ctor === DictionaryEntry) {
        return where.id === lossReasonId ? { id: lossReasonId, dictionary: { key: 'sales.deal_loss_reason' } } : null
      }
      return null
    }),
    create: jest.fn((ctor: unknown, data: Record<string, unknown>) => {
      createdCount += 1
      return { id: `created-${createdCount}`, __ctor: ctor, ...data }
    }),
    persist: jest.fn((row: Row & { __ctor?: unknown }) => {
      if (row.__ctor === CustomerDealPersonLink) personLinks.push(row)
      if (row.__ctor === CustomerDealCompanyLink) companyLinks.push(row)
    }),
    remove: jest.fn((row: Row) => {
      pendingRemovals.add(row)
    }),
    flush: jest.fn(async () => {
      for (const row of pendingRemovals) removed.add(row)
      pendingRemovals.clear()
      const seen = new Map<string, Row>()
      for (const row of live(transitions)) {
        const key = `${dealIdOf(row)}:${row.stageId}`
        if (seen.has(key)) violations.push(`unique:${key}`)
        seen.set(key, row)
      }
      snapshot()
    }),
    nativeUpdate: jest.fn(async (_ctor: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      assertFlushed('nativeUpdate')
      nativeUpdates.push({ where, data })
      return 0
    }),
    nativeDelete: jest.fn(async (_ctor: unknown, where: Record<string, unknown>) => {
      assertFlushed('nativeDelete')
      nativeDeletes.push(where)
      return 0
    }),
    execute: jest.fn(async (sql: string, params: unknown[]) => {
      assertFlushed('execute')
      executeCalls.push({ sql, params })
      if (sql.includes('from customer_activities')) return options.activityRows ?? []
      if (sql.includes('from customer_comments')) return options.commentRows ?? []
      if (sql.includes('linked_entities @>')) return options.linkedRows ?? []
      if (sql.includes('from customer_interactions')) return options.interactionRows ?? []
      return []
    }),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork = jest.fn(() => em)
  snapshot()

  const markOrmEntityChange = jest.fn()
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === 'em') return em
      if (key === 'dataEngine') return { markOrmEntityChange }
      throw new Error(`[internal] unexpected ${key}`)
    }),
  }
  const ctx = {
    container,
    auth: { tenantId, orgId: organizationId, sub: 'user-1' },
    selectedOrganizationId: organizationId,
    organizationScope: null,
    organizationIds: [organizationId],
  } as unknown as CommandExecutionContext

  return {
    ctx,
    em,
    survivor,
    source,
    personLinks,
    companyLinks,
    transitions,
    removed,
    violations,
    executeCalls,
    nativeUpdates,
    nativeDeletes,
    markOrmEntityChange,
    liveLinks: () => live(personLinks),
    liveCompanyLinks: () => live(companyLinks),
    liveTransitions: () => live(transitions),
  }
}

function buildInput(overrides: Record<string, unknown> = {}, valueOverrides: Record<string, unknown> = {}) {
  return {
    survivorId,
    sourceId,
    survivorUpdatedAt: updatedAt.toISOString(),
    sourceUpdatedAt: updatedAt.toISOString(),
    values: {
      title: 'Merged deal',
      description: null,
      status: 'open',
      pipelineStage: null,
      pipelineId: null,
      pipelineStageId: null,
      valueAmount: 1500,
      valueCurrency: 'USD',
      probability: 40,
      expectedCloseAt: null,
      ownerUserId: null,
      source: null,
      lossReasonId: null,
      lossNotes: null,
      ...valueOverrides,
    },
    customFields: { priority: 'high' },
    personIds: [],
    companyIds: [],
    primaryPersonEntityId: null,
    ...overrides,
  }
}

describe('customers.deals.merge execute', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetEntityMergeParticipantsForTests()
    emitCustomersEvent.mockImplementation(async () => {})
    findInteractionUserInScope.mockResolvedValue({ id: 'owner' })
  })

  it('persists survivor scalars before any later query in the transaction', async () => {
    const harness = createHarness({
      personLinks: [{ id: 'pl-1', deal: survivorId, person: personA, isPrimary: true }],
      companyLinks: [{ id: 'cl-1', deal: sourceId, company: companyA }],
      transitions: [{ id: 't-1', deal: sourceId, stageId, transitionedAt: new Date('2026-01-01') }],
    })
    registerEntityMergeParticipant({
      id: 'probe',
      entityId: 'customers:customer_deal',
      merge: async () => {
        (harness.em.assertFlushed as (label: string) => void)('participant')
        return { moved: 0, deduplicated: 0 }
      },
    })

    await mergeDealsCommand.execute(buildInput({
      personIds: [personA, personB],
      primaryPersonEntityId: personB,
      companyIds: [companyA],
    }), harness.ctx)

    expect(harness.violations).toEqual([])
    expect(harness.survivor.title).toBe('Merged deal')
    expect(harness.survivor.valueAmount).toBe('1500')
    expect(harness.em.commit).toHaveBeenCalled()
    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({ recordId: survivorId, values: { priority: 'high' } }))
    expect(harness.removed.has(harness.source!)).toBe(true)
  })

  it('reconciles people with dedupe, removal and a single primary', async () => {
    const harness = createHarness({
      personLinks: [
        { id: 'pl-s-a', deal: survivorId, person: personA, isPrimary: true },
        { id: 'pl-s-c', deal: survivorId, person: personC, isPrimary: false },
        { id: 'pl-src-a', deal: sourceId, person: personA, isPrimary: false },
        { id: 'pl-src-b', deal: sourceId, person: personB, isPrimary: true },
      ],
    })

    await mergeDealsCommand.execute(buildInput({
      personIds: [personA, personB],
      primaryPersonEntityId: personB,
    }), harness.ctx)

    const links = harness.liveLinks()
    expect(links.map((link) => (link.person as Row).id).sort()).toEqual([personA, personB].sort())
    expect(links.every((link) => (link.deal as Row).id === survivorId)).toBe(true)
    expect(links.filter((link) => link.isPrimary).map((link) => (link.person as Row).id)).toEqual([personB])
    expect(links.map((link) => link.id).sort()).toEqual(['pl-s-a', 'pl-src-b'])
    expect(harness.violations).toEqual([])
  })

  it('reconciles companies by reparenting, deduplicating and creating links', async () => {
    const harness = createHarness({
      companyLinks: [
        { id: 'cl-s-a', deal: survivorId, company: companyA },
        { id: 'cl-src-a', deal: sourceId, company: companyA },
      ],
    })

    await mergeDealsCommand.execute(buildInput({ companyIds: [companyA, companyB] }), harness.ctx)

    const links = harness.liveCompanyLinks()
    expect(links.map((link) => (link.company as Row).id).sort()).toEqual([companyA, companyB].sort())
    expect(links.every((link) => (link.deal as Row).id === survivorId)).toBe(true)
    expect(links.find((link) => (link.company as Row).id === companyA)?.id).toBe('cl-s-a')
  })

  it('rejects people outside the scoped selection', async () => {
    const harness = createHarness()
    await expect(mergeDealsCommand.execute(buildInput({
      personIds: ['12121212-1212-4121-8121-121212121212'],
    }), harness.ctx)).rejects.toMatchObject({ status: 400 })
    expect(harness.em.rollback).toHaveBeenCalled()
  })

  it('keeps the earliest stage transition, handles soft-deleted rows and avoids unique collisions', async () => {
    const harness = createHarness({
      transitions: [
        { id: 't-s-1', deal: survivorId, stageId, transitionedAt: new Date('2026-03-01'), stageLabel: 'Late' },
        { id: 't-src-1', deal: sourceId, stageId, transitionedAt: new Date('2026-01-01'), stageLabel: 'Early' },
        { id: 't-s-2', deal: survivorId, stageId: otherStageId, transitionedAt: new Date('2026-02-01'), deletedAt: new Date('2026-02-02') },
        { id: 't-src-2', deal: sourceId, stageId: otherStageId, transitionedAt: new Date('2026-04-01') },
        { id: 't-src-3', deal: sourceId, stageId: '77777777-7777-4777-8777-777777777774', transitionedAt: new Date('2026-05-01'), deletedAt: new Date('2026-05-02') },
      ],
    })

    await mergeDealsCommand.execute(buildInput(), harness.ctx)

    const live = harness.liveTransitions()
    expect(live.every((row) => (row.deal as Row).id === survivorId)).toBe(true)
    expect(live.map((row) => row.id).sort()).toEqual(['t-s-1', 't-s-2', 't-src-3'])
    const first = live.find((row) => row.id === 't-s-1')!
    expect(first.stageLabel).toBe('Early')
    expect((first.transitionedAt as Date).toISOString()).toBe(new Date('2026-01-01').toISOString())
    const revived = live.find((row) => row.id === 't-s-2')!
    expect(revived.deletedAt).toBeNull()
    expect(harness.violations).toEqual([])
  })

  it('derives closure from status, clears loss details for won and emits deal.won', async () => {
    const harness = createHarness({ source: { status: 'win', closureOutcome: null } })

    await mergeDealsCommand.execute(buildInput({}, {
      status: 'won',
      closureOutcome: null,
      lossReasonId,
      lossNotes: 'stale',
    }), harness.ctx)

    expect(harness.survivor.status).toBe('win')
    expect(harness.survivor.closureOutcome).toBe('won')
    expect(harness.survivor.lossReasonId).toBeNull()
    expect(harness.survivor.lossNotes).toBeNull()
    expect(emitCustomersEvent).toHaveBeenCalledWith('customers.deal.won', expect.objectContaining({ id: survivorId }), expect.objectContaining({ tenantId, organizationId }))
  })

  it('accepts lost without loss details, validates loss reason scope and emits deal.lost', async () => {
    const harness = createHarness()
    await mergeDealsCommand.execute(buildInput({}, { status: 'loose' }), harness.ctx)
    expect(harness.survivor.status).toBe('lost')
    expect(harness.survivor.closureOutcome).toBe('lost')
    expect(emitCustomersEvent).toHaveBeenCalledWith('customers.deal.lost', expect.anything(), expect.anything())

    const invalid = createHarness()
    await expect(mergeDealsCommand.execute(buildInput({}, {
      status: 'lost',
      lossReasonId: '88888888-8888-4888-8888-888888888889',
    }), invalid.ctx)).rejects.toMatchObject({ status: 400 })
  })

  it('treats closed status as non-terminal outcome and does not emit closure events when unchanged', async () => {
    const harness = createHarness({ survivor: { status: 'win', closureOutcome: 'won' } })
    await mergeDealsCommand.execute(buildInput({}, { status: 'win' }), harness.ctx)
    expect(emitCustomersEvent).not.toHaveBeenCalledWith('customers.deal.won', expect.anything(), expect.anything())

    const closed = createHarness()
    await mergeDealsCommand.execute(buildInput({}, { status: 'closed' }), closed.ctx)
    expect(closed.survivor.closureOutcome).toBeNull()
  })

  it('validates pipeline stage membership and owner scope', async () => {
    const mismatch = createHarness()
    await expect(mergeDealsCommand.execute(buildInput({}, {
      pipelineId,
      pipelineStageId: otherStageId,
    }), mismatch.ctx)).rejects.toMatchObject({ status: 400 })

    const ok = createHarness()
    await mergeDealsCommand.execute(buildInput({}, { pipelineId, pipelineStageId: stageId }), ok.ctx)
    expect(ok.survivor.pipelineStage).toBe('Negotiation')

    findInteractionUserInScope.mockResolvedValueOnce(null)
    const owner = createHarness()
    await expect(mergeDealsCommand.execute(buildInput({}, {
      ownerUserId: '99999999-9999-4999-8999-999999999991',
    }), owner.ctx)).rejects.toMatchObject({ status: 400 })
  })

  it('accepts a pipeline and stage pair already stored on either Deal even when it no longer resolves', async () => {
    const legacyPipelineId = '77777777-7777-4777-8777-777777777781'
    const legacyStageId = '77777777-7777-4777-8777-777777777782'
    const legacy = createHarness({
      source: { pipelineId: legacyPipelineId, pipelineStageId: legacyStageId, pipelineStage: 'Legacy stage' },
    })
    await mergeDealsCommand.execute(buildInput({}, {
      pipelineId: legacyPipelineId,
      pipelineStageId: legacyStageId,
    }), legacy.ctx)
    expect(legacy.survivor.pipelineId).toBe(legacyPipelineId)
    expect(legacy.survivor.pipelineStageId).toBe(legacyStageId)
    expect(legacy.survivor.pipelineStage).toBe('Legacy stage')

    const unknown = createHarness()
    await expect(mergeDealsCommand.execute(buildInput({}, {
      pipelineId: legacyPipelineId,
      pipelineStageId: legacyStageId,
    }), unknown.ctx)).rejects.toMatchObject({ status: 400 })
  })

  it('rewrites linked_entities and reindexes moved activities, comments and interactions', async () => {
    const harness = createHarness({
      activityRows: [{ id: 'act-1', entity_id: personA }],
      commentRows: [{ id: 'com-1', entity_id: personA }],
      interactionRows: [{ id: 'int-1', entity_id: personA, interaction_type: 'call', status: 'done', source: null }],
      linkedRows: [
        {
          id: 'int-2',
          entity_id: personB,
          interaction_type: 'meeting',
          status: 'planned',
          source: null,
          deal_id: null,
          deleted_at: null,
          linked_entities: [
            { id: sourceId, type: 'deal', label: 'Old' },
            { id: survivorId, type: 'deal', label: 'Kept' },
            { id: personA, type: 'person', label: 'Ann' },
          ],
        },
      ],
    })

    await mergeDealsCommand.execute(buildInput(), harness.ctx)

    const update = harness.executeCalls.find((call) => call.sql.startsWith('update customer_interactions'))
    expect(update).toBeDefined()
    expect(JSON.parse(update!.params[0] as string)).toEqual([
      { id: survivorId, type: 'deal', label: 'Kept' },
      { id: personA, type: 'person', label: 'Ann' },
    ])
    expect(update!.params.slice(1)).toEqual(['int-2', tenantId, organizationId])
    const reindexed = harness.markOrmEntityChange.mock.calls.map(([entry]) => [entry.indexer?.entityType, entry.identifiers.id])
    expect(reindexed).toEqual(expect.arrayContaining([
      ['customers:customer_activity', 'act-1'],
      ['customers:customer_comment', 'com-1'],
      ['customers:customer_interaction', 'int-1'],
      ['customers:customer_interaction', 'int-2'],
    ]))
    expect(harness.nativeUpdates).toHaveLength(3)
    for (const { where } of harness.nativeUpdates) {
      expect(where).toEqual(expect.objectContaining({ tenantId, organizationId }))
    }
  })

  it('rolls back and propagates a participant failure without side effects', async () => {
    const harness = createHarness()
    registerEntityMergeParticipant({
      id: 'failing',
      entityId: 'customers:customer_deal',
      merge: async () => {
        throw new Error('participant failed')
      },
    })

    await expect(mergeDealsCommand.execute(buildInput(), harness.ctx)).rejects.toThrow('participant failed')
    expect(harness.em.rollback).toHaveBeenCalled()
    expect(harness.em.commit).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
    expect(emitCustomersEvent).not.toHaveBeenCalled()
  })

  it('keeps a committed merge successful and reports when the merged event emit fails', async () => {
    const harness = createHarness()
    emitCustomersEvent.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'customers.deal.merged') throw new Error('bus down')
    })

    const result = await mergeDealsCommand.execute(buildInput(), harness.ctx)

    expect(result).toMatchObject({ survivorId, sourceId })
    expect(harness.em.commit).toHaveBeenCalled()
    expect(emitCustomersEvent).toHaveBeenCalledWith('customers.deal.merged', expect.objectContaining({ survivorId, sourceId }), expect.anything())
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      module: 'customers',
      code: 'customers.deal_merge_merged_event_failed',
    }))
  })

  it('returns a structured 409 when the source Deal is gone', async () => {
    const harness = createHarness({ source: null })
    const error = await mergeDealsCommand.execute(buildInput(), harness.ctx).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CrudHttpError)
    expect(error).toMatchObject({ status: 409, body: expect.objectContaining({ code: 'optimistic_lock_conflict' }) })
    expect(harness.em.rollback).toHaveBeenCalled()
  })

  it('returns a structured 409 when the source token is stale', async () => {
    const harness = createHarness({ source: { updatedAt: new Date('2026-11-24T12:00:00.000Z') } })
    await expect(mergeDealsCommand.execute(buildInput(), harness.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'optimistic_lock_conflict' }),
    })
  })
})
