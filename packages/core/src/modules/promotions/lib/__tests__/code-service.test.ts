// Step 6.2 — unit coverage for `lib/code-service.ts` against a hand-built, in-memory
// fake `EntityManager` (same spirit as `promotions-service.test.ts`'s fake container: no
// real database). `lockMode` is accepted and ignored by the fake's `findOne` — a genuine
// `SELECT ... FOR UPDATE` race across two real concurrent transactions needs a live
// Postgres connection this suite does not have (same documented limitation as other
// Release 4 steps that could not stand up a live stack, e.g. PLAN.md Step 5.1/5.5).
// `TC-PROM-022`'s "one succeeds" guarantee is instead proven at the logic level: two
// SEQUENTIAL `useCode` calls against a single-use code, sharing the same fake tables —
// the second call observes the first's committed exhaustion and is rejected, which is
// exactly the decision the row lock exists to make correct under real concurrency.

import { randomUUID } from 'crypto'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Code, CodeReservation, CodeUsage, GeneratedCode, type PromotionCodeType, type PromotionCodeUsageMode } from '../../data/entities'
import {
  CODE_INVALID_REASON,
  CODE_REQUIRES_IDENTIFIED_CUSTOMER_REASON,
  PromotionCodeService,
  resolveCodeByString,
  type PromotionCodeServiceContainer,
  type PromotionsCodeScope,
} from '../code-service'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const SCOPE: PromotionsCodeScope = { tenantId: TENANT, organizationId: ORG }

// ---------------------------------------------------------------------------
// Minimal in-memory fake EntityManager — just enough of the MikroORM surface
// `code-service.ts` actually calls: findOne/count/create/persist/flush/nativeDelete,
// plus begin/commit/rollback/isInTransaction/fork for `withAtomicFlush`'s transaction
// path. Rows are plain objects keyed by entity class reference.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Row
      if ('$ne' in cond) return value !== cond.$ne
      if ('$gt' in cond) {
        if (value instanceof Date && cond.$gt instanceof Date) return value.getTime() > cond.$gt.getTime()
        return (value as number) > (cond.$gt as number)
      }
      if ('$in' in cond) return Array.isArray(cond.$in) && (cond.$in as unknown[]).includes(value)
    }
    return value === condition
  })
}

type FakeEm = {
  findOne: (entity: Function, where: Row, options?: unknown) => Promise<Row | null>
  count: (entity: Function, where: Row) => Promise<number>
  create: (entity: Function, data: Row) => Row
  persist: (row: Row) => void
  flush: () => Promise<void>
  nativeDelete: (entity: Function, where: Row) => Promise<number>
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  isInTransaction: () => boolean
  fork: () => FakeEm
  flushCalls: number
  flushImpl: (() => Promise<void>) | null
}

function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]> } {
  const tables = new Map<Function, Row[]>()
  let inTransaction = false
  // Mirrors a real DB: `create()` stages the row, `flush()` is the actual INSERT attempt
  // — if it throws, the staged row never lands in the table (so a test can simulate a
  // concurrent writer's row winning the unique-constraint race during THIS flush call).
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
    flushCalls: 0,
    flushImpl: null,
    findOne: async (entity, where) => tableFor(entity).find((row) => matchesWhere(row, where)) ?? null,
    count: async (entity, where) => tableFor(entity).filter((row) => matchesWhere(row, where)).length,
    create: (entity, data) => {
      const row: Row = { id: randomUUID(), ...data }
      pendingCreates.push({ entity, row })
      return row
    },
    persist: () => {},
    flush: async () => {
      em.flushCalls += 1
      const toApply = pendingCreates
      pendingCreates = []
      if (em.flushImpl) await em.flushImpl()
      for (const { entity, row } of toApply) {
        tableFor(entity).push(row)
      }
    },
    nativeDelete: async (entity, where) => {
      const rows = tableFor(entity)
      const remaining = rows.filter((row) => !matchesWhere(row, where))
      const removed = rows.length - remaining.length
      rows.length = 0
      rows.push(...remaining)
      return removed
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

function seedCode(
  tables: Map<Function, Row[]>,
  overrides: Partial<{
    id: string
    code: string | null
    type: PromotionCodeType
    usage: PromotionCodeUsageMode
    usageAmount: number | null
    usagePerCustomer: number | null
    used: number
    active: boolean
    deletedAt: Date | null
  }> = {},
): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Test code',
    type: 'static',
    code: 'SAVE10',
    prefix: null,
    suffix: null,
    length: null,
    amount: null,
    generated: 0,
    used: 0,
    usage: 'unlimited',
    usageAmount: null,
    usagePerCustomer: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
  let rows = tables.get(Code)
  if (!rows) {
    rows = []
    tables.set(Code, rows)
  }
  rows.push(row)
  return row
}

function seedGeneratedCode(
  tables: Map<Function, Row[]>,
  overrides: Partial<{ id: string; codeId: string; code: string; active: boolean }>,
): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    code: 'DYNAMIC1',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
  let rows = tables.get(GeneratedCode)
  if (!rows) {
    rows = []
    tables.set(GeneratedCode, rows)
  }
  rows.push(row)
  return row
}

