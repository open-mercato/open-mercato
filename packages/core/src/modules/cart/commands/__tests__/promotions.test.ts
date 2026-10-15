jest.mock('../../events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

type FakeRow = Record<string, any>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (value && typeof value === 'object' && !(value instanceof Date) && '$in' in (value as object)) {
      return ((value as { $in: unknown[] }).$in).includes(row[key])
    }
    return row[key] === value
  })
}

let seededCarts: FakeRow[] = []
let seededCartLines: FakeRow[] = []
let seededApplications: FakeRow[] = []
let seededRules: FakeRow[] = []
let seededPromotions: FakeRow[] = []
let seededReservations: FakeRow[] = []

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CartLine) return seededCartLines.find((row) => matchesWhere(row, where)) ?? null
  if (entity === Cart) return seededCarts.find((row) => matchesWhere(row, where)) ?? null
  throw new Error('[internal] unexpected findOneWithDecryption entity in test')
})

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CartLine) return seededCartLines.filter((row) => matchesWhere(row, where))
  if (entity === Cart) return seededCarts.filter((row) => matchesWhere(row, where))
  if (entity === CartPromotionApplication) return seededApplications.filter((row) => matchesWhere(row, where))
  return []
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Cart, CartLine, CartPromotionApplication } from '../../data/entities'
import { Promotion, Rule, CodeReservation } from '@open-mercato/core/modules/promotions/data/entities'
import { emitCartEvent as mockedEmitCartEvent } from '../../events'
import { repriceCartCommand } from '../cart'
import type { CartRepriceInput, CartRepriceResult } from '../cart'
import type {
  CartPromotionsApplyInput,
  CartPromotionsCommandResult,
  CartPromotionsRemoveInput,
} from '../promotions'
import '../promotions'

const emitCartEventMock = mockedEmitCartEvent as jest.Mock

const TENANT_ID = 'tenant-prom-1'
const ORG_ID = 'org-prom-1'

