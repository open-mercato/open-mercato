export {}

import { E } from '../../../../../generated/entities.ids.generated'

// Mocked em/container harness for production order commands, modeled on
// `commands/__tests__/technology.test.ts`. `withAtomicFlush` and the shared
// scope/optimistic-lock guards run for real; only the command registry and
// i18n resolver are mocked (no DB in this test).

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

const emitProductionEventMock = jest.fn()

jest.mock('../../events.js', () => ({
  emitProductionEvent: (...args: unknown[]) => emitProductionEventMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      if (!fallback) return _key
      if (!vars) return fallback
      return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), fallback)
    },
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
    isInTransaction: jest.fn(() => false),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    create: jest.fn((EntityClass: EntityCtor, data: Record<string, unknown>) => {
      const id = (data.id as string | undefined) ?? `${EntityClass.name.toLowerCase()}-${++idCounter}`
      const now = new Date()
      // Real MikroORM entities stamp `createdAt`/`updatedAt` via
      // `@Property({ onCreate/onUpdate: () => new Date() })` field
      // defaults when constructed through the class. This lightweight mock
      // never runs the real constructor, so stamp the same defaults here —
      // needed for the aggregate-optimistic-lock test, which compares the
      // client-sent expected token against the freshly-created row's
      // `updatedAt`.
      const row = { updatedAt: now, createdAt: now, ...data, id }
      store.set(rowKey(EntityClass.name, id), { __entity: EntityClass.name, ...row })
      return row
    }),
    persist: jest.fn(() => em),
    remove: jest.fn((row: Record<string, unknown>) => {
      const entityName = row.__entity as string | undefined
      if (entityName && row.id) store.delete(rowKey(entityName, row.id as string))
      return em
    }),
    findOne: jest.fn(async (EntityClass: EntityCtor, filter: Record<string, unknown>) => {
      return rowsFor(EntityClass).find((row) => matches(row, filter)) ?? null
    }),
    find: jest.fn(async (EntityClass: EntityCtor, filter: Record<string, unknown> = {}) => {
      return rowsFor(EntityClass).filter((row) => matches(row, filter))
    }),
  }

  function seed(EntityClass: EntityCtor, row: Record<string, unknown>) {
    store.set(rowKey(EntityClass.name, row.id as string), { __entity: EntityClass.name, ...row })
    return row
  }

  return { em, seed, store }
}

function makeDataEngine() {
  return { markOrmEntityChange: jest.fn() }
}

function makeStockProvider() {
  return {
    getOnHand: jest.fn(async () => 0),
    reserve: jest.fn(async () => ({ reservationIds: [] })),
    releaseReservations: jest.fn(async () => ({ releasedIds: [] })),
    issue: jest.fn(async () => ({ movementIds: [] })),
    receive: jest.fn(async () => ({ movementIds: [] })),
    adjust: jest.fn(async () => ({ movementId: 'mv-1' })),
    findBatches: jest.fn(async () => []),
  }
}

