// #8268 review Major 3 / #8817: `sales.order.confirmed` on an uncancel transition must
// reinstate BOTH halves `order-cancelled-usage-revert.ts` reverted on `sales.order.
// cancelled` — the promotion-budget ledger (`PromotionUsageService.reinstateUsage`) and
// the code-usage/redemption counter (`PromotionCodeService.reinstateCodeUse`). Runs
// against the same hand-built, in-memory fake `EntityManager` as the revert subscriber's
// own test (no real database), exercising the REAL services end to end.

import { randomUUID } from 'crypto'
import handle from '../order-confirmed-usage-reinstate'
import { Code, CodeUsage, GeneratedCode } from '../../data/entities'
import { Promotion, PromotionUsage } from '../../data/entities'
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
  getKysely: () => { selectFrom: (table: string) => unknown }
  transactional: <T>(cb: (tx: FakeEm) => Promise<T>) => Promise<T>
}

// #8268 review Major 3 (re-review): the subscriber now fences on the order's CURRENT
// status (a raw `select status from sales_orders ...`) before reinstating, so a
// stale/redelivered confirmation does not reinstate usage for an order that was
// cancelled again (or deleted) afterward. Defaults to `'confirmed'` so every
// pre-existing test below — written when the order's live status was never queried —
// keeps exercising the "order really is live" path unchanged; only the new
// stale-redelivery tests override it.
type FakeEmControl = {
  setOrderStatus: (status: string | null) => void
  executed: Array<{ sql: string; params: unknown[] }>
}

