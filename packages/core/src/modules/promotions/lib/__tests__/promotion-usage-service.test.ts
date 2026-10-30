// Step 6.3 — unit coverage for `lib/promotion-usage-service.ts` against a hand-built,
// in-memory fake `EntityManager` (same spirit as `code-service.test.ts`'s fake: no real
// database). `lockMode` is accepted and ignored by the fake's `findOne` — a genuine
// `SELECT ... FOR UPDATE` race across two real concurrent transactions needs a live
// Postgres connection this suite does not have (same documented limitation as Step 6.2's
// own `useCode` coverage). R-H2's "N concurrent registerUsage calls never jointly exceed
// max_budget" guarantee is instead proven at the logic level: SEQUENTIAL calls sharing the
// same fake tables, where the second call's re-read observes the first's committed total —
// exactly the decision the row lock exists to make correct under real concurrency.

import { randomUUID } from 'crypto'
import { Promotion, PromotionUsage } from '../../data/entities'
import type { AppliedPromotion, RegisterUsageInput, ResolvedEffect, RevertUsageInput } from '../types'
import { PromotionUsageService, type PromotionsUsageScope } from '../promotion-usage-service'

jest.mock('../../events', () => ({ emitPromotionsEvent: jest.fn(async () => {}) }))
const { emitPromotionsEvent } = require('../../events') as { emitPromotionsEvent: jest.Mock }

const TENANT = 'tenant-1'
const ORG = 'org-1'
const SCOPE: PromotionsUsageScope = { tenantId: TENANT, organizationId: ORG }

// ---------------------------------------------------------------------------
// Minimal in-memory fake EntityManager — just enough of the MikroORM surface
// `promotion-usage-service.ts` actually calls: findOne/find/create/persist/flush, plus
// begin/commit/rollback/isInTransaction/fork for `withAtomicFlush`'s transaction path.
// Rows are plain objects keyed by entity class reference.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition === null) return value === null || value === undefined
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
  flushImpl: (() => Promise<void>) | null
}

function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]> } {
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
    flushImpl: null,
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
      if (em.flushImpl) await em.flushImpl()
      for (const { entity, row } of toApply) {
        tableFor(entity).push(row)
      }
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
  }
  return { em, tables }
}

function asEm(fake: FakeEm): import('@mikro-orm/postgresql').EntityManager {
  return fake as unknown as import('@mikro-orm/postgresql').EntityManager
}

function seedPromotion(
  tables: Map<Function, Row[]>,
  overrides: Partial<{ id: string; maxBudget: string | null; budgetCurrency: string | null; deletedAt: Date | null }> = {},
): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Promo',
    order: 0,
    active: true,
    maxBudget: null,
    budgetCurrency: null,
    deletedAt: null,
    ...overrides,
  }
  let rows = tables.get(Promotion)
  if (!rows) {
    rows = []
    tables.set(Promotion, rows)
  }
  rows.push(row)
  return row
}

function lineDiscountEffect(amountNet: string): ResolvedEffect {
  return {
    type: 'LINE_DISCOUNT',
    appliesTo: 'line',
    currency: 'USD',
    label: {},
    targetLineId: 'line-1',
    targetProductId: 'product-1',
    targetVariantId: null,
    lineQuantity: 1,
    appliedQuantity: 1,
    amountNet,
    amountGross: amountNet,
    basis: 'net',
  }
}

// D-R5-17 (amends D-R4-14): a DELIVERY_DISCOUNT effect, used to prove `registerUsage`
// accounts for it exactly like any other amount-carrying effect type — nothing in this
// file excludes it from `computeTotalDiscountAmount`'s sum.
function deliveryDiscountEffect(amountNet: string): ResolvedEffect {
  return {
    type: 'DELIVERY_DISCOUNT',
    appliesTo: 'order',
    currency: 'USD',
    label: {},
    deliveryMethodCode: 'standard',
    amountNet,
    amountGross: amountNet,
    basis: 'net',
  }
}

function freeItemEffect(promotionId: string): ResolvedEffect {
  return {
    type: 'ADD_FREE_ITEM',
    appliesTo: 'order',
    currency: 'USD',
    label: {},
    productId: 'product-free',
    variantId: null,
    quantity: 1,
    reason: 'BUY_X_GET_Y',
    promotionId,
  }
}

function appliedPromotion(promotionId: string, effects: ResolvedEffect[]): AppliedPromotion {
  return { promotionId, promotionName: 'Promo', effects }
}

beforeEach(() => {
  emitPromotionsEvent.mockClear()
})