function seedCodeUsage(tables: Map<Function, Row[]>, overrides: Partial<{ codeId: string; customerId: string | null }>): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    customerId: null,
    usedAt: new Date(),
    ...overrides,
  }
  let rows = tables.get(CodeUsage)
  if (!rows) {
    rows = []
    tables.set(CodeUsage, rows)
  }
  rows.push(row)
  return row
}

function seedReservation(
  tables: Map<Function, Row[]>,
  overrides: Partial<{ codeId: string; cartId: string; customerId: string | null; expiresAt: Date }>,
): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    codeString: 'SAVE10',
    customerId: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  }
  let rows = tables.get(CodeReservation)
  if (!rows) {
    rows = []
    tables.set(CodeReservation, rows)
  }
  rows.push(row)
  return row
}

function fakeContainer(rateLimiter?: unknown): PromotionCodeServiceContainer {
  return {
    resolve: <T>(name: string): T => {
      if (name === 'rateLimiterService') {
        if (rateLimiter === undefined) throw new Error('[internal] not registered: rateLimiterService')
        return rateLimiter as T
      }
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
}

async function expectCrudError(promise: Promise<unknown>, status: number, error: string) {
  try {
    await promise
    throw new Error('expected promise to reject')
  } catch (err) {
    expect(isCrudHttpError(err)).toBe(true)
    expect(isCrudHttpError(err) && err.status).toBe(status)
    expect(isCrudHttpError(err) && err.body.error).toBe(error)
  }
}

describe('resolveCodeByString (QA F9 live repro)', () => {
  it('resolves a stored upper-cased static code when the presented string is lowercase', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SUMMER10' })

    const resolved = await resolveCodeByString(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      'summer10',
      SCOPE,
    )

    expect(resolved).not.toBeNull()
    expect(resolved?.type).toBe('static')
    expect(resolved?.code.id).toBe(code.id)
  })

  it('resolves a stored upper-cased GeneratedCode when the presented string is lowercase', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { type: 'dynamic', code: null })
    seedGeneratedCode(tables, { codeId: code.id, code: 'DYNAMIC-ABC', active: true })

    const resolved = await resolveCodeByString(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      'dynamic-abc',
      SCOPE,
    )

    expect(resolved).not.toBeNull()
    expect(resolved?.type).toBe('dynamic')
    expect(resolved?.code.id).toBe(code.id)
  })

  it('also tolerates untrimmed whitespace around the presented string', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SUMMER10' })

    const resolved = await resolveCodeByString(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      '  summer10  ',
      SCOPE,
    )

    expect(resolved?.code.id).toBe(code.id)
  })
})

