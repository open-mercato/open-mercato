// Step 2.6 — orchestration coverage for `promotionsService.evaluate`/`.evaluateForProduct`
// against a fake DI container (same spirit as `services/__tests__/promotion-cache.test.ts`'s
// pure-function approach, one level up): no real database, no real catalog service — a
// hand-built `resolve(name)` surface returning fakes for `promotionCacheService`, `auth`
// and `em`. Proves wiring (tenant/org resolution, calling the cache service, batch
// category enrichment, calling the pure `evaluatePromotions`), not rule/benefit math
// (already covered by `rule-evaluators.test.ts`/`effect-resolvers.test.ts`).

import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PromotionsServiceImpl, type PromotionsServiceContainer } from '../promotions-service'
import type { BuyerContext, EvaluateInput, NormalizedPromotion } from '../types'

const TENANT = 'tenant-1'
const ORG = 'org-1'

function buyer(overrides: Partial<BuyerContext> = {}): BuyerContext {
  return { customerId: null, customerIds: [], customerGroupIds: [], ...overrides }
}

function promotion(overrides: Partial<NormalizedPromotion> = {}): NormalizedPromotion {
  return {
    id: 'promo-1',
    name: 'Test Promotion',
    order: 0,
    cumulative: true,
    tags: [],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    startsAt: null,
    endsAt: null,
    maxBudget: null,
    budgetCurrency: null,
    totalDiscountGranted: '0',
    rootGroup: { operator: 'and', rules: [], benefits: [], children: [] },
    ...overrides,
  }
}

// Same simplest-real-match pairing as `evaluation-engine.test.ts`'s own
// `matchingPromotion`: a `code` rule plus a `cart_discount` benefit — needs no cart items
// or category data, keeping fixtures focused on this file's own orchestration.
function codeMatchingPromotion(overrides: Partial<NormalizedPromotion> & { codeId: string }): NormalizedPromotion {
  const { codeId, ...rest } = overrides
  return promotion({
    rootGroup: {
      operator: 'and',
      rules: [{ type: 'code', config: { codeId } }],
      benefits: [
        {
          type: 'cart_discount',
          appliesTo: 'order',
          config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Code promo' } },
        },
      ],
      children: [],
    },
    ...rest,
  })
}

function categoryMatchingPromotion(overrides: Partial<NormalizedPromotion> & { categoryId: string }): NormalizedPromotion {
  const { categoryId, ...rest } = overrides
  return promotion({
    rootGroup: {
      operator: 'and',
      rules: [{ type: 'category', config: { operator: 'gte', categoryId, quantity: 1 } }],
      benefits: [
        {
          type: 'cart_discount',
          appliesTo: 'order',
          config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Category promo' } },
        },
      ],
      children: [],
    },
    ...rest,
  })
}

function evaluateInput(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    items: [],
    currency: 'USD',
    evaluatedAt: '2026-06-15T00:00:00.000Z',
    buyer: buyer(),
    customerOrderCount: null,
    cartWeight: null,
    codes: [],
    ...overrides,
  }
}

type FakePromotionCacheService = { getActivePromotions: (tenantId: string, organizationId: string) => Promise<NormalizedPromotion[]> }

function fakeCacheService(promotions: NormalizedPromotion[]): FakePromotionCacheService {
  return { getActivePromotions: async () => promotions }
}

// Minimal fake Kysely-shaped `db` driving the REAL `computeProductScopeKeys` (imported
// transitively by `promotions-service.ts`) — dispatches by which table a query targets,
// mirroring `catalog/lib/__tests__/productScopeKeys.test.ts`'s own `respondWith` helper,
// without pulling in that module's private test-only Kysely driver.
type CategoryRow = { product_id: string; category_id: string; ancestor_ids: unknown }
type TagRow = { product_id: string; tag_id: string }

function fakeDb(categoryRows: CategoryRow[], tagRows: TagRow[]): unknown {
  function builder(table: string): Record<string, unknown> {
    const isCategoryQuery = table.includes('catalog_product_category_assignments')
    const rows = isCategoryQuery ? categoryRows : tagRows
    const node: Record<string, unknown> = {
      innerJoin: () => node,
      select: () => node,
      where: () => node,
      execute: async () => rows,
    }
    return node
  }
  return { selectFrom: builder }
}

