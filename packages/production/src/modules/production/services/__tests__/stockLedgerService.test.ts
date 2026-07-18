export {}

import { StockLedgerService } from '../stockLedgerService'
import { StockItem, StockBatch, StockMovement, MaterialReservation } from '../../data/entities'
import { InsufficientStockError, DoubleReversalError } from '../../lib/stockProvider'

// Mocked em/container harness modeled on
// packages/production/src/modules/production/commands/__tests__/technology.test.ts.
// The stock ledger service is a plain service (not a registered command), so
// only the EntityManager + DataEngine are mocked — no command registry / i18n.

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

  const em: any = {
    fork: jest.fn(() => em),
    isInTransaction: jest.fn(() => false),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    create: jest.fn((EntityClass: EntityCtor, data: Record<string, unknown>) => {
      // Returns the SAME object reference that is stored (unlike a plain
      // spread-copy), so a command mutating the entity in-place after
      // `create()` (before flush) — exactly what `applyOnHandDelta` etc. do —
      // is reflected by subsequent `find`/`findOne` reads, matching real
      // MikroORM's managed-entity semantics.
      const id = (data.id as string | undefined) ?? `${EntityClass.name.toLowerCase()}-${++idCounter}`
      const row: Record<string, unknown> = { __entity: EntityClass.name, ...data, id }
      store.set(rowKey(EntityClass.name, id), row)
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

function makeDataEngine() {
  return { markOrmEntityChange: jest.fn() }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const OTHER_SCOPE = { tenantId: 'tenant-2', organizationId: 'org-2' }

function makeService(em: unknown, dataEngine: ReturnType<typeof makeDataEngine>) {
  return new StockLedgerService(() => em as any, dataEngine as any)
}

describe('StockLedgerService', () => {
  it('receive() increases on_hand and creates an append-only movement + side-effect', async () => {
    const { em } = makeMockEm()
    const dataEngine = makeDataEngine()
    const service = makeService(em, dataEngine)

    const { movementIds } = await service.receive(
      [{ productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs' }],
      { scope: SCOPE, sourceType: 'manual' },
    )

    const onHand = await service.getOnHand(SCOPE, 'prod-1', null, 'pcs')
    expect(onHand).toBe(10)
    expect(movementIds).toHaveLength(1)

    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(1)
    const call = dataEngine.markOrmEntityChange.mock.calls[0][0]
    expect(call.action).toBe('created')
    expect(call.entity.movementType).toBe('receipt')
    expect(call.entity.qty).toBe('10')
  })

  it('issue() decreases on_hand', async () => {
    const { em } = makeMockEm()
    const dataEngine = makeDataEngine()
    const service = makeService(em, dataEngine)

    await service.receive([{ productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' })
    await service.issue([{ productId: 'prod-1', variantId: null, qty: 4, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' })

    const onHand = await service.getOnHand(SCOPE, 'prod-1', null, 'pcs')
    expect(onHand).toBe(6)
  })

  it('issue() beyond on_hand - reserved throws InsufficientStockError (no negative stock)', async () => {
    const { em } = makeMockEm()
    const dataEngine = makeDataEngine()
    const service = makeService(em, dataEngine)

    await service.receive([{ productId: 'prod-1', variantId: null, qty: 5, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' })

    await expect(
      service.issue([{ productId: 'prod-1', variantId: null, qty: 6, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' }),
    ).rejects.toBeInstanceOf(InsufficientStockError)

    // on_hand must be unchanged after the rejected issue
    const onHand = await service.getOnHand(SCOPE, 'prod-1', null, 'pcs')
    expect(onHand).toBe(5)
  })

  it('reserve()/releaseReservations() adjust reserved and block issues beyond on_hand - reserved', async () => {
    const { em } = makeMockEm()
    const dataEngine = makeDataEngine()
    const service = makeService(em, dataEngine)

    await service.receive([{ productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' })
    const { reservationIds } = await service.reserve(
      [{ productId: 'prod-1', variantId: null, qty: 4, uom: 'pcs' }],
      { scope: SCOPE, sourceType: 'order', sourceId: 'order-1' },
    )
    expect(reservationIds).toHaveLength(1)

    // 10 on_hand - 4 reserved = 6 available; issuing 7 must fail
    await expect(
      service.issue([{ productId: 'prod-1', variantId: null, qty: 7, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' }),
    ).rejects.toBeInstanceOf(InsufficientStockError)

    const { releasedIds } = await service.releaseReservations({ scope: SCOPE, sourceType: 'order', sourceId: 'order-1' })
    expect(releasedIds).toHaveLength(1)

    // Now the full 10 is available again
    await service.issue([{ productId: 'prod-1', variantId: null, qty: 7, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' })
    const onHand = await service.getOnHand(SCOPE, 'prod-1', null, 'pcs')
    expect(onHand).toBe(3)
  })

  it('storno of a receipt restores prior on_hand and links reverses_movement_id; double storno is rejected', async () => {
    const { em, store } = makeMockEm()
    const dataEngine = makeDataEngine()
    const service = makeService(em, dataEngine)

    const { movementIds } = await service.receive([{ productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' })
    const receiptId = movementIds[0]

    const before = await service.getOnHand(SCOPE, 'prod-1', null, 'pcs')
    expect(before).toBe(10)

    const { movementId: reversalId } = await service.reverseMovement(receiptId, SCOPE)
    const after = await service.getOnHand(SCOPE, 'prod-1', null, 'pcs')
    expect(after).toBe(0)

    const reversalRow = store.get(`StockMovement:${reversalId}`) as any
    expect(reversalRow.reversesMovementId).toBe(receiptId)
    expect(reversalRow.qty).toBe('-10')

    await expect(service.reverseMovement(receiptId, SCOPE)).rejects.toBeInstanceOf(DoubleReversalError)
  })

  it('cross-tenant stock rows are invisible to other-tenant reads/writes', async () => {
    const { em } = makeMockEm()
    const dataEngine = makeDataEngine()
    const service = makeService(em, dataEngine)

    await service.receive([{ productId: 'prod-shared', variantId: null, qty: 20, uom: 'pcs' }], { scope: SCOPE, sourceType: 'manual' })

    // Other tenant sees zero on-hand for the same productId (no cross-tenant row visibility).
    const otherOnHand = await service.getOnHand(OTHER_SCOPE, 'prod-shared', null, 'pcs')
    expect(otherOnHand).toBe(0)

    // Other tenant receiving the same productId creates its own isolated stock item.
    await service.receive([{ productId: 'prod-shared', variantId: null, qty: 3, uom: 'pcs' }], { scope: OTHER_SCOPE, sourceType: 'manual' })

    const scopedOnHand = await service.getOnHand(SCOPE, 'prod-shared', null, 'pcs')
    expect(scopedOnHand).toBe(20)
    const otherScopedOnHand = await service.getOnHand(OTHER_SCOPE, 'prod-shared', null, 'pcs')
    expect(otherScopedOnHand).toBe(3)
  })

  it('maintains batch on_hand when a batch is passed on receive/issue', async () => {
    const { em, store } = makeMockEm()
    const dataEngine = makeDataEngine()
    const service = makeService(em, dataEngine)

    await service.receive(
      [{ productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs', batchNumber: 'B-001' }],
      { scope: SCOPE, sourceType: 'manual' },
    )

    const batches = await service.findBatches(SCOPE, 'prod-1')
    expect(batches).toHaveLength(1)
    expect(batches[0].batchNumber).toBe('B-001')
    expect(batches[0].onHand).toBe(10)

    await service.issue(
      [{ productId: 'prod-1', variantId: null, qty: 3, uom: 'pcs', batchId: batches[0].id }],
      { scope: SCOPE, sourceType: 'manual' },
    )

    const afterBatches = await service.findBatches(SCOPE, 'prod-1')
    expect(afterBatches[0].onHand).toBe(7)
  })
})
