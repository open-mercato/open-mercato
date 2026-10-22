jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CustomerDeal,
  CustomerDealStageTransition,
  CustomerPipelineStage,
} from '../../data/entities'

const DEAL_ID = '550e8400-e29b-41d4-a716-446655440000'
const PIPELINE_ID = '550e8400-e29b-41d4-a716-446655440010'
const DELETED_STAGE_ID = '550e8400-e29b-41d4-a716-446655440aaa'
const LIVE_STAGE_ID = '550e8400-e29b-41d4-a716-446655440bbb'
const CURRENT_STAGE_ID = '550e8400-e29b-41d4-a716-446655440ccc'

const liveStages = new Map([
  [LIVE_STAGE_ID, { id: LIVE_STAGE_ID, pipelineId: PIPELINE_ID, label: 'Proposal', order: 2 }],
  [CURRENT_STAGE_ID, { id: CURRENT_STAGE_ID, pipelineId: PIPELINE_ID, label: 'Negotiation', order: 3 }],
])

function dealSnapshot(pipelineStageId: string | null, pipelineStage: string | null) {
  return {
    deal: {
      id: DEAL_ID,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      title: 'Expansion renewal',
      description: null,
      status: 'open',
      pipelineStage,
      pipelineId: PIPELINE_ID,
      pipelineStageId,
      valueAmount: '12000',
      valueCurrency: 'USD',
      probability: 65,
      expectedCloseAt: null,
      ownerUserId: null,
      source: 'Referral',
      closureOutcome: null,
      lossReasonId: null,
      lossNotes: null,
    },
    people: [],
    primaryPersonEntityId: null,
    companies: [],
    transitions: [],
  }
}

function makeDeal(): CustomerDeal {
  return {
    ...dealSnapshot(CURRENT_STAGE_ID, 'Negotiation').deal,
    createdAt: new Date('2026-04-10T08:00:00.000Z'),
    updatedAt: new Date('2026-04-10T08:00:00.000Z'),
    deletedAt: null,
    people: [] as any,
    companies: [] as any,
    activities: [] as any,
    comments: [] as any,
    stageTransitions: [] as any,
  } as CustomerDeal
}

function makeEm(existingDeal: CustomerDeal | null) {
  const em: any = {
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerDeal) return existingDeal && where.id === existingDeal.id ? existingDeal : null
      if (ctor === CustomerPipelineStage) return liveStages.get(where.id as string) ?? null
      return null
    }),
    find: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => undefined),
    create: jest.fn((ctor: unknown, payload: Record<string, unknown>) => ({ __entity: ctor, ...payload })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (fn: (inner: unknown) => Promise<unknown>) => fn(em)),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
    remove: jest.fn(),
  }
  em.fork = jest.fn(() => em)
  return em
}

function makeCtx(em: unknown): CommandRuntimeContext {
  const queue: unknown[] = []
  const engine: Record<string, jest.Mock> = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn((entry: { entity?: unknown } | undefined) => {
      if (entry?.entity) queue.push(entry)
    }),
  }
  engine.flushOrmEntityChanges = jest.fn(async () => {
    while (queue.length > 0) await engine.emitOrmEntityEvent(queue.shift())
  })
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return engine
        if (token === 'eventBus') return undefined
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as any,
    auth: { sub: '550e8400-e29b-41d4-a716-446655440099', tenantId: 'tenant-1', orgId: 'org-1' } as any,
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

function createdOf(em: { create: jest.Mock }, ctor: unknown): Record<string, unknown>[] {
  return em.create.mock.calls.filter(([entity]) => entity === ctor).map(([, payload]) => payload)
}

function handler(id: string): CommandHandler {
  const registered = commandRegistry.get(id) as CommandHandler | undefined
  if (!registered) throw new Error(`[internal] ${id} not registered`)
  return registered
}

