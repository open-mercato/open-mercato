export {}

import { E } from '../../../../../generated/entities.ids.generated'

// Mocked em/container harness for production technology commands, modeled on
// packages/scheduler/src/modules/scheduler/commands/__tests__/jobs.undo.test.ts.
// `withAtomicFlush` and the shared scope guards run for real; only the
// command registry and i18n resolver are mocked (no DB in this test).

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
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
      // Mirrors real Postgres semantics: an omitted-at-insert nullable column
      // (no explicit default in the entity) is NULL, so a `null` filter value
      // matches both an explicit `null` and an entity created without the
      // field set (`undefined` in this in-memory store).
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
      const row = { ...data, id }
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
  }

  return { em, seed, store }
}

// `emitCrudSideEffects`/`emitCrudUndoSideEffects` resolve `dataEngine` from
// the container and call `dataEngine.markOrmEntityChange(...)` — mock it so
// commands can assert the indexer/events wiring (review finding #1) without
// touching a real DataEngine.
function makeDataEngine() {
  return { markOrmEntityChange: jest.fn() }
}

function makeCtx(em: unknown, overrides: Record<string, unknown> = {}) {
  const dataEngine = makeDataEngine()
  const resolve = jest.fn((key: string) => {
    if (key === 'dataEngine') return dataEngine
    return em
  })
  return {
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isSuperAdmin: false },
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: ['org-1'],
    container: { resolve },
    __dataEngine: dataEngine,
    ...overrides,
  } as any
}

function loadCommands() {
  let commands: Record<string, any> = {}
  jest.isolateModules(() => {
    require('../technology')
    for (const [cmd] of registerCommand.mock.calls) {
      commands[cmd.id] = cmd
    }
  })
  return commands
}

/**
 * Loads the technology commands module fresh (isolated, matching
 * `loadCommands()`) and returns it directly so plain exported helpers
 * (`loadActiveBomGraph`, `productKeyOf`) can be exercised without going
 * through the `registerCommand` mock-call collection `loadCommands()` uses.
 */
function loadTechnologyModule(): typeof import('../technology') {
  let mod: typeof import('../technology') | undefined
  jest.isolateModules(() => {
    mod = require('../technology')
  })
  return mod!
}

function persistedLogEntry(snapshots: { before?: unknown; after?: unknown }) {
  return {
    commandPayload: { undo: { ...snapshots } },
    snapshotBefore: snapshots.before,
    snapshotAfter: snapshots.after,
  }
}