describe('PromotionCodeService.reserveCode', () => {
  it('reserves a static code for an identified customer', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    const service = new PromotionCodeService(fakeContainer())

    const result = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1' },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, codeId: code.id, type: 'static' })
    expect(tables.get(CodeReservation)).toHaveLength(1)
    expect(tables.get(CodeReservation)![0]).toMatchObject({ codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
  })

  it('reserves a static code when the buyer presents a different casing than the stored code (QA F9 live repro)', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SUMMER10' })
    const service = new PromotionCodeService(fakeContainer())

    const result = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'summer10', cartId: 'cart-1', customerId: 'cust-1' },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, codeId: code.id, type: 'static' })
  })

  it('resolves a dynamic code via GeneratedCode (W5d dual-table namespace)', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { type: 'dynamic', code: null })
    seedGeneratedCode(tables, { codeId: code.id, code: 'DYNAMIC-ABC', active: true })
    const service = new PromotionCodeService(fakeContainer())

    const result = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'DYNAMIC-ABC', cartId: 'cart-1', customerId: null },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, codeId: code.id, type: 'dynamic' })
  })

  it('is idempotent per (code, cart): a second reserve extends the TTL instead of erroring or duplicating', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    const service = new PromotionCodeService(fakeContainer())

    const first = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1' },
      SCOPE,
    )
    const firstExpiry = (tables.get(CodeReservation)![0].expiresAt as Date).getTime()

    await new Promise((resolve) => setTimeout(resolve, 5))

    const second = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1' },
      SCOPE,
    )
    const secondExpiry = (tables.get(CodeReservation)![0].expiresAt as Date).getTime()

    expect(first).toEqual({ ok: true, codeId: code.id, type: 'static' })
    expect(second).toEqual({ ok: true, codeId: code.id, type: 'static' })
    expect(tables.get(CodeReservation)).toHaveLength(1)
    expect(secondExpiry).toBeGreaterThan(firstExpiry)
  })

  it('recovers from a losing unique-constraint race by extending the winning row instead of erroring', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    const service = new PromotionCodeService(fakeContainer())

    // Simulate two concurrent `reserve` calls for the same (code, cart): at the time of
    // THIS call's existence check no row exists yet, but by the time its own INSERT
    // attempts to flush, a concurrent request's row has already landed — the DB raises
    // the unique-constraint violation this call's own row never gets to commit.
    let winningId: string | null = null
    em.flushImpl = async () => {
      if (winningId === null) {
        winningId = seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' }).id as string
        const err = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
        throw err
      }
    }

    const result = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1' },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, codeId: code.id, type: 'static' })
    expect(tables.get(CodeReservation)).toHaveLength(1)
    expect(tables.get(CodeReservation)![0].id).toBe(winningId)
  })

  it('rejects with the standard code_invalid 422 when a losing race hits the per-customer unique index, instead of surfacing the raw DB error', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    const service = new PromotionCodeService(fakeContainer())

    // Two concurrent carts for the SAME customer: `evaluateCodeEligibility`'s pre-check
    // (count of other carts' active reservations) passes for both before either inserts —
    // the exact race the pre-check alone cannot close (review finding). THIS call's own
    // insert loses to the other cart's reservation landing first on
    // `promotion_code_reservations_code_customer_unique` (`code_id`, `customer_id`), a
    // DIFFERENT constraint than the `(code_id, cart_id)` idempotent-extend case above — so
    // re-querying by this call's own `cartId` finds nothing to "extend".
    em.flushImpl = async () => {
      seedReservation(tables, { codeId: code.id, cartId: 'other-cart', customerId: 'cust-1' })
      const err = Object.assign(
        new Error('duplicate key value violates unique constraint "promotion_code_reservations_code_customer_unique"'),
        { code: '23505', constraint: 'promotion_code_reservations_code_customer_unique' },
      )
      throw err
    }

    await expectCrudError(
      service.reserveCode(
        em as unknown as import('@mikro-orm/postgresql').EntityManager,
        { codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1' },
        SCOPE,
      ),
      422,
      CODE_INVALID_REASON,
    )
    // The losing cart never gets a reservation row of its own; only the winner's remains.
    expect(tables.get(CodeReservation)).toHaveLength(1)
    expect(tables.get(CodeReservation)![0].cartId).toBe('other-cart')
  })

  it('rejects a guest cart against a per-customer-limited code with the distinct named reason', async () => {
    const { em, tables } = createFakeEm()
    seedCode(tables, { code: 'LIMITED1', usagePerCustomer: 1 })
    const service = new PromotionCodeService(fakeContainer())

    await expectCrudError(
      service.reserveCode(
        em as unknown as import('@mikro-orm/postgresql').EntityManager,
        { codeString: 'LIMITED1', cartId: 'cart-1', customerId: null },
        SCOPE,
      ),
      422,
      CODE_REQUIRES_IDENTIFIED_CUSTOMER_REASON,
    )
  })

  it('counts a per-customer limit against CodeUsage rows plus every OTHER cart\'s active reservation (D-R4-8)', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'LIMITED1', usagePerCustomer: 2 })
    // One completed usage...
    seedCodeUsage(tables, { codeId: code.id, customerId: 'cust-1' })
    // ...and one still-active reservation held by a DIFFERENT cart for the same customer.
    seedReservation(tables, { codeId: code.id, cartId: 'other-cart', customerId: 'cust-1' })
    const service = new PromotionCodeService(fakeContainer())

    // Total count (1 usage + 1 other-cart reservation) == limit (2) -> rejected.
    await expectCrudError(
      service.reserveCode(
        em as unknown as import('@mikro-orm/postgresql').EntityManager,
        { codeString: 'LIMITED1', cartId: 'this-cart', customerId: 'cust-1' },
        SCOPE,
      ),
      422,
      CODE_INVALID_REASON,
    )
  })

  it('does not count the reserving cart\'s own existing reservation against its per-customer limit', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'LIMITED1', usagePerCustomer: 1 })
    // This cart already holds a reservation for this code — re-reserving (idempotent
    // extend) must not be blocked by counting its own held reservation against itself.
    seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
    const service = new PromotionCodeService(fakeContainer())

    const result = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'LIMITED1', cartId: 'cart-1', customerId: 'cust-1' },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, codeId: code.id, type: 'static' })
  })

  it.each([
    ['unknown code string', () => {}],
    ['an inactive static code', (tables: Map<Function, Row[]>) => seedCode(tables, { code: 'INACTIVE1', active: false })],
    [
      'an exhausted single-use static code',
      (tables: Map<Function, Row[]>) => seedCode(tables, { code: 'USEDONCE', usage: 'single', used: 1 }),
    ],
  ])('answers %s with the SAME uniform reason as every other "code does not work" case', async (_label, seed) => {
    const { em, tables } = createFakeEm()
    seed(tables)
    const service = new PromotionCodeService(fakeContainer())

    await expectCrudError(
      service.reserveCode(
        em as unknown as import('@mikro-orm/postgresql').EntityManager,
        { codeString: 'DOES-NOT-MATTER-FOR-UNKNOWN', cartId: 'cart-1', customerId: 'cust-1' },
        SCOPE,
      ),
      422,
      CODE_INVALID_REASON,
    )
  })
})

