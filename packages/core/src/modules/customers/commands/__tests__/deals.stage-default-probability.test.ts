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
  CustomerPipeline,
  CustomerPipelineStage,
} from '../../data/entities'

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001'
const ORG_ID = '550e8400-e29b-41d4-a716-446655440002'
const DEAL_ID = '550e8400-e29b-41d4-a716-446655440000'
const PIPELINE_ID = '550e8400-e29b-41d4-a716-446655440010'
const STAGE_A_ID = '550e8400-e29b-41d4-a716-446655440011'
const STAGE_B_ID = '550e8400-e29b-41d4-a716-446655440012'
const STAGE_C_ID = '550e8400-e29b-41d4-a716-446655440013'

function createKyselyStub() {
  const chain: any = {}
  for (const method of ['select', 'selectAll', 'where', 'orderBy', 'limit', 'offset', 'values', 'set', 'onConflict', 'returning']) {
    chain[method] = jest.fn(() => chain)
  }
  chain.executeTakeFirst = jest.fn(async () => undefined)
  chain.execute = jest.fn(async () => [])
  return {
    selectFrom: jest.fn(() => chain),
    insertInto: jest.fn(() => chain),
    updateTable: jest.fn(() => chain),
    deleteFrom: jest.fn(() => chain),
  }
}

function buildDeal(overrides: Partial<CustomerDeal> = {}): CustomerDeal {
  return {
    id: DEAL_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    title: 'Expansion renewal',
    description: null,
    status: 'open',
    pipelineStage: 'Qualification',
    pipelineId: PIPELINE_ID,
    pipelineStageId: STAGE_A_ID,
    valueAmount: '12000',
    valueCurrency: 'USD',
    probability: 65,
    expectedCloseAt: null,
    ownerUserId: null,
    source: null,
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
    createdAt: new Date('2026-04-10T08:00:00.000Z'),
    updatedAt: new Date('2026-04-10T08:00:00.000Z'),
    deletedAt: null,
    people: [] as any,
    companies: [] as any,
    activities: [] as any,
    comments: [] as any,
    stageTransitions: [] as any,
    ...overrides,
  } as CustomerDeal
}

function buildStage(id: string, label: string, order: number, defaultProbability: number | null): CustomerPipelineStage {
  return {
    id,
    pipelineId: PIPELINE_ID,
    label,
    order,
    defaultProbability,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CustomerPipelineStage
}

type Fixture = {
  deal?: CustomerDeal | null
  stageProbabilitiesEnabled: boolean
  stages?: CustomerPipelineStage[]
}

function setup(fixture: Fixture) {
  const stages = fixture.stages ?? [
    buildStage(STAGE_A_ID, 'Qualification', 0, 20),
    buildStage(STAGE_B_ID, 'Negotiation', 1, 60),
    buildStage(STAGE_C_ID, 'Review', 2, null),
  ]
  const pipeline = {
    id: PIPELINE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Sales',
    isDefault: true,
    stageProbabilitiesEnabled: fixture.stageProbabilitiesEnabled,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CustomerPipeline
  const createdEntities: Array<Record<string, unknown>> = []

  const em: any = {
    getKysely: () => createKyselyStub(),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerDeal && fixture.deal && where.id === fixture.deal.id) return fixture.deal
      if (ctor === CustomerPipelineStage) return stages.find((stage) => stage.id === where.id) ?? null
      if (ctor === CustomerPipeline && where.id === pipeline.id) return pipeline
      return null
    }),
    find: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => {}),
    create: jest.fn((ctor: unknown, payload: Record<string, unknown>) => {
      const entity = { __entity: ctor, id: ctor === CustomerDeal ? DEAL_ID : undefined, ...payload }
      createdEntities.push(entity)
      return entity
    }),
    upsert: jest.fn(async (ctor: unknown, payload: Record<string, unknown>) => ({ __entity: ctor, ...payload })),
    persist: jest.fn(() => {}),
    flush: jest.fn(async () => {}),
    transactional: jest.fn(async (fn: (inner: unknown) => Promise<unknown>) => fn(em)),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn(),
    remove: jest.fn(),
    getUnitOfWork: () => ({ computeChangeSets: () => {}, getChangeSets: () => [] }),
  }
  em.fork = () => em

  const queue: any[] = []
  const dataEngine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn((entry: any) => { if (entry?.entity) queue.push(entry) }),
    flushOrmEntityChanges: jest.fn(async () => { queue.length = 0 }),
  }

  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return undefined
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as any,
    auth: { sub: '550e8400-e29b-41d4-a716-446655440099', tenantId: TENANT_ID, orgId: ORG_ID } as any,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }

  return { em, ctx, createdEntities }
}

function getHandler(id: string): CommandHandler {
  const handler = commandRegistry.get(id) as CommandHandler
  expect(handler).toBeDefined()
  return handler
}