describe('deal undo/redo with a since-deleted pipeline stage', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('update undo clears the stage id instead of restoring a deleted stage and records no transition', async () => {
    const deal = makeDeal()
    const em = makeEm(deal)
    const before = dealSnapshot(DELETED_STAGE_ID, 'Discovery')
    const after = dealSnapshot(CURRENT_STAGE_ID, 'Negotiation')

    await handler('customers.deals.update').undo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { before, after } } },
      ctx: makeCtx(em),
    } as any)

    expect(deal.pipelineStageId).toBeNull()
    expect(deal.pipelineId).toBe(PIPELINE_ID)
    expect(deal.pipelineStage).toBe('Discovery')
    expect(deal.title).toBe('Expansion renewal')
    expect(createdOf(em, CustomerDealStageTransition)).toHaveLength(0)
  })

  it('update undo still restores a stage that exists and records the revert transition', async () => {
    const deal = makeDeal()
    const em = makeEm(deal)
    const before = dealSnapshot(LIVE_STAGE_ID, 'Proposal')
    const after = dealSnapshot(CURRENT_STAGE_ID, 'Negotiation')

    await handler('customers.deals.update').undo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { before, after } } },
      ctx: makeCtx(em),
    } as any)

    expect(deal.pipelineStageId).toBe(LIVE_STAGE_ID)
    expect(deal.pipelineId).toBe(PIPELINE_ID)
    expect(createdOf(em, CustomerDealStageTransition)).toEqual([
      expect.objectContaining({ stageId: LIVE_STAGE_ID, pipelineId: PIPELINE_ID, stageLabel: 'Proposal', stageOrder: 2 }),
    ])
  })

  it('update undo re-creating a missing deal row does not write the deleted stage id', async () => {
    const em = makeEm(null)
    const before = dealSnapshot(DELETED_STAGE_ID, 'Discovery')
    const after = dealSnapshot(CURRENT_STAGE_ID, 'Negotiation')

    await handler('customers.deals.update').undo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { before, after } } },
      ctx: makeCtx(em),
    } as any)

    const [created] = createdOf(em, CustomerDeal)
    expect(created).toEqual(expect.objectContaining({ id: DEAL_ID, pipelineId: PIPELINE_ID, pipelineStageId: null }))
    expect(createdOf(em, CustomerDealStageTransition)).toHaveLength(0)
  })

  it('create redo does not write a deleted stage id onto the re-created deal', async () => {
    const em = makeEm(null)
    const after = dealSnapshot(DELETED_STAGE_ID, 'Discovery')

    await handler('customers.deals.create').redo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { after } } },
      ctx: makeCtx(em),
    } as any)

    const [created] = createdOf(em, CustomerDeal)
    expect(created).toEqual(expect.objectContaining({ id: DEAL_ID, pipelineId: PIPELINE_ID, pipelineStageId: null }))
  })

  it('create redo keeps a stage id that still exists', async () => {
    const em = makeEm(null)
    const after = dealSnapshot(LIVE_STAGE_ID, 'Proposal')

    await handler('customers.deals.create').redo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { after } } },
      ctx: makeCtx(em),
    } as any)

    const [created] = createdOf(em, CustomerDeal)
    expect(created).toEqual(expect.objectContaining({ pipelineStageId: LIVE_STAGE_ID }))
  })

  it('delete undo does not write a deleted stage id onto the restored deal', async () => {
    const em = makeEm(null)
    const before = dealSnapshot(DELETED_STAGE_ID, 'Discovery')

    await handler('customers.deals.delete').undo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { before } } },
      ctx: makeCtx(em),
    } as any)

    const [created] = createdOf(em, CustomerDeal)
    expect(created).toEqual(expect.objectContaining({ id: DEAL_ID, pipelineId: PIPELINE_ID, pipelineStageId: null }))
  })

  it('delete undo keeps a stage id that still exists', async () => {
    const em = makeEm(null)
    const before = dealSnapshot(LIVE_STAGE_ID, 'Proposal')

    await handler('customers.deals.delete').undo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { before } } },
      ctx: makeCtx(em),
    } as any)

    const [created] = createdOf(em, CustomerDeal)
    expect(created).toEqual(expect.objectContaining({ pipelineStageId: LIVE_STAGE_ID }))
  })
})