describe('PromotionCodeService.reserveCode — rate limiting', () => {
  it('fails closed (429) when the limiter is reachable and the budget is exhausted', async () => {
    const { em, tables } = createFakeEm()
    seedCode(tables, { code: 'SAVE10' })
    const limiter = { consume: async () => ({ allowed: false, remainingPoints: 0, msBeforeNext: 1000, consumedPoints: 21 }) }
    const service = new PromotionCodeService(fakeContainer(limiter))

    expect.assertions(2)
    try {
      await service.reserveCode(
        em as unknown as import('@mikro-orm/postgresql').EntityManager,
        { codeString: 'SAVE10', cartId: 'cart-1', customerId: null },
        SCOPE,
      )
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(429)
    }
  })

  it('fails open when no rate limiter is registered', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    const service = new PromotionCodeService(fakeContainer(undefined))

    const result = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'SAVE10', cartId: 'cart-1', customerId: null },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, codeId: code.id, type: 'static' })
  })

  it('fails open when the limiter throws', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    const limiter = { consume: async () => { throw new Error('backing store unreachable') } }
    const service = new PromotionCodeService(fakeContainer(limiter))

    const result = await service.reserveCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'SAVE10', cartId: 'cart-1', customerId: null },
      SCOPE,
    )

    expect(result).toEqual({ ok: true, codeId: code.id, type: 'static' })
  })
})