describe('PromotionUsageService.registerUsage', () => {
  it('writes a PromotionUsage row with total_discount_amount excluding ADD_FREE_ITEM and emits usage.registered', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    const input: RegisterUsageInput = {
      orderId: 'order-1',
      orderType: 'order',
      customerId: 'cust-1',
      currency: 'USD',
      appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-10.00'), freeItemEffect(promotion.id as string)])],
    }

    const result = await service.registerUsage(asEm(em), input, SCOPE)

    expect(result).toEqual({ ok: true, budgetExceeded: [] })
    const rows = tables.get(PromotionUsage) ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      promotionId: promotion.id,
      orderId: 'order-1',
      orderType: 'order',
      customerId: 'cust-1',
      currency: 'USD',
      totalDiscountAmount: '10.00',
    })
    expect(emitPromotionsEvent).toHaveBeenCalledWith(
      'promotions.usage.registered',
      expect.objectContaining({ promotionId: promotion.id, orderId: 'order-1', tenantId: TENANT, organizationId: ORG }),
      expect.anything(),
    )
  })

  it('is idempotent: a second register for the same (promotion, order) pair is a no-op success, not a double-write', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    const input: RegisterUsageInput = {
      orderId: 'order-1',
      orderType: 'order',
      customerId: null,
      currency: 'USD',
      appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-10.00')])],
    }

    const first = await service.registerUsage(asEm(em), input, SCOPE)
    emitPromotionsEvent.mockClear()
    const second = await service.registerUsage(asEm(em), input, SCOPE)

    expect(first).toEqual({ ok: true, budgetExceeded: [] })
    expect(second).toEqual({ ok: true, budgetExceeded: [] })
    expect(tables.get(PromotionUsage)).toHaveLength(1)
    expect(emitPromotionsEvent).not.toHaveBeenCalled()
  })

  it('recovers from a losing unique-constraint race by treating it as the same idempotent no-op', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    const input: RegisterUsageInput = {
      orderId: 'order-1',
      orderType: 'order',
      customerId: null,
      currency: 'USD',
      appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-5.00')])],
    }

    let winningRowId: string | null = null
    em.flushImpl = async () => {
      if (winningRowId === null) {
        winningRowId = randomUUID()
        const rows = tables.get(PromotionUsage) ?? []
        tables.set(PromotionUsage, rows)
        rows.push({
          id: winningRowId,
          organizationId: ORG,
          tenantId: TENANT,
          promotionId: promotion.id,
          orderId: 'order-1',
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          totalDiscountAmount: '5.00',
          effectsSnapshot: [],
          registeredAt: new Date(),
          revertedAt: null,
        })
        const err = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
        throw err
      }
    }

    const result = await service.registerUsage(asEm(em), input, SCOPE)

    expect(result).toEqual({ ok: true, budgetExceeded: [] })
    expect(tables.get(PromotionUsage)).toHaveLength(1)
  })

  it('blocks once the cumulative total would exceed max_budget, reports the promotionId, and emits budget_exhausted', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, { maxBudget: '15.00', budgetCurrency: 'USD' })
    const service = new PromotionUsageService()

    const first = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-10.00')])],
      },
      SCOPE,
    )
    expect(first).toEqual({ ok: true, budgetExceeded: [] })

    emitPromotionsEvent.mockClear()
    const second = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-2',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-10.00')])],
      },
      SCOPE,
    )

    expect(second).toEqual({ ok: true, budgetExceeded: [promotion.id] })
    // The blocked registration never wrote a PromotionUsage row for order-2.
    const rows = (tables.get(PromotionUsage) ?? []).filter((row) => row.orderId === 'order-2')
    expect(rows).toHaveLength(0)
    expect(emitPromotionsEvent).toHaveBeenCalledWith(
      'promotions.promotion.budget_exhausted',
      expect.objectContaining({ promotionId: promotion.id, orderId: 'order-2' }),
      expect.anything(),
    )
  })

  it('allows a registration that brings the cumulative total exactly to max_budget', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, { maxBudget: '10.00', budgetCurrency: 'USD' })
    const service = new PromotionUsageService()

    const result = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-10.00')])],
      },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, budgetExceeded: [] })
    expect(tables.get(PromotionUsage)).toHaveLength(1)
  })

  it('skips budget enforcement when the order currency differs from the promotion budget_currency', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, { maxBudget: '5.00', budgetCurrency: 'EUR' })
    const service = new PromotionUsageService()

    const result = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-100.00')])],
      },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, budgetExceeded: [] })
    expect(tables.get(PromotionUsage)).toHaveLength(1)
  })

  it('processes every promotion in appliedPromotions independently — one blocked does not stop another from writing', async () => {
    const { em, tables } = createFakeEm()
    const cappedPromotion = seedPromotion(tables, { maxBudget: '1.00', budgetCurrency: 'USD' })
    const uncappedPromotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    const result = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [
          appliedPromotion(cappedPromotion.id as string, [lineDiscountEffect('-10.00')]),
          appliedPromotion(uncappedPromotion.id as string, [lineDiscountEffect('-10.00')]),
        ],
      },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, budgetExceeded: [cappedPromotion.id] })
    const rows = tables.get(PromotionUsage) ?? []
    expect(rows.map((row) => row.promotionId)).toEqual([uncappedPromotion.id])
  })

  // D-R5-17/C5: budget registration must treat a delivery discount exactly like any
  // other discount type — no effect-type-specific exclusion anywhere in this service.
  it('counts a DELIVERY_DISCOUNT effect into total_discount_amount the same as any other amount-carrying effect', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    const result = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [deliveryDiscountEffect('-5.00')])],
      },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, budgetExceeded: [] })
    const rows = tables.get(PromotionUsage) ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ totalDiscountAmount: '5.00' })
  })

  it('blocks a DELIVERY_DISCOUNT-producing promotion once it would exceed max_budget, same as any other effect type', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, { maxBudget: '5.00', budgetCurrency: 'USD' })
    const service = new PromotionUsageService()

    const first = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [deliveryDiscountEffect('-5.00')])],
      },
      SCOPE,
    )
    expect(first).toEqual({ ok: true, budgetExceeded: [] })

    const second = await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-2',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [deliveryDiscountEffect('-1.00')])],
      },
      SCOPE,
    )
    expect(second).toEqual({ ok: true, budgetExceeded: [promotion.id] })
  })
})