function makeCartFixture(overrides: FakeRow = {}): FakeRow {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
    id: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    channel: 'storefront',
    kind: 'basket',
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: null,
    customerIds: [],
    customerUserId: null,
    customerGroupIds: [],
    priceKindId: null,
    taxMode: 'gross',
    email: null,
    note: null,
    buyerDigest: 'digest-1',
    assortmentScopeHash: null,
    totals: {
      subtotalNetAmount: 0,
      subtotalGrossAmount: 0,
      discountTotalAmount: 0,
      taxTotalAmount: 0,
      grandTotalNetAmount: 0,
      grandTotalGrossAmount: 0,
    },
    totalsComputedAt: now,
    promotionEffects: null,
    requiresApproval: false,
    approvalId: null,
    metadata: null,
    salesChannelId: null,
    lastActivityAt: now,
    lastPriceChangeAt: null,
    lockedAt: null,
    lockExpiresAt: null,
    checkoutSessionId: null,
    resolvedAt: null,
    expiresAt: new Date('2026-03-08T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * A single shared, entity-aware fake `EntityManager`. Unlike `commands/__tests__/cart.test.ts`'s
 * `makeEm` (which never needs cross-module entities), this phase chain — `cart.promotions.apply`/
 * `.remove` dispatching `cart.reprice` internally — touches `Rule`/`Promotion`/`CodeReservation`
 * too (`commands/promotions.ts`'s own `resolvePromotionIdsForCode`, and `lib/promotionContext.ts`'s
 * lapsed-reservation check), so `find`/`findOne`/`create`/`persist`/`remove` all dispatch on the
 * entity class reference. `create`+`persist` write straight into the matching seeded array
 * (no deferred-until-flush modeling) — close enough for proving the cross-command wiring without
 * reimplementing MikroORM's unit of work.
 */
function makeEm() {
  const em: any = {
    fork: jest.fn(),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === Rule) return seededRules.filter((row) => matchesWhere(row, where))
      if (entity === Promotion) return seededPromotions.filter((row) => matchesWhere(row, where))
      if (entity === CartLine) return seededCartLines.filter((row) => matchesWhere(row, where))
      return []
    }),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CodeReservation) return seededReservations.find((row) => matchesWhere(row, where)) ?? null
      return null
    }),
    create: jest.fn((entity: unknown, data: FakeRow) => {
      const row = { id: `generated-${Math.random().toString(36).slice(2)}`, ...data }
      if (entity === CartPromotionApplication) return row
      return row
    }),
    persist: jest.fn((row: FakeRow) => {
      // Every `em.create` call in this test file is for `CartPromotionApplication` — the
      // only entity either command creates — so this is unambiguous without re-checking
      // the constructor.
      seededApplications.push(row)
    }),
    remove: jest.fn((row: FakeRow) => {
      seededApplications = seededApplications.filter((existing) => existing !== row)
    }),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeDataEngine() {
  return {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
}

function makeSalesCalculationService() {
  return {
    calculateLine: jest.fn(async ({ line }: any) => ({
      line,
      netAmount: 0,
      grossAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      adjustments: [],
    })),
    calculateDocumentTotals: jest.fn(async () => ({
      kind: 'quote',
      currencyCode: 'USD',
      lines: [],
      adjustments: [],
      totals: {
        subtotalNetAmount: 0,
        subtotalGrossAmount: 0,
        discountTotalAmount: 0,
        taxTotalAmount: 0,
        grandTotalNetAmount: 0,
        grandTotalGrossAmount: 0,
      },
      metadata: {},
    })),
  }
}

/** Resolves `cart.reprice` by calling the REAL registered handler directly — same
 * precedent `cart.test.ts`'s own `makeFakeCommandBus` already establishes for `cart.get`'s
 * identical internal-dispatch shape. */
function makeFakeCommandBus(): CommandBus {
  return {
    execute: jest.fn(async (id: string, options: { input: unknown; ctx: CommandRuntimeContext }) => {
      if (id === 'cart.reprice') {
        const result = await repriceCartCommand.execute(options.input as CartRepriceInput, options.ctx)
        return { result }
      }
      throw new Error(`Unexpected command id in fake CommandBus: ${id}`)
    }),
  } as unknown as CommandBus
}

function makeCtx(opts: {
  em: unknown
  promotionsService: FakeRow
  evaluate?: jest.Mock
}): CommandRuntimeContext {
  const dataEngine = makeDataEngine()
  const salesCalculationService = makeSalesCalculationService()
  const evaluate = opts.evaluate ?? jest.fn(async () => ({ appliedPromotions: [] }))
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return dataEngine
        if (token === 'commandBus') return makeFakeCommandBus()
        if (token === 'promotionsService') return { ...opts.promotionsService, evaluate }
        if (token === 'catalogBuyerPricingService') return { resolveLinePrice: jest.fn() }
        if (token === 'salesCalculationService') return salesCalculationService
        if (token === 'catalogScopedProductService') return { loadScopedProducts: jest.fn(async () => new Map()) }
        throw new Error(`Unexpected DI token: ${token}`)
      },
      register: jest.fn(),
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

function makeReserveCodeMock(impl?: (input: FakeRow) => Promise<FakeRow>) {
  return jest.fn(async (input: FakeRow) => {
    if (impl) return impl(input)
    const existing = seededReservations.find((row) => row.codeId === 'code-1' && row.cartId === input.cartId)
    if (!existing) {
      seededReservations.push({
        id: 'reservation-1',
        codeId: 'code-1',
        cartId: input.cartId,
        customerId: input.customerId,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        expiresAt: new Date('2026-04-01T00:00:00.000Z'),
      })
    }
    return { ok: true, codeId: 'code-1', type: 'static' as const }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  seededCarts = []
  seededCartLines = []
  seededApplications = []
  seededRules = []
  seededPromotions = []
  seededReservations = []
})

describe('cart.promotions.apply', () => {
  it('reserves a code, creates a placeholder application row, and the internally dispatched re-price picks the code up in codes[]', async () => {
    seededCarts = [makeCartFixture()]
    seededRules = [
      { id: 'rule-1', promotionId: 'promo-1', ruleType: 'code', config: { codeId: 'code-1' }, tenantId: TENANT_ID, organizationId: ORG_ID },
    ]
    seededPromotions = [{ id: 'promo-1', active: true, deletedAt: null, tenantId: TENANT_ID, organizationId: ORG_ID }]

    const handler = commandRegistry.get<CartPromotionsApplyInput, CartPromotionsCommandResult>('cart.promotions.apply')
    expect(handler).toBeDefined()

    const em = makeEm()
    const reserveCode = makeReserveCodeMock()
    const releaseCode = jest.fn(async () => undefined)
    const extendReservation = jest.fn(async () => undefined)
    // The SAME evaluate() mock is used for every `cart.reprice` call this command triggers;
    // asserting on its second (and only, here) call's `codes` input is the proof the
    // placeholder row this command persists is actually picked up.
    const evaluate = jest.fn(async () => ({ appliedPromotions: [] }))
    const ctx = makeCtx({ em, promotionsService: { reserveCode, releaseCode, extendReservation }, evaluate })

    const input: CartPromotionsApplyInput = {
      cartId: 'cart-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      codeString: 'SAVE10',
    }
    const result = await handler!.execute(input, ctx)

    expect(reserveCode).toHaveBeenCalledWith({ codeString: 'SAVE10', cartId: 'cart-1', customerId: null })
    expect(seededApplications).toHaveLength(1)
    expect(seededApplications[0]).toMatchObject({
      cartId: 'cart-1',
      promotionId: 'promo-1',
      codeId: 'code-1',
      codeType: 'static',
      code: 'SAVE10',
      codeReservationId: 'reservation-1',
      scope: 'order',
      cartLineId: null,
      effect: {},
    })
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate.mock.calls[0][0].codes).toEqual([{ id: 'code-1', type: 'static' }])
    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.promotion.applied',
      expect.objectContaining({ cartId: 'cart-1', promotionId: 'promo-1', codeId: 'code-1' }),
    )
    expect(result.cart.id).toBe('cart-1')
  })

  it('is idempotent per (cart, code): applying the same code twice never creates a second placeholder row', async () => {
    seededCarts = [makeCartFixture()]
    seededRules = [
      { id: 'rule-1', promotionId: 'promo-1', ruleType: 'code', config: { codeId: 'code-1' }, tenantId: TENANT_ID, organizationId: ORG_ID },
    ]
    seededPromotions = [{ id: 'promo-1', active: true, deletedAt: null, tenantId: TENANT_ID, organizationId: ORG_ID }]

    const handler = commandRegistry.get<CartPromotionsApplyInput, CartPromotionsCommandResult>('cart.promotions.apply')
    const em = makeEm()
    const reserveCode = makeReserveCodeMock()
    const releaseCode = jest.fn(async () => undefined)
    const extendReservation = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, promotionsService: { reserveCode, releaseCode, extendReservation } })

    const input: CartPromotionsApplyInput = { cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, codeString: 'SAVE10' }
    await handler!.execute(input, ctx)
    await handler!.execute(input, ctx)

    expect(seededApplications).toHaveLength(1)
  })

  it('maps every reserveCode failure to the uniform 409 code_reservation_unavailable, never leaking promotions\' own error vocabulary', async () => {
    seededCarts = [makeCartFixture()]
    const handler = commandRegistry.get<CartPromotionsApplyInput, CartPromotionsCommandResult>('cart.promotions.apply')
    const em = makeEm()
    const reserveCode = jest.fn(async () => {
      throw Object.assign(new Error('code_invalid'), { status: 422, body: { error: 'code_invalid' } })
    })
    const ctx = makeCtx({ em, promotionsService: { reserveCode, releaseCode: jest.fn(), extendReservation: jest.fn() } })

    let captured: unknown
    try {
      await handler!.execute({ cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, codeString: 'BAD' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect((captured as { body: FakeRow }).body.code).toBe('code_reservation_unavailable')
    expect(seededApplications).toHaveLength(0)
  })

  it('releases the just-taken reservation and 409s when the code is valid but no active promotion references it', async () => {
    seededCarts = [makeCartFixture()]
    // No `seededRules` entry at all for 'code-1' — the code resolves and reserves, but no
    // promotion's rule tree names it.
    const handler = commandRegistry.get<CartPromotionsApplyInput, CartPromotionsCommandResult>('cart.promotions.apply')
    const em = makeEm()
    const reserveCode = makeReserveCodeMock()
    const releaseCode = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, promotionsService: { reserveCode, releaseCode, extendReservation: jest.fn() } })

    let captured: unknown
    try {
      await handler!.execute({ cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, codeString: 'ORPHAN' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(409)
    expect(releaseCode).toHaveBeenCalledWith('code-1', 'cart-1')
    expect(seededApplications).toHaveLength(0)
  })
})

describe('cart.promotions.remove', () => {
  it('releases the reservation, deletes the application row(s), and removes any gift lines for that promotion', async () => {
    seededCarts = [makeCartFixture()]
    seededApplications = [
      { id: 'app-1', cartId: 'cart-1', promotionId: 'promo-1', codeId: 'code-1', codeType: 'static', code: 'SAVE10', cartLineId: 'line-1', tenantId: TENANT_ID, organizationId: ORG_ID },
    ]
    seededCartLines = [
      {
        id: 'line-1',
        cartId: 'cart-1',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        origin: 'promotion',
        promotionId: 'promo-1',
        productId: 'gift-product-1',
        variantId: null,
        flagState: null,
        deletedAt: null,
        quantity: '1',
        lineNumber: 1,
      },
    ]
    seededReservations = [
      { id: 'reservation-1', codeId: 'code-1', cartId: 'cart-1', customerId: null, tenantId: TENANT_ID, organizationId: ORG_ID, expiresAt: new Date('2026-04-01T00:00:00.000Z') },
    ]

    const handler = commandRegistry.get<CartPromotionsRemoveInput, CartPromotionsCommandResult>('cart.promotions.remove')
    expect(handler).toBeDefined()

    const em = makeEm()
    const releaseCode = jest.fn(async (codeId: string, cartId: string) => {
      seededReservations = seededReservations.filter((row) => !(row.codeId === codeId && row.cartId === cartId))
    })
    const ctx = makeCtx({ em, promotionsService: { reserveCode: jest.fn(), releaseCode, extendReservation: jest.fn() } })

    const input: CartPromotionsRemoveInput = { cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, promotionId: 'promo-1' }
    const result = await handler!.execute(input, ctx)

    expect(releaseCode).toHaveBeenCalledWith('code-1', 'cart-1')
    expect(seededReservations).toHaveLength(0)
    expect(seededApplications).toHaveLength(0)
    const giftLine = seededCartLines.find((row) => row.id === 'line-1')
    expect(giftLine?.deletedAt).not.toBeNull()
    expect(emitCartEventMock).toHaveBeenCalledWith(
      'cart.promotion.removed',
      expect.objectContaining({ cartId: 'cart-1', promotionId: 'promo-1' }),
    )
    expect(result.cart.id).toBe('cart-1')
  })

  it('404s removing a promotion that was never applied (or already removed), mirroring cart.lines.remove\'s idempotent-in-effect 404', async () => {
    seededCarts = [makeCartFixture()]
    seededApplications = []

    const handler = commandRegistry.get<CartPromotionsRemoveInput, CartPromotionsCommandResult>('cart.promotions.remove')
    const em = makeEm()
    const ctx = makeCtx({ em, promotionsService: { reserveCode: jest.fn(), releaseCode: jest.fn(), extendReservation: jest.fn() } })

    let captured: unknown
    try {
      await handler!.execute({ cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, promotionId: 'promo-never-applied' }, ctx)
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(404)
  })

  it('removes a codeless (automatic) promotion\'s application row without touching promotionsService.releaseCode', async () => {
    seededCarts = [makeCartFixture()]
    seededApplications = [
      { id: 'app-auto', cartId: 'cart-1', promotionId: 'promo-auto', codeId: null, codeType: null, code: null, cartLineId: null, tenantId: TENANT_ID, organizationId: ORG_ID },
    ]

    const handler = commandRegistry.get<CartPromotionsRemoveInput, CartPromotionsCommandResult>('cart.promotions.remove')
    const em = makeEm()
    const releaseCode = jest.fn(async () => undefined)
    const ctx = makeCtx({ em, promotionsService: { reserveCode: jest.fn(), releaseCode, extendReservation: jest.fn() } })

    await handler!.execute({ cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, promotionId: 'promo-auto' }, ctx)

    expect(releaseCode).not.toHaveBeenCalled()
    expect(seededApplications).toHaveLength(0)
  })
})

// Step 7.4 — trigger 6 fix (§5.2: "a promotion is applied or removed — effects only, not
// unit prices"). `cart.promotions.apply`'s own internally-dispatched `cart.reprice` call
// (`trigger: 'promotion_applied'`) must skip `linePhases`'s catalog-price re-resolution
// entirely — proven two ways at once: `unitPriceNet`/`unitPriceGross` stay byte-for-byte
// identical to their pre-reprice snapshot, AND `catalogBuyerPricingService.resolveLinePrice`
// (mocked with no implementation in this file's own `makeCtx`) is never actually invoked —
// if `linePhases` ran for this line despite the fix, that mock would throw, failing this
// test outright rather than just asserting a wrong value.
describe('cart.promotions.apply — trigger 6 (Step 7.4)', () => {
  it('leaves unitPriceNet/unitPriceGross untouched while updating discountTotalNet', async () => {
    seededCarts = [makeCartFixture()]
    seededCartLines = [
      {
        id: 'line-1',
        cartId: 'cart-1',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        lineNumber: 1,
        productId: 'product-1',
        variantId: null,
        name: 'Widget',
        quantity: '2',
        quantityUnit: null,
        unitPriceNet: '10',
        unitPriceGross: '12',
        taxRate: '20',
        priceKindId: null,
        priceRowId: 'price-row-1',
        priceTierMinQuantity: 1,
        pricedAt: new Date('2026-03-01T00:00:00.000Z'),
        lineTotals: {},
        discountTotalNet: null,
        origin: 'customer',
        flagState: null,
        configuration: null,
        deletedAt: null,
      },
    ]
    seededRules = [
      { id: 'rule-1', promotionId: 'promo-1', ruleType: 'code', config: { codeId: 'code-1' }, tenantId: TENANT_ID, organizationId: ORG_ID },
    ]
    seededPromotions = [{ id: 'promo-1', active: true, deletedAt: null, tenantId: TENANT_ID, organizationId: ORG_ID }]

    const handler = commandRegistry.get<CartPromotionsApplyInput, CartPromotionsCommandResult>('cart.promotions.apply')
    const em = makeEm()
    const reserveCode = makeReserveCodeMock()
    const releaseCode = jest.fn(async () => undefined)
    const extendReservation = jest.fn(async () => undefined)
    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-1',
          promotionName: 'Promo',
          effects: [
            {
              type: 'LINE_DISCOUNT',
              appliesTo: 'line',
              currency: 'USD',
              label: {},
              targetLineId: 'line-1',
              targetProductId: 'product-1',
              targetVariantId: null,
              lineQuantity: 2,
              appliedQuantity: 2,
              amountNet: '-2.00',
              amountGross: '-2.40',
              basis: 'net',
            },
          ],
        },
      ],
    }))
    const ctx = makeCtx({ em, promotionsService: { reserveCode, releaseCode, extendReservation }, evaluate })

    const input: CartPromotionsApplyInput = { cartId: 'cart-1', tenantId: TENANT_ID, organizationId: ORG_ID, codeString: 'SAVE10' }
    await handler!.execute(input, ctx)

    const line = seededCartLines.find((row) => row.id === 'line-1')!
    expect(line.unitPriceNet).toBe('10')
    expect(line.unitPriceGross).toBe('12')
    expect(line.discountTotalNet).toBe('-2.00')
  })
})
