// Release 5 C5/SPEC-055 amendment (Step 1.9) — `sales.order.cancelled` -> reverse both
// halves of what checkout's future submit sequence will have recorded for the order:
// the promotion-budget ledger (`PromotionUsageService.revertUsage`, existing) and the
// code-usage/redemption-counter state (`PromotionCodeService.revertCodeUse`, additive
// this Step). Runs against the same hand-built, in-memory fake `EntityManager` as
// `lib/__tests__/code-service.test.ts` (no real database), exercising the REAL services
// end to end, not a mocked assertion — same spirit as
// `customer_groups/subscribers/__tests__/order-cancelled-credit-release.test.ts`.

import { randomUUID } from 'crypto'
import handle from '../order-cancelled-usage-revert'
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

// #8268 review Major 3: the subscriber now fences on the order's CURRENT status (a raw
// `select status from sales_orders ...`) before reverting, so a stale/redelivered
// cancellation does not undo a later revival. Defaults to `'canceled'` so every
// pre-existing test below — written when the order's live status was never queried —
// keeps exercising the "order really is cancelled" path unchanged; only the new
// stale-redelivery tests override it.
function createFakeEm(options: { orderStatus?: string | null } = {}): { em: FakeEm; tables: Map<Function, Row[]> } {
  const orderStatus = options.orderStatus === undefined ? 'canceled' : options.orderStatus
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
    revertedAt: null,
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
    used: 1,
    active: false,
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
    revertedAt: null,
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

describe('promotions order-cancelled-usage-revert subscriber', () => {
  it('reverts both the promotion usage ledger and the code usage for the cancelled order', async () => {
    const { em, tables } = createFakeEm()
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables)
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    expect(promotionUsage.revertedAt).not.toBeNull()
    expect(codeUsage.revertedAt).not.toBeNull()
    expect(code.used).toBe(0)
    expect(code.active).toBe(true)
  })

  it('is idempotent on redelivery — a second cancellation event reverts nothing further', async () => {
    const { em, tables } = createFakeEm()
    seedPromotionUsage(tables)
    const code = seedCode(tables)
    seedCodeUsage(tables, { codeId: code.id })
    const ctx = buildCtx(em)

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)
    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)

    const usageRows = tables.get(PromotionUsage) ?? []
    const codeUsageRows = tables.get(CodeUsage) ?? []
    expect(usageRows.filter((row) => row.revertedAt !== null)).toHaveLength(1)
    expect(codeUsageRows.filter((row) => row.revertedAt !== null)).toHaveLength(1)
    // The decrement itself must only ever apply once, not once per delivery.
    expect(code.used).toBe(0)
  })

  it('is a no-op when the cancelled order has no recorded usage', async () => {
    const { em } = createFakeEm()

    await expect(
      handle({ orderId: 'order-without-usage', tenantId: TENANT, organizationId: ORG }, buildCtx(em)),
    ).resolves.toBeUndefined()
  })

  it('skips an incomplete payload without throwing', async () => {
    const { em } = createFakeEm()
    await expect(handle({ orderId: ORDER_ID }, buildCtx(em))).resolves.toBeUndefined()
  })

  it('never reverts another tenant\'s usage, even on an orderId collision', async () => {
    const { em, tables } = createFakeEm()
    const otherTenantPromotionUsage = seedPromotionUsage(tables, { tenantId: 'tenant-2', organizationId: 'org-2' })
    const code = seedCode(tables)
    const otherTenantCodeUsage = seedCodeUsage(tables, { codeId: code.id, tenantId: 'tenant-2', organizationId: 'org-2' })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    expect(otherTenantPromotionUsage.revertedAt).toBeNull()
    expect(otherTenantCodeUsage.revertedAt).toBeNull()
    expect(code.used).toBe(1)
    expect(code.active).toBe(false)
  })

  it('#8268 review Major 3: does not revert usage when a delayed cancellation is delivered after the order was revived', async () => {
    const { em, tables } = createFakeEm({ orderStatus: 'confirmed' })
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables)
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    expect(promotionUsage.revertedAt).toBeNull()
    expect(codeUsage.revertedAt).toBeNull()
  })

  it('#8268 review Major 3: does not revert usage for a delayed cancellation once the order no longer exists', async () => {
    const { em, tables } = createFakeEm({ orderStatus: null })
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables)
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    expect(promotionUsage.revertedAt).toBeNull()
    expect(codeUsage.revertedAt).toBeNull()
  })

  it('#8268 review Major 3 (re-review): treats the \'cancelled\' spelling the same as \'canceled\' when checking for a stale/live order', async () => {
    const { em, tables } = createFakeEm({ orderStatus: 'cancelled' })
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables)
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    expect(promotionUsage.revertedAt).not.toBeNull()
    expect(codeUsage.revertedAt).not.toBeNull()
    expect(code.used).toBe(0)
    expect(code.active).toBe(true)
  })
})