describe('customers.deals.update — stage default probability', () => {
  afterEach(() => jest.clearAllMocks())

  it('applies the target stage default when the deal changes stage without an explicit probability', async () => {
    const deal = buildDeal()
    const { ctx } = setup({ deal, stageProbabilitiesEnabled: true })
    await getHandler('customers.deals.update').execute!({ id: DEAL_ID, pipelineStageId: STAGE_B_ID }, ctx)
    expect(deal.pipelineStageId).toBe(STAGE_B_ID)
    expect(deal.probability).toBe(60)
  })

  it('applies the default when moving backwards to an earlier stage', async () => {
    const deal = buildDeal({ pipelineStageId: STAGE_B_ID, pipelineStage: 'Negotiation', probability: 60 })
    const { ctx } = setup({ deal, stageProbabilitiesEnabled: true })
    await getHandler('customers.deals.update').execute!({ id: DEAL_ID, pipelineStageId: STAGE_A_ID }, ctx)
    expect(deal.probability).toBe(20)
  })

  it('keeps an explicit probability sent together with the stage change', async () => {
    const deal = buildDeal()
    const { ctx } = setup({ deal, stageProbabilitiesEnabled: true })
    await getHandler('customers.deals.update').execute!(
      { id: DEAL_ID, pipelineStageId: STAGE_B_ID, probability: 33 },
      ctx,
    )
    expect(deal.probability).toBe(33)
  })

  it('does not touch probability when the pipeline has stage defaults disabled', async () => {
    const deal = buildDeal()
    const { ctx } = setup({ deal, stageProbabilitiesEnabled: false })
    await getHandler('customers.deals.update').execute!({ id: DEAL_ID, pipelineStageId: STAGE_B_ID }, ctx)
    expect(deal.pipelineStageId).toBe(STAGE_B_ID)
    expect(deal.probability).toBe(65)
  })

  it('does not touch probability when the target stage has no default', async () => {
    const deal = buildDeal()
    const { ctx } = setup({ deal, stageProbabilitiesEnabled: true })
    await getHandler('customers.deals.update').execute!({ id: DEAL_ID, pipelineStageId: STAGE_C_ID }, ctx)
    expect(deal.pipelineStageId).toBe(STAGE_C_ID)
    expect(deal.probability).toBe(65)
  })

  it('keeps a manual override when the deal is saved without a stage change', async () => {
    const deal = buildDeal({ probability: 42 })
    const { ctx, em } = setup({ deal, stageProbabilitiesEnabled: true })
    await getHandler('customers.deals.update').execute!(
      { id: DEAL_ID, title: 'Renamed', pipelineStageId: STAGE_A_ID },
      ctx,
    )
    expect(deal.title).toBe('Renamed')
    expect(deal.probability).toBe(42)
    expect(em.findOne).not.toHaveBeenCalledWith(CustomerPipeline, expect.anything(), expect.anything())
  })

  it('applies the terminal stage default when a deal is closed as won', async () => {
    const deal = buildDeal()
    const stages = [
      buildStage(STAGE_A_ID, 'Qualification', 0, 20),
      buildStage(STAGE_B_ID, 'Won', 1, 100),
    ]
    const { ctx, em } = setup({ deal, stageProbabilitiesEnabled: true, stages })
    em.find.mockImplementation(async (ctor: unknown) => (ctor === CustomerPipelineStage ? stages : []))
    await getHandler('customers.deals.update').execute!({ id: DEAL_ID, status: 'win' }, ctx)
    expect(deal.pipelineStageId).toBe(STAGE_B_ID)
    expect(deal.probability).toBe(100)
  })
})

describe('customers.deals.create — stage default probability', () => {
  afterEach(() => jest.clearAllMocks())

  const baseInput = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    title: 'New deal',
    pipelineId: PIPELINE_ID,
    pipelineStageId: STAGE_B_ID,
  }

  function createdDeal(createdEntities: Array<Record<string, unknown>>) {
    return createdEntities.find((entity) => entity.__entity === CustomerDeal)
  }

  it('seeds the initial stage default when no probability is provided', async () => {
    const { ctx, createdEntities } = setup({ stageProbabilitiesEnabled: true })
    await getHandler('customers.deals.create').execute!(baseInput, ctx)
    expect(createdDeal(createdEntities)?.probability).toBe(60)
  })

  it('keeps an explicit probability on create', async () => {
    const { ctx, createdEntities } = setup({ stageProbabilitiesEnabled: true })
    await getHandler('customers.deals.create').execute!({ ...baseInput, probability: 5 }, ctx)
    expect(createdDeal(createdEntities)?.probability).toBe(5)
  })

  it('leaves probability empty when the pipeline has stage defaults disabled', async () => {
    const { ctx, createdEntities } = setup({ stageProbabilitiesEnabled: false })
    await getHandler('customers.deals.create').execute!(baseInput, ctx)
    expect(createdDeal(createdEntities)?.probability).toBeNull()
  })
})