describe('PromotionCodeService.validateCode', () => {
  it('returns { valid: false, reason } without creating a reservation', async () => {
    const { em, tables } = createFakeEm()
    seedCode(tables, { code: 'INACTIVE1', active: false })
    const service = new PromotionCodeService(fakeContainer())

    const result = await service.validateCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'INACTIVE1', cartId: 'cart-1', customerId: null },
      SCOPE,
    )

    expect(result).toEqual({ valid: false, reason: CODE_INVALID_REASON })
    expect(tables.get(CodeReservation) ?? []).toHaveLength(0)
  })

  it('returns { valid: true } for an eligible code', async () => {
    const { em, tables } = createFakeEm()
    seedCode(tables, { code: 'SAVE10' })
    const service = new PromotionCodeService(fakeContainer())

    const result = await service.validateCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeString: 'SAVE10', cartId: 'cart-1', customerId: null },
      SCOPE,
    )

    expect(result).toEqual({ valid: true })
  })
})

describe('PromotionCodeService.extendReservation', () => {
  it('bumps expiresAt by the TTL from now', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    const reservation = seedReservation(tables, {
      codeId: code.id,
      cartId: 'cart-1',
      expiresAt: new Date(Date.now() - 1000),
    })
    const service = new PromotionCodeService(fakeContainer())

    await service.extendReservation(em as unknown as import('@mikro-orm/postgresql').EntityManager, code.id, 'cart-1', SCOPE)

    expect((reservation.expiresAt as Date).getTime()).toBeGreaterThan(Date.now())
  })

  it('is a documented no-op when no matching reservation exists', async () => {
    const { em } = createFakeEm()
    const service = new PromotionCodeService(fakeContainer())

    await expect(
      service.extendReservation(em as unknown as import('@mikro-orm/postgresql').EntityManager, 'no-such-code', 'cart-1', SCOPE),
    ).resolves.toBeUndefined()
  })
})