function makeCtx(em: unknown, overrides: Record<string, unknown> = {}) {
  const dataEngine = makeDataEngine()
  const stockProvider = makeStockProvider()
  const resolve = jest.fn((key: string) => {
    if (key === 'dataEngine') return dataEngine
    if (key === 'productionStockProvider') return stockProvider
    if (key === 'commandOptimisticLockGuardService') throw new Error('not registered')
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
    __stockProvider: stockProvider,
    ...overrides,
  } as any
}

/**
 * Loads `../orders` fresh and returns its registered commands keyed by the
 * short suffix after `production.orders.` (e.g. `create`, `plan`, `release`)
 * so call sites can write `cmds.release.execute(...)` instead of the full
 * `cmds['production.orders.release']`.
 */
function loadCommands(): Record<string, any> {
  const byFullId: Record<string, any> = {}
  jest.isolateModules(() => {
    require('../orders')
    for (const [cmd] of registerCommand.mock.calls) {
      byFullId[cmd.id] = cmd
    }
  })
  const commands: Record<string, any> = {}
  for (const [fullId, cmd] of Object.entries(byFullId)) {
    const suffix = fullId.replace('production.orders.', '')
    commands[suffix] = cmd
  }
  return commands
}

/**
 * Same as {@link loadCommands}, but also returns the `@mikro-orm/core`
 * module instance loaded inside the SAME `jest.isolateModules` sandbox as
 * `../orders`. `jest.resetModules()` (run in `beforeEach`) means a plain
 * top-of-file `import { UniqueConstraintViolationException } from
 * '@mikro-orm/core'` is a DIFFERENT class instance than the one `../orders`
 * sees once re-required inside `isolateModules` — an `instanceof` check
 * against the two would silently fail. Constructing the thrown error from
 * this isolated module keeps class identity aligned with what `orders.ts`'s
 * `err instanceof UniqueConstraintViolationException` check actually sees
 * (same fix `catalog/commands/__tests__/variants.sku.test.ts` documents for
 * this exact isolateModules/instanceof interaction).
 */
function loadCommandsWithMikroOrmCore(): { commands: Record<string, any>; mikroOrmCore: typeof import('@mikro-orm/core') } {
  const byFullId: Record<string, any> = {}
  let mikroOrmCore!: typeof import('@mikro-orm/core')
  jest.isolateModules(() => {
    require('../orders')
    mikroOrmCore = require('@mikro-orm/core')
    for (const [cmd] of registerCommand.mock.calls) {
      byFullId[cmd.id] = cmd
    }
  })
  const commands: Record<string, any> = {}
  for (const [fullId, cmd] of Object.entries(byFullId)) {
    commands[fullId.replace('production.orders.', '')] = cmd
  }
  return { commands, mikroOrmCore }
}

/**
 * Same isolateModules/instanceof concern as {@link loadCommandsWithMikroOrmCore},
 * but for `../lib/stockProvider`'s domain errors: a mocked
 * `stockProvider.reserve` must reject with the SAME `InsufficientStockError`
 * class `orders.ts`'s `err instanceof InsufficientStockError` check sees
 * inside the isolated registry, not the top-of-file import's instance.
 */
function loadCommandsWithStockProviderErrors(): {
  commands: Record<string, any>
  stockProviderErrors: typeof import('../../lib/stockProvider')
} {
  const byFullId: Record<string, any> = {}
  let stockProviderErrors!: typeof import('../../lib/stockProvider')
  jest.isolateModules(() => {
    require('../orders')
    stockProviderErrors = require('../../lib/stockProvider')
    for (const [cmd] of registerCommand.mock.calls) {
      byFullId[cmd.id] = cmd
    }
  })
  const commands: Record<string, any> = {}
  for (const [fullId, cmd] of Object.entries(byFullId)) {
    commands[fullId.replace('production.orders.', '')] = cmd
  }
  return { commands, stockProviderErrors }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function optimisticLockHeaderRequest(expectedIso: string): Request {
  return new Request('http://localhost/test', {
    headers: { 'x-om-ext-optimistic-lock-expected-updated-at': expectedIso },
  })
}

describe('production.orders commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('create persists a draft order and emits created side effects', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const { create } = loadCommands()

    const result = await create.execute(
      {
        productId: 'product-1',
        variantId: null,
        qtyPlanned: 10,
        uom: 'pcs',
        dueDate: null,
        priority: 0,
        sourceType: 'manual',
        sourceId: null,
      },
      ctx,
    )

    expect(result.id).toBeTruthy()
    expect(ctx.__dataEngine.markOrmEntityChange).toHaveBeenCalled()
    const [callArgs] = ctx.__dataEngine.markOrmEntityChange.mock.calls
    expect(callArgs[0]).toMatchObject({
      action: 'created',
      indexer: { entityType: E.production.production_order },
    })

    const order = (await em.findOne({ name: 'ProductionOrder' }, { id: result.id })) as Record<string, unknown>
    expect(order.status).toBe('draft')
    expect(order.number).toEqual(expect.any(Number))
  })

  it('release copies active BOM items and routing operations as snapshot rows', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )

    seed({ name: 'ProductionBom' }, {
      id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
    })
    seed({ name: 'ProductionBomItem' }, {
      id: 'bom-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, bomId: 'bom-1',
      componentProductId: 'component-1', componentVariantId: null, qtyPerUnit: '2', uom: 'pcs',
      scrapFactor: '0', isPhantom: false, operationSequence: 1, deletedAt: null,
    })
    seed({ name: 'Routing' }, {
      id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
    })
    seed({ name: 'RoutingOperation' }, {
      id: 'routing-op-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, routingId: 'routing-1',
      sequence: 1, name: 'Cut', workCenterId: 'wc-1', setupTimeMinutes: '10', runTimePerUnitSeconds: '5',
      isReportingPoint: true, deletedAt: null,
    })

    // plan first (draft -> planned -> released, per the status machine).
    await cmds.plan.execute({ id: orderId }, ctx)
    const result = await cmds.release.execute({ id: orderId }, ctx)

    expect(result.ok).toBe(true)

    const materials = await em.find({ name: 'ProductionOrderMaterial' }, { orderId })
    expect(materials).toHaveLength(1)
    expect(materials[0]).toMatchObject({
      componentProductId: 'component-1',
      qtyRequired: '2',
      uom: 'pcs',
      sourceBomItemId: 'bom-item-1',
    })

    const operations = await em.find({ name: 'ProductionOrderOperation' }, { orderId })
    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({
      name: 'Cut',
      workCenterId: 'wc-1',
      isReportingPoint: true,
      sourceOperationId: 'routing-op-1',
    })

    const order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('released')
    expect(order.bomVersionId).toBe('bom-1')
    expect(order.routingVersionId).toBe('routing-1')
  })

  it('a BOM edit AFTER release does not affect the already-released order snapshot', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )

    const bomRow = seed({ name: 'ProductionBom' }, {
      id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
    }) as Record<string, unknown>
    seed({ name: 'ProductionBomItem' }, {
      id: 'bom-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, bomId: 'bom-1',
      componentProductId: 'component-1', componentVariantId: null, qtyPerUnit: '2', uom: 'pcs',
      scrapFactor: '0', isPhantom: false, operationSequence: 1, deletedAt: null,
    })
    seed({ name: 'Routing' }, {
      id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
    })
    seed({ name: 'RoutingOperation' }, {
      id: 'routing-op-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, routingId: 'routing-1',
      sequence: 1, name: 'Cut', workCenterId: 'wc-1', setupTimeMinutes: '10', runTimePerUnitSeconds: '5',
      isReportingPoint: true, deletedAt: null,
    })

    await cmds.plan.execute({ id: orderId }, ctx)
    await cmds.release.execute({ id: orderId }, ctx)

    const materialsBefore = await em.find({ name: 'ProductionOrderMaterial' }, { orderId })
    expect(materialsBefore[0].qtyRequired).toBe('2')

    // Edit the BOM item's qty AFTER release — this simulates the source BOM
    // being changed post-release (the DoD's explicit non-regression case).
    const bomItemRow = (await em.findOne({ name: 'ProductionBomItem' }, { id: 'bom-item-1' })) as Record<string, unknown>
    bomItemRow.qtyPerUnit = '999'
    bomRow.name = 'BOM v1 (edited after release)'

    const materialsAfter = await em.find({ name: 'ProductionOrderMaterial' }, { orderId })
    expect(materialsAfter[0].qtyRequired).toBe('2')
    expect(materialsAfter[0].sourceBomItemId).toBe('bom-item-1')
  })

  it('release rejects with a translated 422 when no active routing exists', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )
    seed({ name: 'ProductionBom' }, {
      id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
    })
    // No active Routing seeded.

    await cmds.plan.execute({ id: orderId }, ctx)

    await expect(cmds.release.execute({ id: orderId }, ctx)).rejects.toMatchObject({ status: 422 })
  })

  it('release rejects with a translated 422 when no active BOM exists', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )
    seed({ name: 'Routing' }, {
      id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
    })
    // No active ProductionBom seeded.

    await cmds.plan.execute({ id: orderId }, ctx)

    await expect(cmds.release.execute({ id: orderId }, ctx)).rejects.toMatchObject({ status: 422 })
  })

  it('cancel from released releases active reservations via the stock provider', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )
    seed({ name: 'ProductionBom' }, {
      id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
    })
    seed({ name: 'Routing' }, {
      id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
    })

    await cmds.plan.execute({ id: orderId }, ctx)
    await cmds.release.execute({ id: orderId }, ctx)

    const result = await cmds.cancel.execute({ id: orderId }, ctx)
    expect(result.ok).toBe(true)

    expect(ctx.__stockProvider.releaseReservations).toHaveBeenCalledTimes(1)
    const [refArg] = ctx.__stockProvider.releaseReservations.mock.calls[0]
    expect(refArg).toMatchObject({ sourceType: 'order', sourceId: orderId })

    const order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('cancelled')
  })

  it('cancel is blocked with a translated 409 when a material was partially issued', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )
    seed({ name: 'ProductionBom' }, {
      id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
    })
    seed({ name: 'Routing' }, {
      id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
    })

    await cmds.plan.execute({ id: orderId }, ctx)
    await cmds.release.execute({ id: orderId }, ctx)

    const materials = await em.find({ name: 'ProductionOrderMaterial' }, { orderId })
    // Phase 3.1 has no active BOM items seeded above (only header rows), so
    // seed a material row directly to simulate a partially issued line.
    if (materials.length === 0) {
      seed({ name: 'ProductionOrderMaterial' }, {
        id: 'order-material-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, orderId,
        operationSequence: null, componentProductId: 'component-1', componentVariantId: null,
        qtyRequired: '2', uom: 'pcs', scrapFactor: '0', qtyIssued: '1', sourceBomItemId: null, deletedAt: null,
      })
    } else {
      ;(materials[0] as Record<string, unknown>).qtyIssued = '1'
    }

    expect(ctx.__stockProvider.releaseReservations).not.toHaveBeenCalled()
    await expect(cmds.cancel.execute({ id: orderId }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(ctx.__stockProvider.releaseReservations).not.toHaveBeenCalled()

    const order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('released')
  })

  it('rejects a stale aggregate optimistic-lock token with a 409 conflict', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )

    const staleCtx = makeCtx(em, { request: optimisticLockHeaderRequest('1999-01-01T00:00:00.000Z') })

    await expect(cmds.plan.execute({ id: orderId }, staleCtx)).rejects.toMatchObject({ status: 409 })

    const order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('draft')
  })

  it('emits the declared production.order.released and production.order.cancelled lifecycle events', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { id: orderId } = await cmds.create.execute(
      { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
      ctx,
    )
    seed({ name: 'ProductionBom' }, {
      id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
    })
    seed({ name: 'Routing' }, {
      id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
    })

    await cmds.plan.execute({ id: orderId }, ctx)
    await cmds.release.execute({ id: orderId }, ctx)
    await cmds.cancel.execute({ id: orderId }, ctx)

    expect(ctx.__dataEngine.markOrmEntityChange).toHaveBeenCalled()
    expect(emitProductionEventMock).toHaveBeenCalledWith(
      'production.order.released',
      expect.objectContaining({ id: orderId }),
    )
    expect(emitProductionEventMock).toHaveBeenCalledWith(
      'production.order.cancelled',
      expect.objectContaining({ id: orderId }),
    )
  })

  describe('release-time material reservations + shortage list (task 3.2)', () => {
    async function releaseWithBomItem(
      em: ReturnType<typeof makeMockEm>['em'],
      seed: ReturnType<typeof makeMockEm>['seed'],
      ctx: ReturnType<typeof makeCtx>,
      cmds: Record<string, any>,
      opts: { qtyPerUnit: string; componentProductId?: string },
    ) {
      const { id: orderId } = await cmds.create.execute(
        { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
        ctx,
      )
      seed({ name: 'ProductionBom' }, {
        id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
      })
      seed({ name: 'ProductionBomItem' }, {
        id: 'bom-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, bomId: 'bom-1',
        componentProductId: opts.componentProductId ?? 'component-1', componentVariantId: null, qtyPerUnit: opts.qtyPerUnit, uom: 'pcs',
        scrapFactor: '0', isPhantom: false, operationSequence: 1, deletedAt: null,
      })
      seed({ name: 'Routing' }, {
        id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
      })
      await cmds.plan.execute({ id: orderId }, ctx)
      const result = await cmds.release.execute({ id: orderId }, ctx)
      return { orderId, result }
    }

    /**
     * Same shape as {@link releaseWithBomItem}, but seeds N `ProductionBomItem`
     * rows (each becomes its own `ProductionOrderMaterial` snapshot line at
     * release) instead of exactly one — used for the shared-component and
     * mid-loop-provider-failure regression tests below.
     */
    async function releaseWithBomItems(
      em: ReturnType<typeof makeMockEm>['em'],
      seed: ReturnType<typeof makeMockEm>['seed'],
      ctx: ReturnType<typeof makeCtx>,
      cmds: Record<string, any>,
      items: Array<{ id: string; componentProductId: string; qtyPerUnit: string; operationSequence: number }>,
    ) {
      const { id: orderId } = await cmds.create.execute(
        { productId: 'product-1', variantId: null, qtyPlanned: 5, uom: 'pcs', dueDate: null, priority: 0, sourceType: 'manual', sourceId: null },
        ctx,
      )
      seed({ name: 'ProductionBom' }, {
        id: 'bom-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'BOM v1', deletedAt: null,
      })
      for (const item of items) {
        seed({ name: 'ProductionBomItem' }, {
          id: item.id, tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, bomId: 'bom-1',
          componentProductId: item.componentProductId, componentVariantId: null, qtyPerUnit: item.qtyPerUnit, uom: 'pcs',
          scrapFactor: '0', isPhantom: false, operationSequence: item.operationSequence, deletedAt: null,
        })
      }
      seed({ name: 'Routing' }, {
        id: 'routing-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'product-1', variantId: null, version: 1, status: 'active', name: 'Routing v1', deletedAt: null,
      })
      await cmds.plan.execute({ id: orderId }, ctx)
      const result = await cmds.release.execute({ id: orderId }, ctx)
      return { orderId, result }
    }

    it('reserves the full requirement and reports zero shortages when stock fully covers it', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()

      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '20', reserved: '0', deletedAt: null,
      })

      const { result } = await releaseWithBomItem(em, seed, ctx, cmds, { qtyPerUnit: '2' })

      expect(result.ok).toBe(true)
      expect(result.reservations).toBe(1)
      expect(result.shortages).toEqual([])
      expect(ctx.__stockProvider.reserve).toHaveBeenCalledTimes(1)
      const [lines, ref] = ctx.__stockProvider.reserve.mock.calls[0]
      expect(lines).toEqual([{ productId: 'component-1', variantId: null, qty: 2, uom: 'pcs' }])
      expect(ref).toMatchObject({ sourceType: 'order' })
    })

    it('partially reserves and reports an insufficient_stock shortage line when stock is short', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()

      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '1', reserved: '0', deletedAt: null,
      })

      // qtyPerUnit '2' -> qtyRequired snapshot is '2' (task 3.1 semantics), only 1 available.
      const { result } = await releaseWithBomItem(em, seed, ctx, cmds, { qtyPerUnit: '2' })

      expect(result.ok).toBe(true)
      expect(result.reservations).toBe(1)
      expect(ctx.__stockProvider.reserve).toHaveBeenCalledTimes(1)
      const [lines] = ctx.__stockProvider.reserve.mock.calls[0]
      expect(lines).toEqual([{ productId: 'component-1', variantId: null, qty: 1, uom: 'pcs' }])
      expect(result.shortages).toEqual([
        expect.objectContaining({
          componentProductId: 'component-1',
          qtyRequired: 2,
          qtyAvailable: 1,
          qtyShort: 1,
          reason: 'insufficient_stock',
        }),
      ])
    })

    it('reports a no_stock_item shortage and still succeeds when no stock item exists for the component', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()

      const { result } = await releaseWithBomItem(em, seed, ctx, cmds, { qtyPerUnit: '3' })

      expect(result.ok).toBe(true)
      expect(result.reservations).toBe(0)
      expect(ctx.__stockProvider.reserve).not.toHaveBeenCalled()
      expect(result.shortages).toEqual([
        expect.objectContaining({
          componentProductId: 'component-1',
          qtyRequired: 3,
          qtyAvailable: 0,
          qtyShort: 3,
          reason: 'no_stock_item',
        }),
      ])
    })

    it('reports a uom_mismatch shortage (not a crash) when the stock item uom differs from the material uom', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()

      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'kg', onHand: '100', reserved: '0', deletedAt: null,
      })

      const { result } = await releaseWithBomItem(em, seed, ctx, cmds, { qtyPerUnit: '2' })

      expect(result.ok).toBe(true)
      expect(result.reservations).toBe(0)
      expect(ctx.__stockProvider.reserve).not.toHaveBeenCalled()
      expect(result.shortages).toEqual([
        expect.objectContaining({
          componentProductId: 'component-1',
          reason: 'uom_mismatch',
          qtyShort: 2,
        }),
      ])
    })

    it('reclassifies a concurrent stockProvider.reserve failure on the 2nd line into a shortage instead of failing the whole release (review finding)', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const { commands: cmds, stockProviderErrors } = loadCommandsWithStockProviderErrors()

      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '10', reserved: '0', deletedAt: null,
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-2', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-2', variantId: null, uom: 'pcs', onHand: '10', reserved: '0', deletedAt: null,
      })

      // Pre-check (`getOnHand`-equivalent read) passes for both lines — the
      // provider itself only fails the SECOND call, simulating a concurrent
      // reservation/release racing in between this release's own read and
      // its second `reserve()` call.
      ctx.__stockProvider.reserve
        .mockImplementationOnce(async () => ({ reservationIds: ['reservation-1'] }))
        .mockImplementationOnce(async () => {
          throw new stockProviderErrors.InsufficientStockError('concurrent reservation raced this line to zero')
        })

      const { result } = await releaseWithBomItems(em, seed, ctx, cmds, [
        { id: 'bom-item-1', componentProductId: 'component-1', qtyPerUnit: '2', operationSequence: 1 },
        { id: 'bom-item-2', componentProductId: 'component-2', qtyPerUnit: '3', operationSequence: 2 },
      ])

      // Release completes successfully — a provider-side race on one line
      // never fails the whole command.
      expect(result.ok).toBe(true)
      expect(result.reservations).toBe(1)
      expect(ctx.__stockProvider.reserve).toHaveBeenCalledTimes(2)
      expect(result.shortages).toEqual([
        expect.objectContaining({
          componentProductId: 'component-2',
          qtyRequired: 3,
          qtyShort: 3,
          reason: 'insufficient_stock',
        }),
      ])

      // Side effects and the lifecycle event still fire despite the race.
      expect(ctx.__dataEngine.markOrmEntityChange).toHaveBeenCalled()
      expect(emitProductionEventMock).toHaveBeenCalledWith(
        'production.order.released',
        expect.anything(),
      )
    })

    it('never over-reserves a shared component across two material lines (sum of reserve() quantities never exceeds on-hand)', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()

      // Only 5 on-hand, but the two order-material lines below request 3 + 4
      // = 7 of the SAME component — the second line must see the first
      // line's consumption already deducted, never re-reading the stale
      // on-hand/reserved snapshot.
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-shared', variantId: null, uom: 'pcs', onHand: '5', reserved: '0', deletedAt: null,
      })

      const { result } = await releaseWithBomItems(em, seed, ctx, cmds, [
        { id: 'bom-item-1', componentProductId: 'component-shared', qtyPerUnit: '3', operationSequence: 1 },
        { id: 'bom-item-2', componentProductId: 'component-shared', qtyPerUnit: '4', operationSequence: 2 },
      ])

      expect(result.ok).toBe(true)
      expect(ctx.__stockProvider.reserve).toHaveBeenCalledTimes(2)
      const reservedQuantities = ctx.__stockProvider.reserve.mock.calls.map(
        ([lines]: [Array<{ qty: number }>]) => lines[0].qty,
      )
      const totalReserved = reservedQuantities.reduce((sum: number, qty: number) => sum + qty, 0)

      // The combined reservation across both lines must never exceed on-hand.
      expect(totalReserved).toBe(5)
      expect(reservedQuantities).toEqual([3, 2])

      // The remaining 2 units of unmet demand (3 + 4 = 7 required, 5 reserved)
      // surface as a shortage against the second line.
      expect(result.shortages).toEqual([
        expect.objectContaining({
          componentProductId: 'component-shared',
          qtyRequired: 4,
          qtyAvailable: 2,
          qtyShort: 2,
          reason: 'insufficient_stock',
        }),
      ])
    })
  })

  it('create translates a unique-constraint number race into a translated 409 conflict', async () => {
    const { em } = makeMockEm()
    const ctx = makeCtx(em)
    const { commands: cmds, mikroOrmCore } = loadCommandsWithMikroOrmCore()
    const { create } = cmds

    const originalFlush = em.flush
    em.flush = jest.fn(async () => {
      throw new mikroOrmCore.UniqueConstraintViolationException(
        new Error('duplicate key value violates unique constraint "production_orders_scope_number_unique"'),
      )
    })

    await expect(
      create.execute(
        {
          productId: 'product-1', variantId: null, qtyPlanned: 10, uom: 'pcs', dueDate: null,
          priority: 0, sourceType: 'manual', sourceId: null,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 409 })

    em.flush = originalFlush
  })
})
