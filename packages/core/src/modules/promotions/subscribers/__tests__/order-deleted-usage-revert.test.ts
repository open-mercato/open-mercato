// #8406: deleting an order that redeemed a promotion/single-use code left the usage
// registered forever — nothing subscribed to `sales.order.deleted` to revert it. This
// subscriber reuses `order-cancelled-usage-revert.ts`'s exact revert logic; this file
// proves it fires correctly off the `sales.order.deleted` event, same shape as the
// sibling's own test for `sales.order.cancelled`.

import { randomUUID } from 'crypto'
import handle, { metadata } from '../order-deleted-usage-revert'
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
  getConnection: () => { execute: (sql: string, params?: unknown[]) => Promise<Row[]> }
}

// Sentinel table standing in for `sales_orders` — the deleted-event guard runs a raw SQL
// existence check against it (never imports the `sales` entity). Empty by default (order
// genuinely deleted); tests that simulate "the order was restored by undo" push a row in.
function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]>; salesOrders: Row[] } {
  const tables = new Map<Function, Row[]>()
  const salesOrders: Row[] = []
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
    getConnection: () => ({
      execute: async (sql: string) => {
        if (sql.includes('from sales_orders')) return salesOrders
        return []
      },
    }),
  }
  return { em, tables, salesOrders }
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

describe('promotions order-deleted-usage-revert subscriber', () => {
  it('declares itself on sales.order.deleted', () => {
    expect(metadata.event).toBe('sales.order.deleted')
  })

  it('reverts both the promotion usage ledger and the code usage for the deleted order', async () => {
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

  it('is idempotent on redelivery — a second deletion event reverts nothing further', async () => {
    const { em, tables } = createFakeEm()
    seedPromotionUsage(tables)
    const code = seedCode(tables)
    seedCodeUsage(tables, { codeId: code.id })
    const ctx = buildCtx(em)

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)
    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)

    expect(code.used).toBe(0)
  })

  it('is a no-op when the deleted order has no usage to revert', async () => {
    const { em } = createFakeEm()

    await expect(
      handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em)),
    ).resolves.toBeUndefined()
  })

  it('#8268 review Major 2: skips a stale redelivery once the order has been restored by undo', async () => {
    const { em, tables, salesOrders } = createFakeEm()
    const promotionUsage = seedPromotionUsage(tables)
    const code = seedCode(tables)
    const codeUsage = seedCodeUsage(tables, { codeId: code.id })
    // Simulate undo-of-delete: the order row exists again (re-created by
    // `restoreOrderGraph`, which re-emits `sales.order.confirmed` so the reinstate
    // subscribers already re-registered this usage) by the time this persistent
    // `sales.order.deleted` event is redelivered.
    salesOrders.push({ id: ORDER_ID, tenantId: TENANT, organizationId: ORG })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    expect(promotionUsage.revertedAt).toBeNull()
    expect(codeUsage.revertedAt).toBeNull()
    expect(code.used).toBe(1)
  })
})