describe('PromotionCodeService.useCode', () => {
  it('increments Code.used and deactivates a static code once exhausted, writes CodeUsage, deletes the reservation', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'USEDONCE', usage: 'single', used: 0 })
    seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
    const service = new PromotionCodeService(fakeContainer())

    const result = await service.useCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeId: code.id, codeString: 'USEDONCE', cartId: 'cart-1', customerId: 'cust-1', type: 'static' },
      SCOPE,
    )

    expect(result).toEqual({ ok: true })
    expect(code.used).toBe(1)
    expect(code.active).toBe(false)
    expect(tables.get(CodeUsage)).toHaveLength(1)
    expect(tables.get(CodeUsage)![0]).toMatchObject({ codeId: code.id, customerId: 'cust-1' })
    expect(tables.get(CodeReservation)).toHaveLength(0)
  })

  it('increments Code.used but keeps a multi-use code active while headroom remains', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'MULTI5', usage: 'multiple', usageAmount: 5, used: 2 })
    seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
    const service = new PromotionCodeService(fakeContainer())

    await service.useCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeId: code.id, codeString: 'MULTI5', cartId: 'cart-1', customerId: 'cust-1', type: 'static' },
      SCOPE,
    )

    expect(code.used).toBe(3)
    expect(code.active).toBe(true)
  })

  it('deactivates the specific GeneratedCode for a dynamic code without touching Code.used', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { type: 'dynamic', code: null, used: 0 })
    const generatedCode = seedGeneratedCode(tables, { codeId: code.id, code: 'DYNAMIC-ABC', active: true })
    seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
    const service = new PromotionCodeService(fakeContainer())

    await service.useCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeId: code.id, codeString: 'DYNAMIC-ABC', cartId: 'cart-1', customerId: 'cust-1', type: 'dynamic' },
      SCOPE,
    )

    expect(generatedCode.active).toBe(false)
    expect(code.used).toBe(0)
  })

  it('deactivates the specific GeneratedCode when the presented codeString is a different casing (QA F9 — direct lookup bypassing resolveCodeByString)', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { type: 'dynamic', code: null, used: 0 })
    const generatedCode = seedGeneratedCode(tables, { codeId: code.id, code: 'DYNAMIC-ABC', active: true })
    seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
    const service = new PromotionCodeService(fakeContainer())

    await service.useCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeId: code.id, codeString: 'dynamic-abc', cartId: 'cart-1', customerId: 'cust-1', type: 'dynamic' },
      SCOPE,
    )

    expect(generatedCode.active).toBe(false)
  })

  it('rejects a second use of an already-exhausted single-use code (row-lock re-check proxy for TC-PROM-022)', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'USEDONCE', usage: 'single', used: 0 })
    seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
    seedReservation(tables, { codeId: code.id, cartId: 'cart-2', customerId: 'cust-2' })
    const service = new PromotionCodeService(fakeContainer())

    // First "transaction" wins.
    const first = await service.useCode(
      em as unknown as import('@mikro-orm/postgresql').EntityManager,
      { codeId: code.id, codeString: 'USEDONCE', cartId: 'cart-1', customerId: 'cust-1', type: 'static' },
      SCOPE,
    )
    expect(first).toEqual({ ok: true })

    // Second "transaction" re-reads under (the fake's no-op) lock and observes the first
    // committed exhaustion — the exact decision a real row lock makes safe under genuine
    // concurrency.
    await expectCrudError(
      service.useCode(
        em as unknown as import('@mikro-orm/postgresql').EntityManager,
        { codeId: code.id, codeString: 'USEDONCE', cartId: 'cart-2', customerId: 'cust-2', type: 'static' },
        SCOPE,
      ),
      422,
      CODE_INVALID_REASON,
    )
    // The loser's own reservation is untouched — it never got to the delete phase.
    expect(tables.get(CodeReservation)).toHaveLength(1)
    expect(tables.get(CodeReservation)![0].cartId).toBe('cart-2')
  })

  it('rejects an unknown codeId with the uniform reason', async () => {
    const { em } = createFakeEm()
    const service = new PromotionCodeService(fakeContainer())

    await expectCrudError(
      service.useCode(
        em as unknown as import('@mikro-orm/postgresql').EntityManager,
        { codeId: 'no-such-code', codeString: 'X', cartId: 'cart-1', customerId: null, type: 'static' },
        SCOPE,
      ),
      422,
      CODE_INVALID_REASON,
    )
  })
})

describe('PromotionCodeService.releaseCode', () => {
  it('deletes the reservation for its own (code, cart) pair only — never another cart\'s', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { code: 'SAVE10' })
    seedReservation(tables, { codeId: code.id, cartId: 'cart-1', customerId: 'cust-1' })
    const otherCartReservation = seedReservation(tables, { codeId: code.id, cartId: 'cart-2', customerId: 'cust-2' })
    const service = new PromotionCodeService(fakeContainer())

    await service.releaseCode(em as unknown as import('@mikro-orm/postgresql').EntityManager, code.id, 'cart-1', SCOPE)

    const remaining = tables.get(CodeReservation) ?? []
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(otherCartReservation.id)
  })

  it('is a no-op when no matching reservation exists', async () => {
    const { em } = createFakeEm()
    const service = new PromotionCodeService(fakeContainer())

    await expect(
      service.releaseCode(em as unknown as import('@mikro-orm/postgresql').EntityManager, 'no-such-code', 'cart-1', SCOPE),
    ).resolves.toBeUndefined()
  })
})