describe('production.work_centers commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('create -> update -> delete round-trips through the mocked em', async () => {
    const { create, update, del } = (() => {
      const cmds = loadCommands()
      return {
        create: cmds['production.work_centers.create'],
        update: cmds['production.work_centers.update'],
        del: cmds['production.work_centers.delete'],
      }
    })()
    expect(create).toBeDefined()
    expect(update).toBeDefined()
    expect(del).toBeDefined()

    const { em } = makeMockEm()
    const ctx = makeCtx(em)

    const created = await create.execute(
      {
        name: 'CNC-1',
        kind: 'machine',
        costRatePerHour: 50,
        parallelStations: 1,
        efficiencyFactor: 1,
        isActive: true,
      },
      ctx,
    )
    expect(created.id).toBeDefined()

    const afterCreate = await create.captureAfter({}, created, ctx)
    expect(afterCreate.name).toBe('CNC-1')

    await update.execute({ id: created.id, name: 'CNC-1 Renamed' }, ctx)
    const afterUpdate = await update.captureAfter({ id: created.id }, {}, ctx)
    expect(afterUpdate.name).toBe('CNC-1 Renamed')

    const delResult = await del.execute({ id: created.id }, ctx)
    expect(delResult.ok).toBe(true)

    const deleted = await em.findOne({ name: 'WorkCenter' } as any, { id: created.id })
    expect((deleted as any).deletedAt).toBeInstanceOf(Date)

    // Review finding #1 (indexer dead) + #2 (missing update event): every
    // mutation must call dataEngine.markOrmEntityChange with the declared
    // indexer entityType, and update must additionally emit the declared
    // 'production.work_center.updated' event (not just created/deleted).
    const calls = (ctx.__dataEngine.markOrmEntityChange as jest.Mock).mock.calls.map(([opts]) => opts)
    expect(calls).toHaveLength(3)
    expect(calls.map((c: any) => c.action)).toEqual(['created', 'updated', 'deleted'])
    for (const call of calls) {
      expect(call.indexer).toEqual({ entityType: E.production.work_center })
    }
    expect(calls[1].events).toEqual({ module: 'production', entity: 'work_center', persistent: true })
  })

  it('update undo restores the prior field values', async () => {
    const cmds = loadCommands()
    const update = cmds['production.work_centers.update']

    const { em, seed } = makeMockEm()
    const WorkCenter = { name: 'WorkCenter' }
    seed(WorkCenter, {
      id: 'wc-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      name: 'Before name',
      kind: 'machine',
      costRatePerHour: '10',
      parallelStations: 1,
      efficiencyFactor: '1',
      availabilityRuleSetId: null,
      isActive: true,
      deletedAt: null,
    })

    const before = {
      id: 'wc-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      name: 'Before name',
      kind: 'machine',
      costRatePerHour: '10',
      parallelStations: 1,
      efficiencyFactor: '1',
      availabilityRuleSetId: null,
      isActive: true,
    }

    const ctx = makeCtx(em)
    await update.execute({ id: 'wc-1', name: 'After name' }, ctx)

    const live = await em.findOne(WorkCenter, { id: 'wc-1' })
    expect((live as any).name).toBe('After name')

    await update.undo({ logEntry: persistedLogEntry({ before }), ctx })

    const restored = await em.findOne(WorkCenter, { id: 'wc-1' })
    expect((restored as any).name).toBe('Before name')

    // Undo must also reindex (emitCrudUndoSideEffects), not just the forward path.
    const calls = (ctx.__dataEngine.markOrmEntityChange as jest.Mock).mock.calls.map(([opts]) => opts)
    expect(calls.map((c: any) => c.action)).toEqual(['updated', 'updated'])
    expect(calls.every((c: any) => c.indexer?.entityType === E.production.work_center)).toBe(true)
  })
})

describe('loadActiveBomGraph', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('returns uomByComponentKey alongside the graph, from both active-BOM items and override items (task 1.4)', async () => {
    const { loadActiveBomGraph } = loadTechnologyModule()

    const { em, seed } = makeMockEm()
    const ProductionBom = { name: 'ProductionBom' }
    const ProductionBomItem = { name: 'ProductionBomItem' }

    // Active BOM for product-b: its item's uom (KG) should show up in the map.
    seed(ProductionBom, {
      id: 'bom-b',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-b',
      variantId: null,
      version: 1,
      status: 'active',
      validFrom: null,
      validTo: null,
      name: 'B BOM',
      deletedAt: null,
    })
    seed(ProductionBomItem, {
      id: 'item-b-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      bomId: 'bom-b',
      componentProductId: 'product-c',
      componentVariantId: null,
      qtyPerUnit: '1',
      uom: 'KG',
      scrapFactor: '0',
      isPhantom: false,
      operationSequence: null,
      deletedAt: null,
    })

    const { graph, uomByComponentKey } = await loadActiveBomGraph(
      em,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      'product-a',
      [
        {
          componentProductId: 'product-b',
          componentVariantId: null,
          qtyPerUnit: 2,
          uom: 'PCS',
          scrapFactor: 0,
          isPhantom: false,
        },
      ],
    )

    // Graph itself is unchanged behavior: override product key present, active BOM present.
    expect(graph['product-a']).toEqual([
      { componentKey: 'product-b', qtyPerUnit: 2, scrapFactor: 0, isPhantom: false },
    ])
    expect(graph['product-b']).toEqual([
      { componentKey: 'product-c', qtyPerUnit: 1, scrapFactor: 0, isPhantom: false },
    ])

    // uomByComponentKey: override item's uom (PCS for product-b) AND the
    // active-BOM item's uom (KG for product-c) are both present.
    expect(uomByComponentKey['product-b']).toBe('PCS')
    expect(uomByComponentKey['product-c']).toBe('KG')
  })
})

