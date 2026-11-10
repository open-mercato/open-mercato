// #8268 review Major 3 / #8817: `sales.order.confirmed` on an uncancel transition must
// reinstate BOTH halves `order-cancelled-usage-revert.ts` reverted on `sales.order.
// cancelled` — the promotion-budget ledger (`PromotionUsageService.reinstateUsage`) and
// the code-usage/redemption counter (`PromotionCodeService.reinstateCodeUse`). Runs
// against the same hand-built, in-memory fake `EntityManager` as the revert subscriber's
// own test (no real database), exercising the REAL services end to end.

import { randomUUID } from 'crypto'
import handle from '../order-confirmed-usage-reinstate'
import { Code, CodeUsage, GeneratedCode } from '../../data/entities'
import { PromotionUsage } from '../../data/entities'
import { PromotionCodeService } from '../../lib/code-service'
import { PromotionUsageService } from '../../lib/promotion-usage-service'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const ORDER_ID = 'order-1'

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition && typeof condition === 'object' && !(condition instanceof Date) && '$ne' in (condition as Row)) {
      const target = (condition as Row).$ne
      if (target === null) return value !== null && value !== undefined
      return value !== target
    }
    return value === condition
  })
}

type FakeEm = {
  findOne: (entity: Function, where: Row, options?: unknown) => Promise<Row | null>
  find: (entity: Function, where: Row) => Promise<Row[]>
  create: (entity: Function, data: Row) => Row
  persist: (row: Row) => void
  flush: () => Promise<void>
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  isInTransaction: () => boolean
  fork: () => FakeEm
  execute: (sql: string, params?: unknown[]) => Promise<unknown>
  getConnection: () => { execute: (sql: string, params?: unknown[]) => Promise<Row[]> }
  transactional: <T>(cb: (tx: FakeEm) => Promise<T>) => Promise<T>
}

// #8268 review Major 3 (re-review): the subscriber now fences on the order's CURRENT
// status (a raw `select status from sales_orders ...`) before reinstating, so a
// stale/redelivered confirmation does not reinstate usage for an order that was
// cancelled again (or deleted) afterward. Defaults to `'confirmed'` so every
// pre-existing test below — written when the order's live status was never queried —
// keeps exercising the "order really is live" path unchanged; only the new
// stale-redelivery tests override it.
function createFakeEm(options: { orderStatus?: string | null } = {}): { em: FakeEm; tables: Map<Function, Row[]> } {
  const orderStatus = options.orderStatus === undefined ? 'confirmed' : options.orderStatus
  const tables = new Map<Function, Row[]>()
  let inTransaction = false
  let pendingCreates: Array<{ entity: Function; row: Row }> = []

  function tableFor(entity: Function): Row[] {
    let rows = tables.get(entity)
    if (!rows) {
      rows = []
      tables.set(entity, rows)
    }
    return rows
  }

  const em: FakeEm = {
    findOne: async (entity, where) => tableFor(entity).find((row) => matchesWhere(row, where)) ?? null,
    find: async (entity, where) => tableFor(entity).filter((row) => matchesWhere(row, where)),
    create: (entity, data) => {
      const row: Row = { id: randomUUID(), ...data }
      pendingCreates.push({ entity, row })
      return row
    },
    persist: () => {},
    flush: async () => {
      const toApply = pendingCreates
      pendingCreates = []
      for (const { entity, row } of toApply) tableFor(entity).push(row)
    },
    begin: async () => {
      inTransaction = true
    },
    commit: async () => {
      inTransaction = false
    },
    rollback: async () => {
      inTransaction = false
    },
    isInTransaction: () => inTransaction,
    fork: () => em,
    execute: async () => [],
    getConnection: () => ({
      execute: async () => (orderStatus == null ? [] : [{ status: orderStatus }]),
    }),
    transactional: async (cb) => {
      await em.begin()
      try {
        const result = await cb(em)
        await em.commit()
        return result
      } catch (err) {
        await em.rollback()
        throw err
      }
    },
  }
  return { em, tables }
}

function asEm(fake: FakeEm): import('@mikro-orm/postgresql').EntityManager {
  return fake as unknown as import('@mikro-orm/postgresql').EntityManager
}

function seedPromotionUsage(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    promotionId: randomUUID(),
    orderId: ORDER_ID,
    orderType: 'order',
    customerId: null,
    currency: 'USD',
    totalDiscountAmount: '10.00',
    effectsSnapshot: [],
    registeredAt: new Date(),
    revertedAt: new Date(),
    ...overrides,
  }
  const rows = tables.get(PromotionUsage) ?? []
  rows.push(row)
  tables.set(PromotionUsage, rows)
  return row
}

function seedCode(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Test code',
    type: 'static',
    code: 'SAVE10',
    usage: 'single',
    usageAmount: null,
    usagePerCustomer: null,
    used: 0,
    active: true,
    deletedAt: null,
    ...overrides,
  }
  const rows = tables.get(Code) ?? []
  rows.push(row)
  tables.set(Code, rows)
  return row
}

function seedCodeUsage(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    customerId: null,
    cartId: 'cart-1',
    orderId: ORDER_ID,
    generatedCodeId: null,
    usedAt: new Date(),
    revertedAt: new Date(),
    ...overrides,
  }
  const rows = tables.get(CodeUsage) ?? []
  rows.push(row)
  tables.set(CodeUsage, rows)
  return row
}

