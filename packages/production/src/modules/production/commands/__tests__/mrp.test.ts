export {}

// Mocked em/container harness for MRP commands, modeled on
// `commands/__tests__/orders.test.ts`. No DB in this test.

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

const emitProductionEventMock = jest.fn()

jest.mock('../../events.js', () => ({
  emitProductionEvent: (...args: unknown[]) => emitProductionEventMock(...args),
}))

const emitCrudSideEffectsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: (...args: unknown[]) => emitCrudSideEffectsMock(...args),
}))

const queueEnqueueMock = jest.fn().mockResolvedValue('queue-job-1')

jest.mock('../../lib/mrp/queue.js', () => ({
  getMrpRunQueue: () => ({ enqueue: queueEnqueueMock }),
}))

const isProductionEnabledForTenantMock = jest.fn().mockResolvedValue(true)

jest.mock('../../lib/productionToggle.js', () => ({
  isProductionEnabledForTenant: (...args: unknown[]) => isProductionEnabledForTenantMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type EntityCtor = { name: string }

function makeMockEm() {
  const store = new Map<string, Record<string, unknown>>()
  let idCounter = 0

  function rowKey(entityName: string, id: string) {
    return `${entityName}:${id}`
  }

  function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
        const list = (value as { $in: unknown[] }).$in
        return list.includes(row[key])
      }
      if (value === null) return row[key] === null || row[key] === undefined
      return row[key] === value
    })
  }

  function rowsFor(EntityClass: EntityCtor): Array<Record<string, unknown>> {
    const prefix = `${EntityClass.name}:`
    const out: Array<Record<string, unknown>> = []
    for (const [key, row] of store) {
      if (key.startsWith(prefix)) out.push(row)
    }
    return out
  }

  const em = {
    fork: jest.fn(() => em),
    flush: jest.fn(async () => undefined),
    create: jest.fn((EntityClass: EntityCtor, data: Record<string, unknown>) => {
      const id = (data.id as string | undefined) ?? `${EntityClass.name.toLowerCase()}-${++idCounter}`
      const row = { ...data, id }
      store.set(rowKey(EntityClass.name, id), { __entity: EntityClass.name, ...row })
      return row
    }),
    persist: jest.fn(() => em),
    findOne: jest.fn(async (EntityClass: EntityCtor, filter: Record<string, unknown>) => {
      return rowsFor(EntityClass).find((row) => matches(row, filter)) ?? null
    }),
    find: jest.fn(async (EntityClass: EntityCtor, filter: Record<string, unknown> = {}) => {
      return rowsFor(EntityClass).filter((row) => matches(row, filter))
    }),
    getConnection: jest.fn(() => ({ execute: jest.fn(async () => []) })),
  }

  function seed(EntityClass: EntityCtor, row: Record<string, unknown>) {
    store.set(rowKey(EntityClass.name, row.id as string), { __entity: EntityClass.name, ...row })
    return row
  }

  return { em, seed, store }
}

function makeCtx(em: unknown, commandBusExecute: jest.Mock, overrides: Record<string, unknown> = {}) {
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const resolve = jest.fn((key: string) => {
    if (key === 'dataEngine') return dataEngine
    if (key === 'commandBus') return { execute: commandBusExecute }
    return em
  })
  return {
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isSuperAdmin: false },
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: ['org-1'],
    container: { resolve },
    request: null,
    __dataEngine: dataEngine,
    ...overrides,
  } as any
}

function loadCommands(): Record<string, any> {
  const byFullId: Record<string, any> = {}
  jest.isolateModules(() => {
    require('../mrp')
    for (const [cmd] of registerCommand.mock.calls) {
      byFullId[cmd.id] = cmd
    }
  })
  const commands: Record<string, any> = {}
  for (const [fullId, cmd] of Object.entries(byFullId)) {
    const suffix = fullId.replace('production.mrp.', '')
    commands[suffix] = cmd
  }
  return commands
}