function createFakeEm(options: { orderStatus?: string | null } = {}): { em: FakeEm; tables: Map<Function, Row[]>; control: FakeEmControl } {
  let orderStatus = options.orderStatus === undefined ? 'confirmed' : options.orderStatus
  const executed: FakeEmControl['executed'] = []
  const statusRows = (): Row[] => (orderStatus == null ? [] : [{ status: orderStatus }])
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
    execute: async (sql, params = []) => {
      executed.push({ sql, params })
      return sql.includes('from sales_orders') ? statusRows() : []
    },
    getConnection: () => ({
      execute: async () => statusRows(),
    }),
    // #8268 review Major 4: the enforced refusal policy resolves the 'canceled' dictionary
    // entry through this exact `dictionary_entries`/`dictionaries` join
    // (`resolveCanceledStatusEntryId`) before re-cancelling an order whose revival got
    // blocked — a minimal stand-in good enough for that one lookup, not a general Kysely fake.
    getKysely: () => ({
      selectFrom: (table: string) => {
        const builder = {
          innerJoin: () => builder,
          select: () => builder,
          where: () => builder,
          executeTakeFirst: async () => (table === 'dictionary_entries' ? { id: 'status-canceled' } : undefined),
        }
        return builder
      },
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
  return {
    em,
    tables,
    control: {
      setOrderStatus: (status) => {
        orderStatus = status
      },
      executed,
    },
  }
}

type CancelCommandOptions = { input?: unknown; ctx?: { beforeTransactionalWrite?: (em: unknown, input?: unknown) => Promise<void> } }

function simulateSalesOrderUpdate(em: FakeEm, hooks: { beforeFence?: () => void; onCommit?: () => void } = {}): jest.Mock {
  return jest.fn(async (_commandId: string, options: CancelCommandOptions) => {
    hooks.beforeFence?.()
    await options.ctx?.beforeTransactionalWrite?.(em, options.input)
    hooks.onCommit?.()
    return { result: {} }
  })
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

function seedPromotion(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}): Row {
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
  const rows = tables.get(Promotion) ?? []
  rows.push(row)
  tables.set(Promotion, rows)
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

function buildCtx(em: FakeEm, options: { commandBusExecute?: jest.Mock } = {}) {
  const codeService = new PromotionCodeService({
    resolve: () => {
      throw new Error('[internal] unexpected DI resolve in test: rateLimiterService')
    },
  })
  const usageService = new PromotionUsageService()
  // #8268 review Major 4: the enforced refusal policy resolves `commandBus` to re-cancel
  // the order when a revival gets blocked — defaults to a mock that succeeds, so every
  // pre-existing test below (none of which trigger a blocked revival) never needs it.
  const commandBus = { execute: options.commandBusExecute ?? simulateSalesOrderUpdate(em) }
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return asEm(em) as unknown as T
      if (name === 'promotionCodeService') return codeService as unknown as T
      if (name === 'promotionUsageService') return usageService as unknown as T
      if (name === 'commandBus') return commandBus as unknown as T
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

  it('does not re-cancel the order when every reinstatement succeeds', async () => {
    const { em, tables } = createFakeEm()
    seedPromotionUsage(tables)
    const code = seedCode(tables, { used: 0, active: true })
    seedCodeUsage(tables, { codeId: code.id })
    const commandBusExecute = jest.fn(async () => ({ result: {} }))

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

    expect(commandBusExecute).not.toHaveBeenCalled()
  })

  // #8268 review Major 4: cancel A (frees the promotion's budget), B spends it, then
  // revive A — reinstating A's usage is correctly refused (the budget is already
  // consumed), but a confirmed order A must not be left carrying its original discount
  // with no usage backing it anywhere. The enforced refusal policy re-cancels A instead.
  it('#8268 review Major 4: re-cancels the order when a promotion budget reinstatement is refused', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, { maxBudget: '10.00', budgetCurrency: 'USD' })
    seedPromotionUsage(tables, {
      promotionId: promotion.id,
      totalDiscountAmount: '10.00',
      currency: 'USD',
      orderId: 'order-b',
      revertedAt: null,
    })
    const promotionUsageA = seedPromotionUsage(tables, {
      promotionId: promotion.id,
      totalDiscountAmount: '10.00',
      currency: 'USD',
    })
    const commandBusExecute = jest.fn(async () => ({ result: {} }))

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

    // The refusal left the ledger exactly where it was — never silently reinstated.
    expect(promotionUsageA.revertedAt).not.toBeNull()
    expect(commandBusExecute).toHaveBeenCalledWith('sales.orders.update', expect.objectContaining({
      input: { id: ORDER_ID, statusEntryId: 'status-canceled' },
    }))
  })

  // #8268 review Major 4: same policy, the code-usage half (`reinstateCodeUse`'s own
  // "cancel A, redeem on B, revive A" cap-overflow refusal).
  it('#8268 review Major 4: re-cancels the order when a code-usage reinstatement is refused', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'USEDONCE', usage: 'single', used: 1, active: false })
    const usageA = seedCodeUsage(tables, { codeId: code.id, orderId: ORDER_ID })
    // B's live (never-reverted) use is what brought `used` back up to the cap.
    seedCodeUsage(tables, { codeId: code.id, orderId: 'order-b', revertedAt: null })
    const commandBusExecute = jest.fn(async () => ({ result: {} }))

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

    expect(usageA.revertedAt).not.toBeNull()
    expect(commandBusExecute).toHaveBeenCalledWith('sales.orders.update', expect.objectContaining({
      input: { id: ORDER_ID, statusEntryId: 'status-canceled' },
    }))
  })

  it('#8268 review Major 4: propagates a failure to enforce the refusal policy so the queue retries', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, { maxBudget: '10.00', budgetCurrency: 'USD' })
    seedPromotionUsage(tables, { promotionId: promotion.id, totalDiscountAmount: '10.00', currency: 'USD', orderId: 'order-b', revertedAt: null })
    seedPromotionUsage(tables, { promotionId: promotion.id, totalDiscountAmount: '10.00', currency: 'USD' })
    const commandBusExecute = jest.fn(async () => { throw new Error('sales.orders.update unavailable') })

    await expect(
      handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute })),
    ).rejects.toThrow('sales.orders.update unavailable')
  })

  describe('#8268 re-review Finding 2: the cancel re-validates the refusal inside its own transaction', () => {
    function seedBlockedRevival(tables: Map<Function, Row[]>) {
      const promotion = seedPromotion(tables, { maxBudget: '10.00', budgetCurrency: 'USD' })
      const blockingUsage = seedPromotionUsage(tables, {
        promotionId: promotion.id,
        totalDiscountAmount: '10.00',
        currency: 'USD',
        orderId: 'order-b',
        revertedAt: null,
      })
      const usageA = seedPromotionUsage(tables, {
        promotionId: promotion.id,
        totalDiscountAmount: '10.00',
        currency: 'USD',
      })
      return { blockingUsage, usageA }
    }

    it('aborts the cancel when a concurrent handler reinstated the order after the last blocked check', async () => {
      const { em, tables } = createFakeEm()
      const { blockingUsage, usageA } = seedBlockedRevival(tables)
      let cancelCommitted = false
      const commandBusExecute = simulateSalesOrderUpdate(em, {
        beforeFence: () => {
          blockingUsage.revertedAt = new Date()
          usageA.revertedAt = null
        },
        onCommit: () => {
          cancelCommitted = true
        },
      })

      await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

      expect(commandBusExecute).toHaveBeenCalledTimes(1)
      expect(cancelCommitted).toBe(false)
      expect(usageA.revertedAt).toBeNull()
    })

    it('aborts the cancel when a concurrent handler reinstated the order\'s code usage', async () => {
      const { em, tables } = createFakeEm()
      const code = seedCode(tables, { code: 'USEDONCE', usage: 'single', used: 1, active: false })
      const usageA = seedCodeUsage(tables, { codeId: code.id, orderId: ORDER_ID })
      seedCodeUsage(tables, { codeId: code.id, orderId: 'order-b', revertedAt: null })
      let cancelCommitted = false
      const commandBusExecute = simulateSalesOrderUpdate(em, {
        beforeFence: () => {
          usageA.revertedAt = null
        },
        onCommit: () => {
          cancelCommitted = true
        },
      })

      await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

      expect(cancelCommitted).toBe(false)
    })

    it('aborts the cancel when the order lifecycle moved on after the refusal decision', async () => {
      const { em, tables, control } = createFakeEm()
      seedBlockedRevival(tables)
      let cancelCommitted = false
      const commandBusExecute = simulateSalesOrderUpdate(em, {
        beforeFence: () => control.setOrderStatus('on_hold'),
        onCommit: () => {
          cancelCommitted = true
        },
      })

      await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

      expect(cancelCommitted).toBe(false)
    })

    it('takes the lifecycle lock inside the cancel transaction before validating anything', async () => {
      const { em, tables, control } = createFakeEm()
      seedBlockedRevival(tables)
      let executedBeforeFence = 0
      const commandBusExecute = simulateSalesOrderUpdate(em, {
        beforeFence: () => {
          executedBeforeFence = control.executed.length
        },
      })

      await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

      const fenceStatements = control.executed.slice(executedBeforeFence)
      expect(fenceStatements[0]?.sql).toContain('pg_advisory_xact_lock')
      expect(fenceStatements[0]?.params).toEqual([`promotions_usage_lifecycle:${ORDER_ID}`])
      expect(fenceStatements[1]?.sql).toContain('from sales_orders')
    })

    it('control: commits the cancel when the order is still live and still carries unreconciled usage', async () => {
      const { em, tables } = createFakeEm()
      const { usageA } = seedBlockedRevival(tables)
      let cancelCommitted = false
      const commandBusExecute = simulateSalesOrderUpdate(em, {
        onCommit: () => {
          cancelCommitted = true
        },
      })

      await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, buildCtx(em, { commandBusExecute }))

      expect(cancelCommitted).toBe(true)
      expect(usageA.revertedAt).not.toBeNull()
      expect(commandBusExecute).toHaveBeenCalledWith('sales.orders.update', expect.objectContaining({
        input: { id: ORDER_ID, statusEntryId: 'status-canceled' },
      }))
    })

    it('runs the blocked check exactly once before cancelling', async () => {
      const { em, tables } = createFakeEm()
      seedBlockedRevival(tables)
      const codeService = new PromotionCodeService({
        resolve: () => {
          throw new Error('[internal] unexpected DI resolve in test: rateLimiterService')
        },
      })
      const usageService = new PromotionUsageService()
      const reinstateSpy = jest.spyOn(usageService, 'reinstateUsage')
      const commandBus = { execute: simulateSalesOrderUpdate(em) }
      const ctx = {
        resolve: <T = unknown>(name: string): T => {
          if (name === 'em') return asEm(em) as unknown as T
          if (name === 'promotionCodeService') return codeService as unknown as T
          if (name === 'promotionUsageService') return usageService as unknown as T
          if (name === 'commandBus') return commandBus as unknown as T
          throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
        },
      }

      await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' }, ctx)

      expect(reinstateSpy).toHaveBeenCalledTimes(1)
      expect(commandBus.execute).toHaveBeenCalledTimes(1)
    })
  })

  // #8268 review Finding 7: a missing `sales.order_status` "canceled" dictionary entry
  // used to be acknowledged (handler returned successfully) while the order stayed
  // CONFIRMED with refused/reverted usage and no way to retry the cancel. The handler is
  // `persistent: true`, so it must instead throw and let the dispatcher redeliver —
  // repairing the missing config and retrying must then succeed.
  describe('#8268 review Finding 7: missing cancellation configuration rejects for retry', () => {
    function buildCtxWithDictionary(em: FakeEm, hasDictionaryEntry: boolean, options: { commandBusExecute?: jest.Mock } = {}) {
      const base = buildCtx(em, options)
      const patchedEm: FakeEm = {
        ...em,
        getKysely: () => ({
          selectFrom: (table: string) => {
            const builder = {
              innerJoin: () => builder,
              select: () => builder,
              where: () => builder,
              executeTakeFirst: async () => (table === 'dictionary_entries' && hasDictionaryEntry ? { id: 'status-canceled' } : undefined),
            }
            return builder
          },
        }),
        fork: () => patchedEm,
      }
      return {
        resolve: <T = unknown>(name: string): T => {
          if (name === 'em') return patchedEm as unknown as T
          return base.resolve<T>(name)
        },
      }
    }

    it('rejects instead of resolving when no dictionary entry exists', async () => {
      const { em, tables } = createFakeEm()
      const promotion = seedPromotion(tables, { maxBudget: '10.00', budgetCurrency: 'USD' })
      seedPromotionUsage(tables, { promotionId: promotion.id, totalDiscountAmount: '10.00', currency: 'USD', orderId: 'order-b', revertedAt: null })
      const promotionUsageA = seedPromotionUsage(tables, { promotionId: promotion.id, totalDiscountAmount: '10.00', currency: 'USD' })
      const commandBusExecute = jest.fn(async () => ({ result: {} }))

      await expect(
        handle(
          { orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' },
          buildCtxWithDictionary(em, false, { commandBusExecute }),
        ),
      ).rejects.toThrow()

      // Never cancelled — the ledger stays exactly where the refusal left it, pending retry.
      expect(promotionUsageA.revertedAt).not.toBeNull()
      expect(commandBusExecute).not.toHaveBeenCalled()
    })

    it('succeeds on retry once the dictionary entry is repaired', async () => {
      const { em, tables } = createFakeEm()
      const promotion = seedPromotion(tables, { maxBudget: '10.00', budgetCurrency: 'USD' })
      seedPromotionUsage(tables, { promotionId: promotion.id, totalDiscountAmount: '10.00', currency: 'USD', orderId: 'order-b', revertedAt: null })
      const promotionUsageA = seedPromotionUsage(tables, { promotionId: promotion.id, totalDiscountAmount: '10.00', currency: 'USD' })
      const commandBusExecute = jest.fn(async () => ({ result: {} }))

      await expect(
        handle(
          { orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' },
          buildCtxWithDictionary(em, false, { commandBusExecute }),
        ),
      ).rejects.toThrow()
      expect(commandBusExecute).not.toHaveBeenCalled()

      // Operator repairs the dictionary; the redelivered event now resolves the entry and
      // the cancel goes through.
      await handle(
        { orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG, previousStatus: 'canceled' },
        buildCtxWithDictionary(em, true, { commandBusExecute }),
      )

      expect(promotionUsageA.revertedAt).not.toBeNull()
      expect(commandBusExecute).toHaveBeenCalledWith('sales.orders.update', expect.objectContaining({
        input: { id: ORDER_ID, statusEntryId: 'status-canceled' },
      }))
    })
  })

  // #8268 review Finding 8: the notification body must not assert a completed cancellation
  // outcome at the moment it is emitted (during reinstatement, before the later cancel
  // command even runs and can itself fail-and-retry per Finding 7, or — per Finding 6 — may
  // turn out not to be needed at all).
  it('#8268 review Finding 8: the blocked-reinstatement notification body no longer claims a completed cancellation', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require('../../i18n/en.json') as Record<string, string>
    const body = en['promotions.notifications.usageReinstateBlocked.body']
    expect(body).toBeDefined()
    expect(body).not.toContain('has been automatically returned to cancelled')
    expect(body).toContain('{orderId}')
  })
})