type FakeEm = {
  fork: () => FakeEm
  getKysely: <T>() => T
  findOne: (...args: unknown[]) => Promise<unknown>
}

function fakeEm(overrides: Partial<FakeEm> = {}): FakeEm {
  const em: FakeEm = {
    fork: () => em,
    getKysely: <T>() => fakeDb([], []) as T,
    findOne: async () => null,
    ...overrides,
  }
  return em
}

type FakeAuth = { tenantId?: string | null; orgId?: string | null } | null

type FakeCommandBus = { execute: (commandId: string, options: { input: unknown; ctx: unknown }) => Promise<{ result: unknown }> }
type FakePromotionCodeService = {
  extendReservation?: (...args: unknown[]) => Promise<void>
  validateCode?: (...args: unknown[]) => Promise<unknown>
}

function fakeContainer(options: {
  promotionCacheService: FakePromotionCacheService
  auth?: FakeAuth
  em?: FakeEm
  commandBus?: FakeCommandBus
  promotionCodeService?: FakePromotionCodeService
}): PromotionsServiceContainer {
  const { promotionCacheService, auth = { tenantId: TENANT, orgId: ORG }, em = fakeEm(), commandBus, promotionCodeService } = options
  return {
    resolve: <T>(name: string): T => {
      if (name === 'promotionCacheService') return promotionCacheService as unknown as T
      if (name === 'auth') return auth as unknown as T
      if (name === 'em') return em as unknown as T
      if (name === 'commandBus') {
        if (!commandBus) throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
        return commandBus as unknown as T
      }
      if (name === 'promotionCodeService') {
        if (!promotionCodeService) throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
        return promotionCodeService as unknown as T
      }
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
}

function fakeCommandBus(resultByCommandId: Record<string, unknown>): FakeCommandBus & { calls: Array<{ commandId: string; input: unknown }> } {
  const calls: Array<{ commandId: string; input: unknown }> = []
  return {
    calls,
    execute: async (commandId, options) => {
      calls.push({ commandId, input: options.input })
      return { result: resultByCommandId[commandId] }
    },
  }
}

describe('PromotionsServiceImpl.evaluate', () => {
  it('returns appliedPromotions for a promotion that genuinely matches', async () => {
    const promo = codeMatchingPromotion({ id: 'promo-code', codeId: 'code-a' })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([promo]) }))

    const result = await service.evaluate(evaluateInput({ codes: [{ id: 'code-a', type: 'static' }] }))

    expect(result.appliedPromotions).toHaveLength(1)
    expect(result.appliedPromotions[0]).toMatchObject({ promotionId: 'promo-code', promotionName: 'Test Promotion' })
    expect(result.appliedPromotions[0].effects).toEqual([
      { type: 'CART_DISCOUNT', appliesTo: 'order', currency: 'USD', label: { en: 'Code promo' }, amountNet: '0.00', amountGross: '0.00', basis: 'net' },
    ])
  })

  it('returns no appliedPromotions when nothing matches', async () => {
    const promo = codeMatchingPromotion({ id: 'promo-code', codeId: 'code-a' })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([promo]) }))

    const result = await service.evaluate(evaluateInput({ codes: [] }))

    expect(result.appliedPromotions).toEqual([])
  })

  // D-R5-17 (amends D-R4-14): proves this facade actually threads `deliveryMethodCode`/
  // `deliveryCost` through to the pure engine, not merely that the pure engine itself
  // supports them (covered by `evaluation-engine.test.ts`).
  it('threads deliveryMethodCode/deliveryCost through to a delivery_method rule + delivery_discount benefit', async () => {
    const promo = promotion({
      id: 'promo-delivery',
      rootGroup: {
        operator: 'and',
        rules: [{ type: 'delivery_method', config: { deliveryMethodCode: 'standard' } }],
        benefits: [
          {
            type: 'delivery_discount',
            appliesTo: 'order',
            config: { deliveryMethodCode: 'standard', discountType: 'percentage', value: '50', labels: { en: 'Free delivery' } },
          },
        ],
        children: [],
      },
    })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([promo]) }))

    const result = await service.evaluate(evaluateInput({ deliveryMethodCode: 'standard', deliveryCost: '10.00' }))

    expect(result.appliedPromotions).toHaveLength(1)
    expect(result.appliedPromotions[0].effects).toEqual([
      {
        type: 'DELIVERY_DISCOUNT',
        appliesTo: 'order',
        currency: 'USD',
        label: { en: 'Free delivery' },
        deliveryMethodCode: 'standard',
        amountNet: '-5.00',
        amountGross: '-5.00',
        basis: 'net',
      },
    ])
  })

  // Regression guard: this facade's existing cart caller omits delivery context entirely —
  // proves the same promotion tree above never matches when `evaluate()` is called the
  // way cart already calls it today.
  it('a delivery_method rule never matches when the caller omits delivery context (cart-stage regression guard)', async () => {
    const promo = promotion({
      id: 'promo-delivery',
      rootGroup: {
        operator: 'and',
        rules: [{ type: 'delivery_method', config: { deliveryMethodCode: 'standard' } }],
        benefits: [
          {
            type: 'delivery_discount',
            appliesTo: 'order',
            config: { deliveryMethodCode: 'standard', discountType: 'percentage', value: '50', labels: { en: 'Free delivery' } },
          },
        ],
        children: [],
      },
    })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([promo]) }))

    const result = await service.evaluate(evaluateInput())

    expect(result.appliedPromotions).toEqual([])
  })

  it('batch-resolves category membership and passes it through to a `category` rule', async () => {
    const promo = categoryMatchingPromotion({ id: 'promo-cat', categoryId: 'cat-1' })
    const em = fakeEm({
      getKysely: <T>() =>
        fakeDb(
          [{ product_id: 'prod-1', category_id: 'cat-1', ancestor_ids: [] }],
          [],
        ) as T,
    })
    const service = new PromotionsServiceImpl(
      fakeContainer({ promotionCacheService: fakeCacheService([promo]), em }),
    )

    const result = await service.evaluate(
      evaluateInput({
        items: [
          {
            lineId: 'line-1',
            productId: 'prod-1',
            variantId: null,
            quantity: '2',
            unitPriceNet: '10.00',
            unitPriceGross: '12.30',
            priceIsPromotional: false,
          },
        ],
      }),
    )

    expect(result.appliedPromotions.map((applied) => applied.promotionId)).toEqual(['promo-cat'])
  })

  it('does not match a `category` rule when the resolved category set excludes it', async () => {
    const promo = categoryMatchingPromotion({ id: 'promo-cat', categoryId: 'cat-1' })
    const em = fakeEm({
      getKysely: <T>() => fakeDb([{ product_id: 'prod-1', category_id: 'cat-other', ancestor_ids: [] }], []) as T,
    })
    const service = new PromotionsServiceImpl(
      fakeContainer({ promotionCacheService: fakeCacheService([promo]), em }),
    )

    const result = await service.evaluate(
      evaluateInput({
        items: [
          {
            lineId: 'line-1',
            productId: 'prod-1',
            variantId: null,
            quantity: '2',
            unitPriceNet: '10.00',
            unitPriceGross: '12.30',
            priceIsPromotional: false,
          },
        ],
      }),
    )

    expect(result.appliedPromotions).toEqual([])
  })

  it('fails closed with a 400 CrudHttpError when auth carries no tenantId', async () => {
    const service = new PromotionsServiceImpl(
      fakeContainer({ promotionCacheService: fakeCacheService([]), auth: { tenantId: null, orgId: ORG } }),
    )

    expect.assertions(2)
    try {
      await service.evaluate(evaluateInput())
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(400)
    }
  })

  it('fails closed with a 400 CrudHttpError when no `auth` is registered in the container', async () => {
    const container: PromotionsServiceContainer = {
      resolve: <T>(name: string): T => {
        if (name === 'promotionCacheService') return fakeCacheService([]) as unknown as T
        throw new Error(`[internal] not registered: ${name}`)
      },
    }
    const service = new PromotionsServiceImpl(container)

    expect.assertions(2)
    try {
      await service.evaluate(evaluateInput())
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(400)
    }
  })
})