describe('production.boms.activate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects activation when the BOM graph would form a cycle', async () => {
    const cmds = loadCommands()
    const activate = cmds['production.boms.activate']
    expect(activate).toBeDefined()

    const { em, seed } = makeMockEm()
    const ProductionBom = { name: 'ProductionBom' }
    const ProductionBomItem = { name: 'ProductionBomItem' }

    // Product A's draft BOM being activated references product B as a
    // component. Product B already has an ACTIVE BOM whose item references
    // product A back — activating A's BOM would close the cycle A -> B -> A.
    seed(ProductionBom, {
      id: 'bom-a',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-a',
      variantId: null,
      version: 1,
      status: 'draft',
      validFrom: null,
      validTo: null,
      name: 'A BOM',
      deletedAt: null,
    })
    seed(ProductionBomItem, {
      id: 'item-a-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      bomId: 'bom-a',
      componentProductId: 'product-b',
      componentVariantId: null,
      qtyPerUnit: '2',
      uom: 'PCS',
      scrapFactor: '0',
      isPhantom: false,
      operationSequence: null,
      deletedAt: null,
    })

    seed(ProductionBom, {
      id: 'bom-b',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-b',
      variantId: null,
      version: 1,
      status: 'active',
      validFrom: null,
      validTo: null,
      name: 'B BOM',
      deletedAt: null,
    })
    seed(ProductionBomItem, {
      id: 'item-b-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      bomId: 'bom-b',
      componentProductId: 'product-a',
      componentVariantId: null,
      qtyPerUnit: '1',
      uom: 'PCS',
      scrapFactor: '0',
      isPhantom: false,
      operationSequence: null,
      deletedAt: null,
    })

    const ctx = makeCtx(em)

    await expect(activate.execute({ id: 'bom-a' }, ctx)).rejects.toMatchObject({ status: 422 })

    // Status must remain untouched — the write phase never ran.
    const bomA = await em.findOne(ProductionBom, { id: 'bom-a' })
    expect((bomA as any).status).toBe('draft')
  })

  it('activates a non-cyclic BOM and archives the previously active version', async () => {
    const cmds = loadCommands()
    const activate = cmds['production.boms.activate']

    const { em, seed } = makeMockEm()
    const ProductionBom = { name: 'ProductionBom' }
    const ProductionBomItem = { name: 'ProductionBomItem' }

    seed(ProductionBom, {
      id: 'bom-old',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-x',
      variantId: null,
      version: 1,
      status: 'active',
      validFrom: null,
      validTo: null,
      name: 'Old version',
      deletedAt: null,
    })
    seed(ProductionBom, {
      id: 'bom-new',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-x',
      variantId: null,
      version: 2,
      status: 'draft',
      validFrom: null,
      validTo: null,
      name: 'New version',
      deletedAt: null,
    })
    seed(ProductionBomItem, {
      id: 'item-new-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      bomId: 'bom-new',
      componentProductId: 'product-y',
      componentVariantId: null,
      qtyPerUnit: '3',
      uom: 'PCS',
      scrapFactor: '0',
      isPhantom: false,
      operationSequence: null,
      deletedAt: null,
    })

    const ctx = makeCtx(em)
    const result = await activate.execute({ id: 'bom-new' }, ctx)
    expect(result.ok).toBe(true)
    expect(result.archivedSiblingIds).toEqual(['bom-old'])

    const newBom = await em.findOne(ProductionBom, { id: 'bom-new' })
    const oldBom = await em.findOne(ProductionBom, { id: 'bom-old' })
    expect((newBom as any).status).toBe('active')
    expect((oldBom as any).status).toBe('archived')

    // Review finding #1: activate must also reindex both the activated BOM
    // and the archived sibling (indexer-only — no duplicate 'updated' event,
    // since 'production.bom.activated' is the declared lifecycle event).
    const calls = (ctx.__dataEngine.markOrmEntityChange as jest.Mock).mock.calls.map(([opts]) => opts)
    expect(calls).toHaveLength(2)
    expect(calls.every((c: any) => c.action === 'updated' && c.indexer?.entityType === E.production.production_bom && c.events === undefined)).toBe(true)
    expect(calls.map((c: any) => c.identifiers.id).sort()).toEqual(['bom-new', 'bom-old'])
  })

  it('undo restores archived siblings to active (review finding #3)', async () => {
    const cmds = loadCommands()
    const activate = cmds['production.boms.activate']

    const { em, seed } = makeMockEm()
    const ProductionBom = { name: 'ProductionBom' }
    const ProductionBomItem = { name: 'ProductionBomItem' }

    seed(ProductionBom, {
      id: 'bom-old',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-x',
      variantId: null,
      version: 1,
      status: 'active',
      validFrom: null,
      validTo: null,
      name: 'Old version',
      deletedAt: null,
    })
    seed(ProductionBom, {
      id: 'bom-new',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-x',
      variantId: null,
      version: 2,
      status: 'draft',
      validFrom: null,
      validTo: null,
      name: 'New version',
      deletedAt: null,
    })
    seed(ProductionBomItem, {
      id: 'item-new-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      bomId: 'bom-new',
      componentProductId: 'product-y',
      componentVariantId: null,
      qtyPerUnit: '3',
      uom: 'PCS',
      scrapFactor: '0',
      isPhantom: false,
      operationSequence: null,
      deletedAt: null,
    })

    const ctx = makeCtx(em)
    const result = await activate.execute({ id: 'bom-new' }, ctx)
    expect(result.archivedSiblingIds).toEqual(['bom-old'])

    // Simulate the buildLog payload the command bus would have persisted.
    const before = { id: 'bom-new', status: 'draft' }
    const logEntry = {
      commandPayload: { undo: { before, archivedSiblingIds: result.archivedSiblingIds } },
    }

    await activate.undo({ logEntry, ctx })

    const newBom = await em.findOne(ProductionBom, { id: 'bom-new' })
    const oldBom = await em.findOne(ProductionBom, { id: 'bom-old' })
    expect((newBom as any).status).toBe('draft')
    // Before this fix, the sibling stayed 'archived' forever after an undo.
    expect((oldBom as any).status).toBe('active')
  })

  it('ignores an active BOM under a different tenant with the same productId (spec Risks: cross-tenant leakage)', async () => {
    const cmds = loadCommands()
    const activate = cmds['production.boms.activate']

    const { em, seed } = makeMockEm()
    const ProductionBom = { name: 'ProductionBom' }
    const ProductionBomItem = { name: 'ProductionBomItem' }

    // Same productId, but a DIFFERENT tenant has an active BOM whose item
    // would close a cycle back to tenant-1's candidate BOM if the graph
    // query were not tenant-scoped.
    seed(ProductionBom, {
      id: 'bom-other-tenant',
      tenantId: 'tenant-2',
      organizationId: 'org-2',
      productId: 'product-a',
      variantId: null,
      version: 1,
      status: 'active',
      validFrom: null,
      validTo: null,
      name: 'Other tenant active BOM',
      deletedAt: null,
    })
    seed(ProductionBomItem, {
      id: 'item-other-tenant-1',
      tenantId: 'tenant-2',
      organizationId: 'org-2',
      bomId: 'bom-other-tenant',
      componentProductId: 'product-a',
      componentVariantId: null,
      qtyPerUnit: '1',
      uom: 'PCS',
      scrapFactor: '0',
      isPhantom: false,
      operationSequence: null,
      deletedAt: null,
    })

    // tenant-1's own candidate BOM for product-a — no self-reference, so it
    // must activate cleanly UNLESS the other tenant's row leaks into the graph.
    seed(ProductionBom, {
      id: 'bom-tenant1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-a',
      variantId: null,
      version: 1,
      status: 'draft',
      validFrom: null,
      validTo: null,
      name: 'Tenant 1 BOM',
      deletedAt: null,
    })
    seed(ProductionBomItem, {
      id: 'item-tenant1-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      bomId: 'bom-tenant1',
      componentProductId: 'product-b',
      componentVariantId: null,
      qtyPerUnit: '2',
      uom: 'PCS',
      scrapFactor: '0',
      isPhantom: false,
      operationSequence: null,
      deletedAt: null,
    })

    const ctx = makeCtx(em)
    const result = await activate.execute({ id: 'bom-tenant1' }, ctx)
    expect(result.ok).toBe(true)
    expect(result.archivedSiblingIds).toEqual([])

    const tenant1Bom = await em.findOne(ProductionBom, { id: 'bom-tenant1' })
    const otherTenantBom = await em.findOne(ProductionBom, { id: 'bom-other-tenant' })
    expect((tenant1Bom as any).status).toBe('active')
    // The other tenant's active BOM must be completely untouched — it is
    // outside tenant-1/org-1's scope and must never be read into the graph,
    // reindexed, or archived as a "sibling".
    expect((otherTenantBom as any).status).toBe('active')
  })
})
