export {}

import { E } from '../../../../../generated/entities.ids.generated'

// Mocked em/container harness for production report commands, modeled on
// `commands/__tests__/orders.test.ts`.

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
    issue: jest.fn(async () => ({ movementIds: ['movement-issue-1'] })),
    receive: jest.fn(async () => ({ movementIds: ['movement-receipt-1'] })),
    adjust: jest.fn(async () => ({ movementId: 'mv-1' })),
    findBatches: jest.fn(async () => []),
    reverseMovement: jest.fn(async (movementId: string) => ({ movementId: `reversal-of-${movementId}` })),
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

function loadCommands(): Record<string, any> {
  const byFullId: Record<string, any> = {}
  jest.isolateModules(() => {
    require('../reports')
    for (const [cmd] of registerCommand.mock.calls) {
      byFullId[cmd.id] = cmd
    }
  })
  const commands: Record<string, any> = {}
  for (const [fullId, cmd] of Object.entries(byFullId)) {
    commands[fullId.replace('production.reports.', '')] = cmd
  }
  return commands
}

/**
 * Same isolateModules/instanceof concern `commands/__tests__/orders.test.ts`
 * documents for its own `loadCommandsWithStockProviderErrors` helper: a
 * mocked `stockProvider.issue` must reject with the SAME `InsufficientStockError`
 * class `reports.ts`'s `err instanceof InsufficientStockError` check sees
 * inside the isolated registry, not the top-of-file import's instance.
 */