describe('PromotionsServiceImpl.evaluateForProduct', () => {
  it('returns a badge entry for a matching promotion', async () => {
    const promo = categoryMatchingPromotion({ id: 'promo-cat', categoryId: 'cat-1' })
    const em = fakeEm({
      getKysely: <T>() => fakeDb([{ product_id: 'prod-1', category_id: 'cat-1', ancestor_ids: [] }], []) as T,
    })
    const service = new PromotionsServiceImpl(
      fakeContainer({ promotionCacheService: fakeCacheService([promo]), em }),
    )

    const result = await service.evaluateForProduct({
      productId: 'prod-1',
      variantId: null,
      buyer: buyer(),
      evaluatedAt: '2026-06-15T00:00:00.000Z',
    })

    expect(result.badges).toEqual([
      { promotionId: 'promo-cat', promotionName: 'Test Promotion', label: { en: 'Category promo' } },
    ])
  })

  it('returns an empty badges array when nothing matches', async () => {
    const promo = categoryMatchingPromotion({ id: 'promo-cat', categoryId: 'cat-1' })
    const em = fakeEm({
      getKysely: <T>() => fakeDb([{ product_id: 'prod-1', category_id: 'cat-other', ancestor_ids: [] }], []) as T,
    })
    const service = new PromotionsServiceImpl(
      fakeContainer({ promotionCacheService: fakeCacheService([promo]), em }),
    )

    const result = await service.evaluateForProduct({
      productId: 'prod-1',
      variantId: null,
      buyer: buyer(),
      evaluatedAt: '2026-06-15T00:00:00.000Z',
    })

    expect(result.badges).toEqual([])
  })
})

