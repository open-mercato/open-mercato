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
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  CustomerDeal,
  CustomerDealStageTransition,
  CustomerDictionaryEntry,
  CustomerPipelineStage,
} from '../../data/entities'

function createKyselyStub() {
  const chain: any = {}
  chain.select = jest.fn(() => chain)
  chain.selectAll = jest.fn(() => chain)
  chain.where = jest.fn(() => chain)
  chain.orderBy = jest.fn(() => chain)
  chain.limit = jest.fn(() => chain)
  chain.offset = jest.fn(() => chain)
  chain.values = jest.fn(() => chain)
  chain.set = jest.fn(() => chain)
  chain.onConflict = jest.fn(() => chain)
  chain.returning = jest.fn(() => chain)
  chain.executeTakeFirst = jest.fn(async () => undefined)
  chain.execute = jest.fn(async () => [])
  return {
    selectFrom: jest.fn(() => chain),
    insertInto: jest.fn(() => chain),
    updateTable: jest.fn(() => chain),
    deleteFrom: jest.fn(() => chain),
  }
}

function createMockContext(deps: {
  em: Record<string, unknown>
  dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'>
}): CommandRuntimeContext {
  const em = deps.em as Record<string, unknown> & { getKysely?: () => unknown }
  if (typeof em.getKysely !== 'function') {
    const db = createKyselyStub()
    em.getKysely = () => db
  }
  if (typeof em.find !== 'function') {
    em.find = jest.fn(async () => [])
  }

  const engine = deps.dataEngine as unknown as Record<string, any>
  if (typeof engine.markOrmEntityChange !== 'function' || typeof engine.flushOrmEntityChanges !== 'function') {
    const queue: any[] = []
    engine.markOrmEntityChange = jest.fn((entry: any) => {
      if (!entry || !entry.entity) return
      queue.push(entry)
    })
    engine.flushOrmEntityChanges = jest.fn(async () => {
      while (queue.length > 0) {
        const next = queue.shift()
        await engine.emitOrmEntityEvent(next)
      }
    })
  }

  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'em':
          return em
        case 'dataEngine':
          return engine
        default:
          throw new Error(`Unexpected dependency: ${token}`)
      }
    },
  }

  return {
    container: container as any,
    auth: {
      sub: '550e8400-e29b-41d4-a716-446655440099',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    } as any,
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

describe('customers.deals.update stage transitions', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('prepares successfully when the stage transition table is missing', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()

    const existingDeal: CustomerDeal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      title: 'Expansion renewal',
      description: null,
      status: 'open',
      pipelineStage: 'Discovery',
      pipelineId: '550e8400-e29b-41d4-a716-446655440010',
      pipelineStageId: '550e8400-e29b-41d4-a716-446655440011',
      valueAmount: '12000',
      valueCurrency: 'USD',
      probability: 65,
      expectedCloseAt: null,
      ownerUserId: null,
      source: 'Referral',
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
    }

    const em: any = {
      getKysely: jest.fn(() => createKyselyStub()),
      findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === CustomerDeal && where.id === existingDeal.id) return existingDeal
        return null
      }),
      find: jest.fn(async (ctor: unknown) => {
        if (ctor === CustomerDealStageTransition) {
          const error = new Error('relation "customer_deal_stage_transitions" does not exist') as Error & { code?: string }
          error.code = '42P01'
          throw error
        }
        return []
      }),
    }
    em.fork = jest.fn(() => em)

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const prepared = await handler.prepare!(
      { id: '550e8400-e29b-41d4-a716-446655440000' },
      ctx,
    )

    expect(prepared).toEqual({
      before: expect.objectContaining({
        deal: expect.objectContaining({ id: existingDeal.id }),
        transitions: [],
      }),
    })

    warnSpy.mockRestore()
  })

  it('persists a stage transition when the pipeline stage changes', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()

    const existingDeal: CustomerDeal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      title: 'Expansion renewal',
      description: null,
      status: 'open',
      pipelineStage: 'Discovery',
      pipelineId: '550e8400-e29b-41d4-a716-446655440010',
      pipelineStageId: '550e8400-e29b-41d4-a716-446655440011',
      valueAmount: '12000',
      valueCurrency: 'USD',
      probability: 65,
      expectedCloseAt: null,
      ownerUserId: null,
      source: 'Referral',
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
    }

    const stageTwo: CustomerPipelineStage = {
      id: '550e8400-e29b-41d4-a716-446655440012',
      pipelineId: '550e8400-e29b-41d4-a716-446655440010',
      label: 'Proposal',
      order: 2,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      isDefault: false,
      winProbability: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CustomerPipelineStage

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === CustomerDeal && where.id === existingDeal.id) return existingDeal
        if (ctor === CustomerPipelineStage && where.id === stageTwo.id) return stageTwo
        if (ctor === CustomerDealStageTransition) return null
        if (ctor === CustomerDictionaryEntry) return null
        return null
      }),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      create: jest.fn((ctor: unknown, payload: Record<string, unknown>) => ({ __entity: ctor, ...payload })),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      transactional: jest.fn(async (fn: (inner: typeof em) => Promise<unknown>) => fn(em)),
      begin: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      getReference: jest.fn(),
      remove: jest.fn(),
    }

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })

    const result = await handler.execute!(
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        pipelineStageId: '550e8400-e29b-41d4-a716-446655440012',
      },
      ctx,
    )

    expect(result).toEqual({ dealId: '550e8400-e29b-41d4-a716-446655440000' })
    expect(existingDeal.pipelineStageId).toBe('550e8400-e29b-41d4-a716-446655440012')
    expect(existingDeal.pipelineStage).toBe('Proposal')
    expect(em.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        stageId: '550e8400-e29b-41d4-a716-446655440012',
        stageLabel: 'Proposal',
        stageOrder: 2,
        transitionedByUserId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    )
  })

  it('skips transition persistence when the stage transition table is missing', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()

    const existingDeal: CustomerDeal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      title: 'Expansion renewal',
      description: null,
      status: 'open',
      pipelineStage: 'Discovery',
      pipelineId: '550e8400-e29b-41d4-a716-446655440010',
      pipelineStageId: '550e8400-e29b-41d4-a716-446655440011',
      valueAmount: '12000',
      valueCurrency: 'USD',
      probability: 65,
      expectedCloseAt: null,
      ownerUserId: null,
      source: 'Referral',
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
    }

    const stageTwo: CustomerPipelineStage = {
      id: '550e8400-e29b-41d4-a716-446655440012',
      pipelineId: '550e8400-e29b-41d4-a716-446655440010',
      label: 'Proposal',
      order: 2,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      isDefault: false,
      winProbability: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CustomerPipelineStage

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === CustomerDeal && where.id === existingDeal.id) return existingDeal
        if (ctor === CustomerPipelineStage && where.id === stageTwo.id) return stageTwo
        if (ctor === CustomerDealStageTransition) {
          const error = new Error('relation "customer_deal_stage_transitions" does not exist') as Error & { code?: string }
          error.code = '42P01'
          throw error
        }
        if (ctor === CustomerDictionaryEntry) return null
        return null
      }),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      create: jest.fn((ctor: unknown, payload: Record<string, unknown>) => ({ __entity: ctor, ...payload })),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      transactional: jest.fn(async (fn: (inner: typeof em) => Promise<unknown>) => fn(em)),
      begin: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      getReference: jest.fn(),
      remove: jest.fn(),
    }

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await handler.execute!(
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        pipelineStageId: '550e8400-e29b-41d4-a716-446655440012',
      },
      ctx,
    )

    expect(result).toEqual({ dealId: '550e8400-e29b-41d4-a716-446655440000' })
    expect(existingDeal.pipelineStageId).toBe('550e8400-e29b-41d4-a716-446655440012')
    expect(existingDeal.pipelineStage).toBe('Proposal')
    expect(em.persist).not.toHaveBeenCalledWith(
      expect.objectContaining({
        __entity: CustomerDealStageTransition,
      }),
    )

    warnSpy.mockRestore()
  })
})