function buildCtx(em: FakeEm) {
  const codeService = new PromotionCodeService({
    resolve: () => {
      throw new Error('[internal] unexpected DI resolve in test: rateLimiterService')
    },
  })
  const usageService = new PromotionUsageService()
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return asEm(em) as unknown as T
      if (name === 'promotionCodeService') return codeService as unknown as T
      if (name === 'promotionUsageService') return usageService as unknown as T
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
}

describe('promotions order-confirmed-usage-reinstate subscriber', () => {
  it('reinstates both the promotion usage ledger and the code usage for the uncancelled order', async () => {
    const { em, tables } = createFakeEm()
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables, { used: 0, active: true })
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em))

    expect(promotionUsage.revertedAt).toBeNull()
    expect(codeUsage.revertedAt).toBeNull()
    expect(code.used).toBe(1)
    expect(code.active).toBe(false)
  })

  // #9073: no longer gated on `previousStatus` at all — `reinstateUsage`/`reinstateCodeUse`
  // are each scoped to only this order's own reverted rows, so this fires correctly
  // whichever status immediately preceded the confirmation (including `null`).
  it('reinstates reverted usage regardless of the payload previousStatus value', async () => {
    const { em, tables } = createFakeEm()
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables, { used: 0, active: true })
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: null }, buildCtx(em))

    expect(promotionUsage.revertedAt).toBeNull()
    expect(codeUsage.revertedAt).toBeNull()
    expect(code.used).toBe(1)
  })

  // #9073: the QA-reported shape — Canceled → On hold → Confirmed. The final
  // `sales.order.confirmed` event's `previousStatus` is `on_hold`, not `canceled`, and
  // must still reinstate.
  it('reinstates reverted usage when the order was revived through an intermediate status', async () => {
    const { em, tables } = createFakeEm()
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables, { used: 0, active: true })
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'on_hold' }, buildCtx(em))

    expect(promotionUsage.revertedAt).toBeNull()
    expect(codeUsage.revertedAt).toBeNull()
    expect(code.used).toBe(1)
  })

  it('is a no-op for an ordinary initial confirmation with no reverted usage at all', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { used: 0, active: true })

    await expect(
      handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: null }, buildCtx(em)),
    ).resolves.toBeUndefined()

    expect(tables.get(PromotionUsage) ?? []).toHaveLength(0)
    expect(code.used).toBe(0)
  })

  it('is idempotent on redelivery — a second confirmation event reinstates nothing further', async () => {
    const { em, tables } = createFakeEm()
    seedPromotionUsage(tables)
    const code = seedCode(tables, { used: 0, active: true })
    seedCodeUsage(tables, { codeId: code.id })
    const ctx = buildCtx(em)

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, ctx)
    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, ctx)

    const usageRows = tables.get(PromotionUsage) ?? []
    const codeUsageRows = tables.get(CodeUsage) ?? []
    expect(usageRows.filter((row) => row.revertedAt === null)).toHaveLength(1)
    expect(codeUsageRows.filter((row) => row.revertedAt === null)).toHaveLength(1)
    // The re-increment itself must only ever apply once, not once per delivery.
    expect(code.used).toBe(1)
  })

  it('is a no-op when the uncancelled order has no reverted usage', async () => {
    const { em } = createFakeEm()

    await expect(
      handle({ orderId: 'order-without-usage', tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em)),
    ).resolves.toBeUndefined()
  })

  it('skips an incomplete payload without throwing', async () => {
    const { em } = createFakeEm()
    await expect(handle({ orderId: ORDER_ID, previousStatus: 'canceled' }, buildCtx(em))).resolves.toBeUndefined()
  })

  it('never reinstates another tenant\'s usage, even on an orderId collision', async () => {
    const { em, tables } = createFakeEm()
    const otherTenantPromotionUsage = seedPromotionUsage(tables, { tenantId: 'tenant-2', organizationId: 'org-2' })
    const code = seedCode(tables, { used: 0, active: true, tenantId: 'tenant-2', organizationId: 'org-2' })
    const otherTenantCodeUsage = seedCodeUsage(tables, { codeId: code.id, tenantId: 'tenant-2', organizationId: 'org-2' })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em))

    expect(otherTenantPromotionUsage.revertedAt).not.toBeNull()
    expect(otherTenantCodeUsage.revertedAt).not.toBeNull()
    expect(code.used).toBe(0)
  })

  it('#8268 review Major 3: does not reinstate usage when a delayed confirmation is delivered after the order was cancelled again', async () => {
    const { em, tables } = createFakeEm({ orderStatus: 'canceled' })
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables, { used: 0, active: true })
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em))

    expect(promotionUsage.revertedAt).not.toBeNull()
    expect(codeUsage.revertedAt).not.toBeNull()
    expect(code.used).toBe(0)
  })

  it('#8268 review Major 3: does not reinstate usage for a delayed confirmation once the order no longer exists', async () => {
    const { em, tables } = createFakeEm({ orderStatus: null })
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables, { used: 0, active: true })
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em))

    expect(promotionUsage.revertedAt).not.toBeNull()
    expect(codeUsage.revertedAt).not.toBeNull()
    expect(code.used).toBe(0)
  })
})