// Step 6.3 — orchestration coverage for `registerUsage`/`revertUsage`: proves command
// dispatch and scope resolution from `auth`, same pattern as the Step 6.2 code-service
// methods below. The actual row-lock/budget-reread/transaction logic is
// `lib/__tests__/promotion-usage-service.test.ts`'s job, not this file's.
describe('PromotionsServiceImpl.registerUsage', () => {
  it('dispatches through commandBus as `promotions.usage.register` with the raw input', async () => {
    const commandBus = fakeCommandBus({ 'promotions.usage.register': { ok: true, budgetExceeded: ['promo-1'] } })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([]), commandBus }))

    const input = { orderId: 'order-1', orderType: 'order' as const, customerId: null, currency: 'USD', appliedPromotions: [] }
    const result = await service.registerUsage(input)

    expect(result).toEqual({ ok: true, budgetExceeded: ['promo-1'] })
    expect(commandBus.calls).toEqual([{ commandId: 'promotions.usage.register', input }])
  })

  it('fails closed with a 400 CrudHttpError when no `auth` is registered in the container', async () => {
    const container: PromotionsServiceContainer = {
      resolve: <T>(name: string): T => {
        if (name === 'promotionCacheService') return fakeCacheService([]) as unknown as T
        throw new Error(`[internal] not registered: ${name}`)
      },
    }
    const service = new PromotionsServiceImpl(container)

    expect.assertions(2)
    try {
      await service.registerUsage({ orderId: 'o', orderType: 'order', customerId: null, currency: 'USD', appliedPromotions: [] })
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(400)
    }
  })
})

describe('PromotionsServiceImpl.revertUsage', () => {
  it('dispatches through commandBus as `promotions.usage.revert` with the raw input', async () => {
    const commandBus = fakeCommandBus({ 'promotions.usage.revert': { ok: true, revertedCount: 2 } })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([]), commandBus }))

    const result = await service.revertUsage({ orderId: 'order-1' })

    expect(result).toEqual({ ok: true, revertedCount: 2 })
    expect(commandBus.calls).toEqual([{ commandId: 'promotions.usage.revert', input: { orderId: 'order-1' } }])
  })
})