describe('PromotionUsageService.revertUsage', () => {
  it('sets reverted_at on every matching row for the order and never deletes rows', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-10.00')])],
      },
      SCOPE,
    )
    emitPromotionsEvent.mockClear()

    const result = await service.revertUsage(asEm(em), { orderId: 'order-1' } as RevertUsageInput, SCOPE)

    expect(result).toEqual({ ok: true, revertedCount: 1 })
    const rows = tables.get(PromotionUsage) ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0].revertedAt).toBeInstanceOf(Date)
    expect(emitPromotionsEvent).toHaveBeenCalledWith(
      'promotions.usage.reverted',
      expect.objectContaining({ promotionId: promotion.id, orderId: 'order-1' }),
      expect.anything(),
    )
  })

  it('emits one promotions.usage.reverted per distinct promotion affected', async () => {
    const { em, tables } = createFakeEm()
    const promotionA = seedPromotion(tables)
    const promotionB = seedPromotion(tables)
    const service = new PromotionUsageService()

    await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [
          appliedPromotion(promotionA.id as string, [lineDiscountEffect('-5.00')]),
          appliedPromotion(promotionB.id as string, [lineDiscountEffect('-5.00')]),
        ],
      },
      SCOPE,
    )
    emitPromotionsEvent.mockClear()

    const result = await service.revertUsage(asEm(em), { orderId: 'order-1' } as RevertUsageInput, SCOPE)

    expect(result).toEqual({ ok: true, revertedCount: 2 })
    expect(emitPromotionsEvent).toHaveBeenCalledTimes(2)
  })

  it('is a no-op success when no matching non-reverted row exists', async () => {
    const { em } = createFakeEm()
    const service = new PromotionUsageService()

    const result = await service.revertUsage(asEm(em), { orderId: 'no-such-order' } as RevertUsageInput, SCOPE)

    expect(result).toEqual({ ok: true, revertedCount: 0 })
  })
})

describe('PromotionUsageService.getBudgetConsumed', () => {
  it('sums total_discount_amount for non-reverted rows only, in the requested currency', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-7.50')])],
      },
      SCOPE,
    )
    await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-2',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-2.50')])],
      },
      SCOPE,
    )

    const consumed = await service.getBudgetConsumed(asEm(em), promotion.id as string, ORG, TENANT, 'USD')
    expect(consumed).toBe('10.00')
  })

  it('excludes reverted rows from the sum', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables)
    const service = new PromotionUsageService()

    await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-7.50')])],
      },
      SCOPE,
    )
    await service.registerUsage(
      asEm(em),
      {
        orderId: 'order-2',
        orderType: 'order',
        customerId: null,
        currency: 'USD',
        appliedPromotions: [appliedPromotion(promotion.id as string, [lineDiscountEffect('-2.50')])],
      },
      SCOPE,
    )

    await service.revertUsage(asEm(em), { orderId: 'order-2' } as RevertUsageInput, SCOPE)

    const consumed = await service.getBudgetConsumed(asEm(em), promotion.id as string, ORG, TENANT, 'USD')
    expect(consumed).toBe('7.50')
  })
})
