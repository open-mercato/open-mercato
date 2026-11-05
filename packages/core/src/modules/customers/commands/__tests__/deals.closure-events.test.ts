jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: EmLike, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: EmLike, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CustomerDeal } from '../../data/entities'

type EmLike = {
  find: (...args: unknown[]) => Promise<unknown>
  findOne: (...args: unknown[]) => Promise<unknown>
}

type EmitCall = {
  event: string
  payload: Record<string, unknown>
  options?: Record<string, unknown>
}

const DEAL_ID = '550e8400-e29b-41d4-a716-446655440000'
const AUTHOR_USER_ID = '550e8400-e29b-41d4-a716-446655440099'

function createKyselyStub() {
  const chain: Record<string, unknown> = {}
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

function createDeal(status: string): CustomerDeal {
  return {
    id: DEAL_ID,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    title: 'Expansion renewal',
    description: null,
    status,
    pipelineStage: 'Discovery',
    pipelineId: '550e8400-e29b-41d4-a716-446655440010',
    pipelineStageId: '550e8400-e29b-41d4-a716-446655440011',
    valueAmount: '12000',
    valueCurrency: 'USD',
    probability: 65,
    expectedCloseAt: null,
    ownerUserId: '550e8400-e29b-41d4-a716-446655440077',
    source: 'Referral',
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
    createdAt: new Date('2026-04-10T08:00:00.000Z'),
    updatedAt: new Date('2026-04-10T08:00:00.000Z'),
    deletedAt: null,
    people: [],
    companies: [],
    activities: [],
    comments: [],
    stageTransitions: [],
  } as unknown as CustomerDeal
}

function createHarness(deal: CustomerDeal): { ctx: CommandRuntimeContext; emitCalls: EmitCall[] } {
  const emitCalls: EmitCall[] = []

  const em: Record<string, unknown> = {
    getKysely: jest.fn(() => createKyselyStub()),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerDeal && where.id === deal.id) return deal
      return null
    }),
    find: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => {}),
    create: jest.fn((ctor: unknown, payload: Record<string, unknown>) => ({ __entity: ctor, ...payload })),
    persist: jest.fn(() => {}),
    flush: jest.fn(async () => {}),
    transactional: jest.fn(async (fn: (inner: unknown) => Promise<unknown>) => fn(em)),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    getReference: jest.fn(),
    remove: jest.fn(),
  }
  em.fork = jest.fn(() => em)

  const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> & Record<string, unknown> = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
  }
  const pendingOrmChanges: unknown[] = []
  dataEngine.markOrmEntityChange = jest.fn((entry: { entity?: unknown }) => {
    if (!entry || !entry.entity) return
    pendingOrmChanges.push(entry)
  })
  dataEngine.flushOrmEntityChanges = jest.fn(async () => {
    while (pendingOrmChanges.length > 0) {
      await dataEngine.emitOrmEntityEvent(pendingOrmChanges.shift() as never)
    }
  })

  const eventBus = {
    emitEvent: jest.fn(async (event: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
      emitCalls.push({ event, payload, options })
    }),
  }

  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'em':
          return em
        case 'dataEngine':
          return dataEngine
        case 'eventBus':
          return eventBus
        default:
          throw new Error(`Unexpected dependency: ${token}`)
      }
    },
  }

  const ctx = {
    container,
    auth: {
      sub: AUTHOR_USER_ID,
      tenantId: 'tenant-1',
      orgId: 'org-1',
    },
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: null,
    request: undefined,
  } as unknown as CommandRuntimeContext

  return { ctx, emitCalls }
}

function findClosureEmit(emitCalls: EmitCall[], event: string): EmitCall | undefined {
  return emitCalls.find((call) => call.event === event)
}

describe('customers.deals.update closure event scope', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('passes trusted tenant and organization scope in the emit options for a won deal', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()

    const deal = createDeal('open')
    const { ctx, emitCalls } = createHarness(deal)

    await handler.execute!({ id: DEAL_ID, status: 'win' }, ctx)

    const emitted = findClosureEmit(emitCalls, 'customers.deal.won')
    expect(emitted).toBeDefined()
    expect(emitted!.options).toMatchObject({
      persistent: true,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(emitted!.payload).toMatchObject({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('passes trusted tenant and organization scope in the emit options for a lost deal', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()

    const deal = createDeal('open')
    const { ctx, emitCalls } = createHarness(deal)

    await handler.execute!({ id: DEAL_ID, status: 'loose' }, ctx)

    const emitted = findClosureEmit(emitCalls, 'customers.deal.lost')
    expect(emitted).toBeDefined()
    expect(emitted!.options).toMatchObject({
      persistent: true,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(emitted!.payload).toMatchObject({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('passes trusted scope when a deal moves straight from won to lost', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()

    const deal = createDeal('win')
    const { ctx, emitCalls } = createHarness(deal)

    await handler.execute!({ id: DEAL_ID, status: 'loose' }, ctx)

    expect(findClosureEmit(emitCalls, 'customers.deal.won')).toBeUndefined()
    const emitted = findClosureEmit(emitCalls, 'customers.deal.lost')
    expect(emitted).toBeDefined()
    expect(emitted!.options).toMatchObject({
      persistent: true,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('does not emit a closure event when the status is unchanged', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()

    const deal = createDeal('win')
    const { ctx, emitCalls } = createHarness(deal)

    await handler.execute!({ id: DEAL_ID, status: 'win' }, ctx)

    expect(findClosureEmit(emitCalls, 'customers.deal.won')).toBeUndefined()
    expect(findClosureEmit(emitCalls, 'customers.deal.lost')).toBeUndefined()
  })
})