// Step 6.2 — orchestration coverage for the five code-service methods: proves wiring
// (command dispatch for the three commanded methods, direct `promotionCodeService`
// delegation for the two plain-read/housekeeping methods, scope resolution from `auth`),
// not the code-resolution/eligibility/locking logic itself (covered by
// `code-service.test.ts`).
describe('PromotionsServiceImpl.reserveCode', () => {
  it('dispatches through commandBus as `promotions.code.reserve` with the raw input', async () => {
    const commandBus = fakeCommandBus({ 'promotions.code.reserve': { ok: true, codeId: 'code-1', type: 'static' } })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([]), commandBus }))

    const result = await service.reserveCode({ codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1' })

    expect(result).toEqual({ ok: true, codeId: 'code-1', type: 'static' })
    expect(commandBus.calls).toEqual([
      { commandId: 'promotions.code.reserve', input: { codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1' } },
    ])
  })

  it('fails closed with a 400 CrudHttpError when no `auth` is registered in the container', async () => {
    const container: PromotionsServiceContainer = {
      resolve: <T>(name: string): T => {
        if (name === 'promotionCacheService') return fakeCacheService([]) as unknown as T
        throw new Error(`[internal] not registered: ${name}`)
      },
    }
    const service = new PromotionsServiceImpl(container)

    expect.assertions(2)
    try {
      await service.reserveCode({ codeString: 'SAVE10', cartId: 'cart-1', customerId: null })
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(400)
    }
  })
})

describe('PromotionsServiceImpl.useCode', () => {
  it('dispatches through commandBus as `promotions.code.use` with the raw input', async () => {
    const commandBus = fakeCommandBus({ 'promotions.code.use': { ok: true } })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([]), commandBus }))

    const result = await service.useCode({ codeId: 'code-1', codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1', type: 'static' })

    expect(result).toEqual({ ok: true })
    expect(commandBus.calls).toEqual([
      {
        commandId: 'promotions.code.use',
        input: { codeId: 'code-1', codeString: 'SAVE10', cartId: 'cart-1', customerId: 'cust-1', type: 'static' },
      },
    ])
  })
})

describe('PromotionsServiceImpl.releaseCode', () => {
  it('dispatches through commandBus as `promotions.code.release` and discards its result', async () => {
    const commandBus = fakeCommandBus({ 'promotions.code.release': { ok: true } })
    const service = new PromotionsServiceImpl(fakeContainer({ promotionCacheService: fakeCacheService([]), commandBus }))

    const result = await service.releaseCode('code-1', 'cart-1')

    expect(result).toBeUndefined()
    expect(commandBus.calls).toEqual([
      { commandId: 'promotions.code.release', input: { codeId: 'code-1', cartId: 'cart-1' } },
    ])
  })
})

describe('PromotionsServiceImpl.validateCode', () => {
  it('delegates directly to promotionCodeService (never a command)', async () => {
    const calls: unknown[] = []
    const promotionCodeService: FakePromotionCodeService = {
      validateCode: async (...args) => {
        calls.push(args)
        return { valid: false, reason: 'code_invalid' }
      },
    }
    const service = new PromotionsServiceImpl(
      fakeContainer({ promotionCacheService: fakeCacheService([]), promotionCodeService }),
    )

    const result = await service.validateCode({ codeString: 'SAVE10', cartId: 'cart-1', customerId: null })

    expect(result).toEqual({ valid: false, reason: 'code_invalid' })
    expect(calls).toHaveLength(1)
  })
})

describe('PromotionsServiceImpl.extendReservation', () => {
  it('delegates directly to promotionCodeService (never a command)', async () => {
    const calls: unknown[] = []
    const promotionCodeService: FakePromotionCodeService = {
      extendReservation: async (...args) => {
        calls.push(args)
      },
    }
    const service = new PromotionsServiceImpl(
      fakeContainer({ promotionCacheService: fakeCacheService([]), promotionCodeService }),
    )

    const result = await service.extendReservation('code-1', 'cart-1')

    expect(result).toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})