function loadCommandsWithStockProviderErrors(): {
  commands: Record<string, any>
  stockProviderErrors: typeof import('../../lib/stockProvider')
} {
  const byFullId: Record<string, any> = {}
  let stockProviderErrors!: typeof import('../../lib/stockProvider')
  jest.isolateModules(() => {
    require('../reports')
    stockProviderErrors = require('../../lib/stockProvider')
    for (const [cmd] of registerCommand.mock.calls) {
      byFullId[cmd.id] = cmd
    }
  })
  const commands: Record<string, any> = {}
  for (const [fullId, cmd] of Object.entries(byFullId)) {
    commands[fullId.replace('production.reports.', '')] = cmd
  }
  return { commands, stockProviderErrors }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function optimisticLockHeaderRequest(expectedIso: string): Request {
  return new Request('http://localhost/test', {
    headers: { 'x-om-ext-optimistic-lock-expected-updated-at': expectedIso },
  })
}

/** Seeds a released order with one reporting-point operation and (optionally) material lines. */
function seedReleasedOrder(
  seed: ReturnType<typeof makeMockEm>['seed'],
  opts: {
    orderId?: string
    operationId?: string
    sequence?: number
    isReportingPoint?: boolean
    backflush?: boolean | 'none'
    materials?: Array<{
      id: string
      componentProductId: string
      componentVariantId?: string | null
      operationSequence: number | null
      qtyRequired: string
      scrapFactor?: string
      uom?: string
      qtyIssued?: string
    }>
  } = {},
) {
  const orderId = opts.orderId ?? 'order-1'
  const operationId = opts.operationId ?? 'op-1'
  const order = seed({ name: 'ProductionOrder' }, {
    id: orderId, tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
    number: 1, productId: 'product-1', variantId: null, qtyPlanned: '10', uom: 'pcs',
    dueDate: null, priority: 0, status: 'released', sourceType: 'manual', sourceId: null,
    bomVersionId: 'bom-1', routingVersionId: 'routing-1', releasedAt: new Date(),
    qtyCompleted: '0', qtyScrapped: '0', deletedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'), createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }) as Record<string, unknown>

  const operation = seed({ name: 'ProductionOrderOperation' }, {
    id: operationId, tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, orderId,
    sequence: opts.sequence ?? 1, name: 'Assemble', workCenterId: 'wc-1',
    setupTimeMinutes: '0', runTimePerUnitSeconds: '0',
    isReportingPoint: opts.isReportingPoint ?? true, status: 'pending',
    qtyGood: '0', qtyScrap: '0', sourceOperationId: 'routing-op-1', deletedAt: null,
  })

  if (opts.backflush !== 'none') {
    seed({ name: 'ProductPlanningParams' }, {
      id: 'params-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'product-1', variantId: null, procurement: 'make', leadTimeDays: 0,
      minLot: '0', lotMultiple: '0', safetyStock: '0', backflush: opts.backflush ?? true, deletedAt: null,
    })
  }

  for (const material of opts.materials ?? []) {
    seed({ name: 'ProductionOrderMaterial' }, {
      id: material.id, tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, orderId,
      operationSequence: material.operationSequence, componentProductId: material.componentProductId,
      componentVariantId: material.componentVariantId ?? null, qtyRequired: material.qtyRequired,
      uom: material.uom ?? 'pcs', scrapFactor: material.scrapFactor ?? '0',
      qtyIssued: material.qtyIssued ?? '0', sourceBomItemId: null, deletedAt: null,
    })
  }

  return { orderId, operationId, order, operation }
}

describe('production.reports commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('a partial report increments operation quantities and transitions released -> in_progress on the first report', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()
    const { orderId, operationId } = seedReleasedOrder(seed, { backflush: 'none' })

    const result = await cmds.create.execute(
      { orderOperationId: operationId, qtyGood: 3, qtyScrap: 1, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
      ctx,
    )

    expect(result.id).toBeTruthy()
    expect(result.warnings).toEqual([])

    const operation = (await em.findOne({ name: 'ProductionOrderOperation' }, { id: operationId })) as Record<string, unknown>
    expect(operation.qtyGood).toBe('3')
    expect(operation.qtyScrap).toBe('1')
    expect(operation.status).toBe('in_progress')

    const order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('in_progress')
    expect(order.qtyCompleted).toBe('0') // only final reports add to qtyCompleted

    expect(ctx.__dataEngine.markOrmEntityChange).toHaveBeenCalled()
    expect(emitProductionEventMock).toHaveBeenCalledWith('production.report.created', expect.objectContaining({ id: result.id }))
  })

  it('a final report on the LAST reporting-point operation calls provider.receive and completes the order', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()
    const { orderId, operationId } = seedReleasedOrder(seed, { backflush: 'none' })

    const result = await cmds.create.execute(
      { orderOperationId: operationId, qtyGood: 7, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
      ctx,
    )

    expect(result.warnings).toEqual([])
    expect(ctx.__stockProvider.receive).toHaveBeenCalledTimes(1)
    const [lines, ref] = ctx.__stockProvider.receive.mock.calls[0]
    expect(lines).toEqual([{ productId: 'product-1', variantId: null, qty: 7, uom: 'pcs' }])
    expect(ref).toMatchObject({ sourceType: 'report' })

    const order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('completed')
    expect(order.qtyCompleted).toBe('7')

    const operation = (await em.findOne({ name: 'ProductionOrderOperation' }, { id: operationId })) as Record<string, unknown>
    expect(operation.status).toBe('done')

    expect(emitProductionEventMock).toHaveBeenCalledWith('production.order.completed', expect.objectContaining({ id: orderId }))
  })

  it('a final report on a NON-last reporting-point operation does NOT trigger provider.receive or complete the order; only the LAST op final report does — receive is called exactly once with the correct final quantity (reviewer follow-up)', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()

    const { orderId } = seedReleasedOrder(seed, { operationId: 'op-1', sequence: 1, backflush: 'none' })
    seed({ name: 'ProductionOrderOperation' }, {
      id: 'op-2', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, orderId,
      sequence: 2, name: 'Final assembly', workCenterId: 'wc-1', setupTimeMinutes: '0', runTimePerUnitSeconds: '0',
      isReportingPoint: true, status: 'pending', qtyGood: '0', qtyScrap: '0', sourceOperationId: 'routing-op-2', deletedAt: null,
    })

    // Final report against the FIRST (non-last) reporting-point operation.
    const firstFinal = await cmds.create.execute(
      { orderOperationId: 'op-1', qtyGood: 4, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
      ctx,
    )
    expect(firstFinal.warnings).toEqual([])
    expect(ctx.__stockProvider.receive).not.toHaveBeenCalled()

    let order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('in_progress') // NOT completed yet
    expect(order.qtyCompleted).toBe('0') // NOT incremented by the non-last final report

    const opOne = (await em.findOne({ name: 'ProductionOrderOperation' }, { id: 'op-1' })) as Record<string, unknown>
    expect(opOne.status).toBe('done') // the operation itself IS finalized

    // Now finalize the LAST reporting-point operation.
    const lastFinal = await cmds.create.execute(
      { orderOperationId: 'op-2', qtyGood: 6, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
      ctx,
    )
    expect(lastFinal.warnings).toEqual([])

    // receive() is called exactly ONCE across both reports, with only the
    // LAST report's qtyGood-driven cumulative total (not 4 + 6 = 10, and not
    // called a second time for the first, non-last, final report).
    expect(ctx.__stockProvider.receive).toHaveBeenCalledTimes(1)
    const [lines] = ctx.__stockProvider.receive.mock.calls[0]
    expect(lines).toEqual([{ productId: 'product-1', variantId: null, qty: 6, uom: 'pcs' }])

    order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
    expect(order.status).toBe('completed')
    expect(order.qtyCompleted).toBe('6') // only the LAST op's report contributed
  })

  describe('backflush matrix', () => {
    it('issues qtyPerUnit * reportedGoodQty in the stock item uom (passthrough, no conversion needed)', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, {
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '2', uom: 'pcs' }],
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '100', reserved: '0', deletedAt: null,
      })

      const result = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      expect(result.warnings).toEqual([])
      expect(ctx.__stockProvider.issue).toHaveBeenCalledTimes(1)
      const [lines] = ctx.__stockProvider.issue.mock.calls[0]
      expect(lines).toEqual([{ productId: 'component-1', variantId: null, qty: 10, uom: 'pcs' }])

      const material = (await em.findOne({ name: 'ProductionOrderMaterial' }, { id: 'mat-1' })) as Record<string, unknown>
      expect(material.qtyIssued).toBe('10')
    })

    it('consumes material for BOTH good and scrap reported units', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, {
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '2', uom: 'pcs' }],
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '100', reserved: '0', deletedAt: null,
      })

      await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 4, qtyScrap: 2, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      const [lines] = ctx.__stockProvider.issue.mock.calls[0]
      expect(lines[0].qty).toBe(12) // 2 * (4 + 2)
    })

    it('converts a material line UoM into the stock item UoM using catalog toBaseFactor', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, {
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '1', uom: 'box' }],
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '1000', reserved: '0', deletedAt: null,
      })
      seed({ name: 'CatalogProductUnitConversion' }, {
        id: 'conv-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        product: 'component-1', unitCode: 'box', toBaseFactor: '12', isActive: true, deletedAt: null,
      })

      const result = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 2, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      expect(result.warnings).toEqual([])
      const [lines] = ctx.__stockProvider.issue.mock.calls[0]
      // 1 box/unit * 2 units = 2 box, converted to pcs via factor 12 -> 24 pcs
      expect(lines).toEqual([{ productId: 'component-1', variantId: null, qty: 24, uom: 'pcs' }])
    })

    it('backflushes an operation-unassigned (null operationSequence) material only on the LAST reporting-point operation', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()

      // Two reporting-point operations: sequence 1 (not last) and sequence 2 (last).
      const { orderId } = seedReleasedOrder(seed, {
        operationId: 'op-1', sequence: 1,
        materials: [{ id: 'mat-shared', componentProductId: 'component-shared', operationSequence: null, qtyRequired: '1', uom: 'pcs' }],
      })
      seed({ name: 'ProductionOrderOperation' }, {
        id: 'op-2', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, orderId,
        sequence: 2, name: 'Final assembly', workCenterId: 'wc-1', setupTimeMinutes: '0', runTimePerUnitSeconds: '0',
        isReportingPoint: true, status: 'pending', qtyGood: '0', qtyScrap: '0', sourceOperationId: 'routing-op-2', deletedAt: null,
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-shared', variantId: null, uom: 'pcs', onHand: '1000', reserved: '0', deletedAt: null,
      })

      // Report against the FIRST (non-last) reporting operation — the
      // null-operationSequence material must NOT be backflushed here.
      await cmds.create.execute(
        { orderOperationId: 'op-1', qtyGood: 3, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )
      expect(ctx.__stockProvider.issue).not.toHaveBeenCalled()

      // Report against the LAST reporting operation — it must be backflushed now.
      await cmds.create.execute(
        { orderOperationId: 'op-2', qtyGood: 3, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )
      expect(ctx.__stockProvider.issue).toHaveBeenCalledTimes(1)
      const [lines] = ctx.__stockProvider.issue.mock.calls[0]
      expect(lines).toEqual([{ productId: 'component-shared', variantId: null, qty: 3, uom: 'pcs' }])
    })

    it('does NOT backflush when the product has no ProductPlanningParams row (manual issue expected)', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, {
        backflush: 'none',
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '2', uom: 'pcs' }],
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '100', reserved: '0', deletedAt: null,
      })

      const result = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      expect(result.warnings).toEqual([])
      expect(ctx.__stockProvider.issue).not.toHaveBeenCalled()
    })

    it('does NOT backflush when planning params explicitly disable it', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, {
        backflush: false,
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '2', uom: 'pcs' }],
      })

      await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      expect(ctx.__stockProvider.issue).not.toHaveBeenCalled()
    })

    it('collects an insufficient-stock provider failure as a warning instead of failing the report', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const { commands: cmds, stockProviderErrors } = loadCommandsWithStockProviderErrors()
      const { operationId } = seedReleasedOrder(seed, {
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '2', uom: 'pcs' }],
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '100', reserved: '0', deletedAt: null,
      })

      ctx.__stockProvider.issue.mockRejectedValueOnce(new stockProviderErrors.InsufficientStockError('out of stock'))

      const result = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      expect(result.warnings).toEqual([
        expect.objectContaining({ componentProductId: 'component-1', reason: 'insufficient_stock' }),
      ])
      // The report itself still succeeded.
      expect(result.id).toBeTruthy()
      const material = (await em.findOne({ name: 'ProductionOrderMaterial' }, { id: 'mat-1' })) as Record<string, unknown>
      expect(material.qtyIssued).toBe('0') // not incremented since the issue failed
    })

    it('collects a missing-conversion case as a warning when the material UoM differs from the stock item UoM with no factor available', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, {
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '2', uom: 'box' }],
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '100', reserved: '0', deletedAt: null,
      })
      // No CatalogProductUnitConversion row seeded — no factor available.

      const result = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      expect(result.warnings).toEqual([
        expect.objectContaining({ componentProductId: 'component-1', reason: 'missing_conversion' }),
      ])
      expect(ctx.__stockProvider.issue).not.toHaveBeenCalled()
    })
  })

  describe('storno (reverse)', () => {
    it('reverses the movements a report created and decrements operation/material quantities', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, {
        materials: [{ id: 'mat-1', componentProductId: 'component-1', operationSequence: 1, qtyRequired: '2', uom: 'pcs' }],
      })
      seed({ name: 'StockItem' }, {
        id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        productId: 'component-1', variantId: null, uom: 'pcs', onHand: '100', reserved: '0', deletedAt: null,
      })

      const created = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 4, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      // Simulate the movement the backflush issue call created, tied to this report.
      seed({ name: 'StockMovement' }, {
        id: 'movement-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        movementType: 'issue', productId: 'component-1', variantId: null, batchId: null,
        qty: '-8', uom: 'pcs', reasonEntryId: null, sourceType: 'report', sourceId: created.id,
        reversesMovementId: null, createdAt: new Date(),
      })

      const reverseResult = await cmds.reverse.execute({ id: created.id }, ctx)

      expect(reverseResult.id).toBeTruthy()
      expect(reverseResult.reversedMovementIds).toEqual(['reversal-of-movement-1'])
      expect(ctx.__stockProvider.reverseMovement).toHaveBeenCalledWith('movement-1', SCOPE)

      const operation = (await em.findOne({ name: 'ProductionOrderOperation' }, { id: operationId })) as Record<string, unknown>
      expect(operation.qtyGood).toBe('0')

      const material = (await em.findOne({ name: 'ProductionOrderMaterial' }, { id: 'mat-1' })) as Record<string, unknown>
      expect(material.qtyIssued).toBe('0') // 8 issued, 8 reversed back out

      expect(emitProductionEventMock).toHaveBeenCalledWith('production.report.reversed', expect.objectContaining({ id: created.id }))
    })

    it('reversing the last-op FINAL report of a completed order reopens it to in_progress, decrements qtyCompleted, reverses the FG movement, and allows a corrected final report afterwards (full round trip, reviewer follow-up)', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { orderId, operationId } = seedReleasedOrder(seed, { backflush: 'none' })

      const finalReport = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 8, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      let order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
      expect(order.status).toBe('completed')
      expect(order.qtyCompleted).toBe('8')
      expect(ctx.__stockProvider.receive).toHaveBeenCalledTimes(1)

      // Simulate the FG receipt movement this final report created.
      seed({ name: 'StockMovement' }, {
        id: 'movement-fg-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
        movementType: 'receipt', productId: 'product-1', variantId: null, batchId: null,
        qty: '8', uom: 'pcs', reasonEntryId: null, sourceType: 'report', sourceId: finalReport.id,
        reversesMovementId: null, createdAt: new Date(),
      })

      const reversal = await cmds.reverse.execute({ id: finalReport.id }, ctx)
      expect(reversal.reversedMovementIds).toEqual(['reversal-of-movement-fg-1'])
      expect(ctx.__stockProvider.reverseMovement).toHaveBeenCalledWith('movement-fg-1', SCOPE)

      order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
      expect(order.status).toBe('in_progress') // reopened, not stuck completed
      expect(order.qtyCompleted).toBe('0') // decremented back

      const operation = (await em.findOne({ name: 'ProductionOrderOperation' }, { id: operationId })) as Record<string, unknown>
      expect(operation.status).toBe('in_progress') // no longer 'done'
      expect(operation.qtyGood).toBe('0')

      // A corrected final report can now be submitted — full round trip.
      const correctedFinal = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 9, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )
      expect(correctedFinal.warnings).toEqual([])
      expect(ctx.__stockProvider.receive).toHaveBeenCalledTimes(2)
      const [lastReceiveLines] = ctx.__stockProvider.receive.mock.calls[1]
      expect(lastReceiveLines).toEqual([{ productId: 'product-1', variantId: null, qty: 9, uom: 'pcs' }])

      order = (await em.findOne({ name: 'ProductionOrder' }, { id: orderId })) as Record<string, unknown>
      expect(order.status).toBe('completed')
      expect(order.qtyCompleted).toBe('9')
    })

    it('rejects reversing the same report twice with a translated 409 conflict', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, { backflush: 'none' })

      const created = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 4, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      await cmds.reverse.execute({ id: created.id }, ctx)

      await expect(cmds.reverse.execute({ id: created.id }, ctx)).rejects.toMatchObject({ status: 409 })
    })

    it('rejects reversing a compensating (storno) report itself', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, { backflush: 'none' })

      const created = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 4, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )
      const reversal = await cmds.reverse.execute({ id: created.id }, ctx)

      await expect(cmds.reverse.execute({ id: reversal.id }, ctx)).rejects.toMatchObject({ status: 422 })
    })
  })

  describe('concurrency — two operators finalize the same operation', () => {
    it('the first finalize wins; the second (stale aggregate token) gets a translated 409 conflict', async () => {
      const { em, seed } = makeMockEm()
      const { operationId } = seedReleasedOrder(seed, { backflush: 'none' })

      const orderBefore = (await em.findOne({ name: 'ProductionOrder' }, { id: 'order-1' })) as Record<string, unknown>
      const staleToken = (orderBefore.updatedAt as Date).toISOString()

      const cmds = loadCommands()
      const ctxOperatorA = makeCtx(em, { request: optimisticLockHeaderRequest(staleToken) })
      const ctxOperatorB = makeCtx(em, { request: optimisticLockHeaderRequest(staleToken) })

      // Operator A finalizes first — wins, order advances (updatedAt changes).
      const resultA = await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctxOperatorA,
      )
      expect(resultA.id).toBeTruthy()

      // Operator B submits against the SAME stale token operator A held —
      // the aggregate optimistic lock on the order rejects it with a 409.
      await expect(
        cmds.create.execute(
          { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
          ctxOperatorB,
        ),
      ).rejects.toMatchObject({ status: 409 })

      const operation = (await em.findOne({ name: 'ProductionOrderOperation' }, { id: operationId })) as Record<string, unknown>
      expect(operation.status).toBe('done')
      expect(operation.qtyGood).toBe('5') // NOT double-applied by operator B
    })

    it('rejects a second final report once the operation is already done (no optimistic-lock header sent)', async () => {
      const { em, seed } = makeMockEm()
      const ctx = makeCtx(em)
      const cmds = loadCommands()
      const { operationId } = seedReleasedOrder(seed, { backflush: 'none' })

      await cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      )

      // This operation was the order's only (and therefore last) reporting
      // point, so the first final report already completed the whole order
      // — a second report is rejected because the ORDER is no longer
      // released/in_progress (422 `report_order_not_active`), which is a
      // stronger and equally translated guard than the operation-level
      // "already done" 409 (that 409 path is exercised by the
      // stale-optimistic-lock-token concurrency test above, which reaches a
      // still in_progress order with a done operation).
      await expect(
        cmds.create.execute(
          { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'final', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
          ctx,
        ),
      ).rejects.toMatchObject({ status: 422 })
    })
  })

  it('rejects a report against a non-reporting-point operation with a translated 422', async () => {
    const { em, seed } = makeMockEm()
    const ctx = makeCtx(em)
    const cmds = loadCommands()
    const { operationId } = seedReleasedOrder(seed, { isReportingPoint: false, backflush: 'none' })

    await expect(
      cmds.create.execute(
        { orderOperationId: operationId, qtyGood: 5, qtyScrap: 0, reportType: 'partial', scrapReasonEntryId: null, startedAt: null, finishedAt: null },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('registers both commands', () => {
    loadCommands()
    expect(registerCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'production.reports.create' }))
    expect(registerCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'production.reports.reverse' }))
  })
})