describe('production.mrp commands', () => {
  beforeEach(() => {
    registerCommand.mockClear()
    emitProductionEventMock.mockClear()
    emitCrudSideEffectsMock.mockClear()
    queueEnqueueMock.mockClear()
    isProductionEnabledForTenantMock.mockClear()
    isProductionEnabledForTenantMock.mockResolvedValue(true)
  })

  describe('createRun', () => {
    it('creates a pending MrpRun row and enqueues exactly one per-tenant queue job', async () => {
      const { em } = makeMockEm()
      const commands = loadCommands()
      const ctx = makeCtx(em, jest.fn())

      const result = await commands.createRun.execute({ asOfDate: '2026-01-01' }, ctx)

      expect(result.id).toBeDefined()
      expect(queueEnqueueMock).toHaveBeenCalledTimes(1)
      expect(queueEnqueueMock).toHaveBeenCalledWith(
        expect.objectContaining({ mrpRunId: result.id, tenantId: 'tenant-1', organizationId: 'org-1' }),
      )
    })
  })

  describe('cronFanOut', () => {
    it('enqueues one run per scope with planning params when production is enabled for that tenant', async () => {
      const { em } = makeMockEm()
      em.getConnection = jest.fn(() => ({
        execute: jest.fn(async () => [{ tenant_id: 'tenant-enabled', organization_id: 'org-1' }]),
      }))
      const commands = loadCommands()
      const ctx = makeCtx(em, jest.fn())

      const result = await commands.cronFanOut.execute({}, ctx)

      expect(isProductionEnabledForTenantMock).toHaveBeenCalledWith('tenant-enabled')
      expect(queueEnqueueMock).toHaveBeenCalledTimes(1)
      expect(result.runsCreated).toBe(1)
    })

    it('REGRESSION: skips a toggled-off tenant that still has planning-params rows (toggle off => no observable change, incl. cron)', async () => {
      const { em } = makeMockEm()
      em.getConnection = jest.fn(() => ({
        execute: jest.fn(async () => [{ tenant_id: 'tenant-disabled', organization_id: 'org-1' }]),
      }))
      isProductionEnabledForTenantMock.mockResolvedValue(false)
      const commands = loadCommands()
      const ctx = makeCtx(em, jest.fn())

      const result = await commands.cronFanOut.execute({}, ctx)

      expect(isProductionEnabledForTenantMock).toHaveBeenCalledWith('tenant-disabled')
      expect(queueEnqueueMock).not.toHaveBeenCalled()
      expect(result.runsCreated).toBe(0)
    })
  })

  describe('acceptSuggestions', () => {
    it('accepting a MAKE suggestion creates a draft production order via commandBus and marks the suggestion accepted', async () => {
      const { em, seed, store } = makeMockEm()
      const commands = loadCommands()
      const { MrpSuggestion } = require('../../data/entities.js')
      seed(MrpSuggestion, {
        id: 'sugg-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        runId: 'run-1',
        suggestionType: 'make',
        productId: 'prod-1',
        variantId: null,
        qty: '10',
        uom: 'pcs',
        dueDate: new Date('2026-02-01'),
        status: 'open',
        deletedAt: null,
      })

      const commandBusExecute = jest.fn().mockResolvedValue({ result: { id: 'order-1' } })
      const ctx = makeCtx(em, commandBusExecute)

      const result = await commands.acceptSuggestions.execute({ ids: ['sugg-1'] }, ctx)

      expect(commandBusExecute).toHaveBeenCalledWith(
        'production.orders.create',
        expect.objectContaining({
          input: expect.objectContaining({ productId: 'prod-1', sourceType: 'mrp', sourceId: 'sugg-1' }),
        }),
      )
      expect(result.createdOrderIds).toEqual(['order-1'])
      expect(result.acceptedIds).toEqual(['sugg-1'])
      expect(store.get('MrpSuggestion:sugg-1')!.status).toBe('accepted')
    })

    it('accepting a BUY suggestion does not call commandBus but emits production.mrp_suggestion.accepted (purchasing seam)', async () => {
      const { em, seed } = makeMockEm()
      const commands = loadCommands()
      const { MrpSuggestion } = require('../../data/entities.js')
      seed(MrpSuggestion, {
        id: 'sugg-2',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        runId: 'run-1',
        suggestionType: 'buy',
        productId: 'prod-2',
        variantId: null,
        qty: '20',
        uom: 'pcs',
        dueDate: new Date('2026-02-01'),
        status: 'open',
        deletedAt: null,
      })

      const commandBusExecute = jest.fn()
      const ctx = makeCtx(em, commandBusExecute)

      const result = await commands.acceptSuggestions.execute({ ids: ['sugg-2'] }, ctx)

      expect(commandBusExecute).not.toHaveBeenCalled()
      expect(result.createdOrderIds).toEqual([])
      expect(result.acceptedIds).toEqual(['sugg-2'])
      expect(emitProductionEventMock).toHaveBeenCalledWith(
        'production.mrp_suggestion.accepted',
        expect.objectContaining({ id: 'sugg-2', suggestionType: 'buy', productId: 'prod-2' }),
        expect.anything(),
      )
    })

    it('bulk mixed accept: skips a non-open suggestion and an unknown id, only actioning the open one', async () => {
      const { em, seed, store } = makeMockEm()
      const commands = loadCommands()
      const { MrpSuggestion } = require('../../data/entities.js')
      seed(MrpSuggestion, {
        id: 'sugg-open',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        runId: 'run-1',
        suggestionType: 'buy',
        productId: 'prod-3',
        variantId: null,
        qty: '1',
        uom: 'pcs',
        dueDate: new Date('2026-02-01'),
        status: 'open',
        deletedAt: null,
      })
      seed(MrpSuggestion, {
        id: 'sugg-already-dismissed',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        runId: 'run-1',
        suggestionType: 'buy',
        productId: 'prod-4',
        variantId: null,
        qty: '1',
        uom: 'pcs',
        dueDate: new Date('2026-02-01'),
        status: 'dismissed',
        deletedAt: null,
      })

      const ctx = makeCtx(em, jest.fn())
      const result = await commands.acceptSuggestions.execute(
        { ids: ['sugg-open', 'sugg-already-dismissed', 'sugg-does-not-exist'] },
        ctx,
      )

      expect(result.acceptedIds).toEqual(['sugg-open'])
      expect(result.skippedIds).toEqual(expect.arrayContaining(['sugg-already-dismissed', 'sugg-does-not-exist']))
      expect(store.get('MrpSuggestion:sugg-already-dismissed')!.status).toBe('dismissed')
    })
  })

  describe('dismissSuggestions', () => {
    it('marks an open suggestion dismissed', async () => {
      const { em, seed, store } = makeMockEm()
      const commands = loadCommands()
      const { MrpSuggestion } = require('../../data/entities.js')
      seed(MrpSuggestion, {
        id: 'sugg-dismiss-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        runId: 'run-1',
        suggestionType: 'make',
        productId: 'prod-5',
        variantId: null,
        qty: '1',
        uom: 'pcs',
        dueDate: new Date('2026-02-01'),
        status: 'open',
        deletedAt: null,
      })

      const ctx = makeCtx(em, jest.fn())
      const result = await commands.dismissSuggestions.execute({ ids: ['sugg-dismiss-1'] }, ctx)

      expect(result.dismissedIds).toEqual(['sugg-dismiss-1'])
      expect(store.get('MrpSuggestion:sugg-dismiss-1')!.status).toBe('dismissed')
    })
  })
})
