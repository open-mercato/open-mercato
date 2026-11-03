type Row = Record<string, any>

const mockFindWithDecryption = jest.fn(async () => [] as Row[])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { Cart, CartLine, CartPromotionApplication } from '../../data/entities'
import { buildPromotionsEffectsPhase, toPromotionCartLine } from '../promotionContext'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

function makeCart(overrides: Row = {}): Cart {
  return {
    id: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    channel: 'storefront',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: null,
    customerIds: [],
    customerGroupIds: [],
    promotionEffects: null,
    ...overrides,
  } as Cart
}

function makeLine(overrides: Row = {}): CartLine {
  return {
    id: 'line-1',
    cartId: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lineNumber: 1,
    productId: 'product-1',
    variantId: null,
    sku: 'SKU-1',
    name: 'Widget',
    quantity: '2',
    unitPriceNet: '10',
    unitPriceGross: '12',
    discountTotalNet: null,
    promotionId: null,
    origin: 'customer',
    flagState: null,
    deletedAt: null,
    ...overrides,
  } as CartLine
}

/**
 * Step 7.2 — `findOne` backs the lapsed-reservation check (`em.findOne(CodeReservation, ...)`
 * in `buildPromotionsEffectsPhase`'s own READ section). `opts.reservedCodeIds` is the set of
 * codeIds this test wants to answer "still reserved" for; any other codeId resolves `null`
 * (lapsed).
 */
function makeEm(opts: { allLines?: Row[]; reservedCodeIds?: string[] } = {}) {
  let createCounter = 0
  const persisted: Row[] = []
  const removed: Row[] = []
  const reservedCodeIds = new Set(opts.reservedCodeIds ?? [])
  const em: any = {
    find: jest.fn(async () => opts.allLines ?? []),
    findOne: jest.fn(async (_entity: unknown, where: Row) => {
      const codeId = where?.codeId
      return reservedCodeIds.has(codeId) ? { id: `reservation-${codeId}`, codeId } : null
    }),
    create: jest.fn((_ctor: unknown, data: Row) => {
      createCounter += 1
      return { id: `generated-${createCounter}`, ...data }
    }),
    persist: jest.fn((entity: Row) => {
      persisted.push(entity)
    }),
    remove: jest.fn((entity: Row) => {
      removed.push(entity)
    }),
  }
  return { em, persisted, removed }
}

function makeContainer(opts: {
  evaluate?: jest.Mock
  loadScopedProducts?: jest.Mock
  calculateLine?: jest.Mock
  extendReservation?: jest.Mock
}) {
  const evaluate = opts.evaluate ?? jest.fn(async () => ({ appliedPromotions: [] }))
  const loadScopedProducts = opts.loadScopedProducts ?? jest.fn(async () => new Map())
  const calculateLine = opts.calculateLine ?? jest.fn(async ({ line }: any) => ({
    line,
    netAmount: 0,
    grossAmount: 0,
    taxAmount: 0,
    discountAmount: 0,
    adjustments: [],
  }))
  const extendReservation = opts.extendReservation ?? jest.fn(async () => undefined)
  return {
    resolve: (token: string): any => {
      if (token === 'promotionsService') return { evaluate, extendReservation }
      if (token === 'catalogScopedProductService') return { loadScopedProducts }
      if (token === 'salesCalculationService') return { calculateLine }
      throw new Error(`Unexpected DI token: ${token}`)
    },
    evaluate,
    loadScopedProducts,
    calculateLine,
    extendReservation,
  }
}

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockFindWithDecryption.mockImplementation(async () => [])
})

describe('toPromotionCartLine', () => {
  it('maps a CartLine onto the EvaluateItem contract, defaulting missing prices to "0" and hardcoding priceIsPromotional false', () => {
    const line = makeLine({ unitPriceNet: null, unitPriceGross: null, variantId: 'variant-1' })
    expect(toPromotionCartLine(line)).toEqual({
      lineId: 'line-1',
      productId: 'product-1',
      variantId: 'variant-1',
      quantity: '2',
      unitPriceNet: '0',
      unitPriceGross: '0',
      priceIsPromotional: false,
    })
  })
})

describe('buildPromotionsEffectsPhase', () => {
  it('excludes a flagged line and a promotion-origin (gift) line from the items sent to evaluate()', async () => {
    const cart = makeCart()
    const normalLine = makeLine({ id: 'line-1' })
    const flaggedLine = makeLine({ id: 'line-2', flagState: 'product_unavailable' })
    const giftLine = makeLine({ id: 'line-3', origin: 'promotion', promotionId: 'promo-1' })
    const lines = [normalLine, flaggedLine, giftLine]

    const { em } = makeEm()
    const container = makeContainer({})
    const adjustments: any[] = []
    const warnings: any[] = []
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments,
      warnings,
      createdGiftLines,
      removedGiftLines,
    })
    await phase()

    expect(container.evaluate).toHaveBeenCalledTimes(1)
    const input = container.evaluate.mock.calls[0][0]
    expect(input.items).toHaveLength(1)
    expect(input.items[0].lineId).toBe('line-1')
    expect(input.codes).toEqual([])
    expect(input.customerOrderCount).toBeNull()
    expect(input.cartWeight).toBeNull()
  })

  it('maps a LINE_DISCOUNT effect onto the target line\'s discountTotalNet and syncs a line-scoped CartPromotionApplication', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-1',
          promotionName: '10% off',
          effects: [
            {
              type: 'LINE_DISCOUNT',
              appliesTo: 'line',
              currency: 'USD',
              label: { en: '10% off' },
              targetLineId: 'line-1',
              targetProductId: 'product-1',
              targetVariantId: null,
              lineQuantity: 2,
              appliedQuantity: 2,
              amountNet: '-2.0000',
              amountGross: '-2.4000',
              basis: 'net',
            },
          ],
        },
      ],
    }))
    const { em, persisted } = makeEm()
    const container = makeContainer({ evaluate })
    const adjustments: any[] = []
    const warnings: any[] = []
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments,
      warnings,
      createdGiftLines,
      removedGiftLines,
    })
    await phase()

    expect(line.discountTotalNet).toBe('-2.0000')
    expect(adjustments).toHaveLength(0)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      promotionId: 'promo-1',
      cartLineId: 'line-1',
      scope: 'line',
      amountNet: '-2.0000',
      amountGross: '-2.4000',
    })
    expect(cart.promotionEffects).toEqual([
      expect.objectContaining({ promotionId: 'promo-1' }),
    ])
  })

  it('maps a CART_DISCOUNT effect onto an order-scope SalesAdjustmentDraft with kind "discount"', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-2',
          promotionName: 'Cart-wide 5 off',
          effects: [
            {
              type: 'CART_DISCOUNT',
              appliesTo: 'order',
              currency: 'USD',
              label: { 'en-US': 'Cart-wide $5 off', en: 'fallback' },
              amountNet: '-5.0000',
              amountGross: '-6.0000',
              basis: 'net',
            },
          ],
        },
      ],
    }))
    const { em } = makeEm()
    const container = makeContainer({ evaluate })
    const adjustments: any[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments,
      warnings: [],
      createdGiftLines: [],
      removedGiftLines: [],
    })
    await phase()

    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]).toMatchObject({
      scope: 'order',
      kind: 'discount',
      promotionId: 'promo-2',
      amountNet: -5,
      amountGross: -6,
      currencyCode: 'USD',
      label: 'Cart-wide $5 off',
    })
  })

  it('drops a DELIVERY_DISCOUNT effect entirely — no adjustment, no warning, no line mutation', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-3',
          promotionName: 'Free delivery',
          effects: [
            {
              type: 'DELIVERY_DISCOUNT',
              appliesTo: 'order',
              currency: 'USD',
              label: {},
              deliveryMethodCode: 'standard',
              amountNet: '-3.0000',
              amountGross: '-3.0000',
              basis: 'net',
            },
          ],
        },
      ],
    }))
    const { em } = makeEm()
    const container = makeContainer({ evaluate })
    const adjustments: any[] = []
    const warnings: any[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments,
      warnings,
      createdGiftLines: [],
      removedGiftLines: [],
    })
    await phase()

    expect(adjustments).toHaveLength(0)
    expect(warnings).toHaveLength(0)
    expect(line.discountTotalNet).toBeNull()
  })

  it('creates a gift CartLine for a visible ADD_FREE_ITEM effect and syncs its CartPromotionApplication', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-4',
          promotionName: 'Free gift',
          effects: [
            {
              type: 'ADD_FREE_ITEM',
              appliesTo: 'order',
              currency: 'USD',
              label: { en: 'Free gift' },
              productId: 'gift-product-1',
              variantId: null,
              quantity: 1,
              reason: 'FREE_PRODUCT',
              promotionId: 'promo-4',
            },
          ],
        },
      ],
    }))

    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CatalogProduct) return [{ id: 'gift-product-1', sku: 'GIFT-1', title: 'Free Gift Product' }]
      if (entity === CartPromotionApplication) return []
      return []
    })

    const { em, persisted } = makeEm({ allLines: lines })
    const container = makeContainer({ evaluate })
    const createdGiftLines: CartLine[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      // scope undefined -> enforcement off -> every candidate resolves 'visible'.
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings: [],
      createdGiftLines,
      removedGiftLines: [],
    })
    await phase()

    expect(createdGiftLines).toHaveLength(1)
    const giftLine = createdGiftLines[0]
    expect(giftLine).toMatchObject({
      origin: 'promotion',
      promotionId: 'promo-4',
      productId: 'gift-product-1',
      sku: 'GIFT-1',
      name: 'Free Gift Product',
      quantity: '1',
      unitPriceNet: '0',
      unitPriceGross: '0',
      addedByActorType: 'system',
    })
    expect(lines).toContain(giftLine)
    const applicationRow = persisted.find((row) => row.cartLineId === giftLine.id && 'effect' in row)
    expect(applicationRow).toMatchObject({ promotionId: 'promo-4', cartLineId: giftLine.id, scope: 'line' })
  })

  it('TC-CART-PROM-02: does NOT create a line for an ADD_FREE_ITEM effect whose product fails the assortment scope, and surfaces a product_unavailable warning instead', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-5',
          promotionName: 'Restricted free gift',
          effects: [
            {
              type: 'ADD_FREE_ITEM',
              appliesTo: 'order',
              currency: 'USD',
              label: {},
              productId: 'restricted-product-1',
              variantId: null,
              quantity: 1,
              reason: 'FREE_PRODUCT',
              promotionId: 'promo-5',
            },
          ],
        },
      ],
    }))

    // No product matches the resolved scope at all.
    const loadScopedProducts = jest.fn(async () => new Map([['restricted-product-1', null]]))
    mockFindWithDecryption.mockImplementation(async () => [])

    const { em, persisted } = makeEm({ allLines: lines })
    const container = makeContainer({ evaluate, loadScopedProducts })
    const createdGiftLines: CartLine[] = []
    const warnings: any[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      // A non-undefined scope turns enforcement ON for the batch visibility check.
      assortmentScope: [],
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings,
      createdGiftLines,
      removedGiftLines: [],
    })
    await phase()

    expect(createdGiftLines).toHaveLength(0)
    expect(warnings).toEqual([{ code: 'product_unavailable', productId: 'restricted-product-1', variantId: null }])
    expect(persisted.find((row) => row.promotionId === 'promo-5')).toBeUndefined()
    expect(lines).toHaveLength(1)
  })

  it('removes a gift line whose promotion no longer appears in the evaluation result', async () => {
    const cart = makeCart()
    const normalLine = makeLine({ id: 'line-1' })
    const staleGiftLine = makeLine({
      id: 'gift-line-1',
      origin: 'promotion',
      promotionId: 'promo-6',
      productId: 'gift-product-6',
      unitPriceNet: '0',
      unitPriceGross: '0',
    })
    const lines = [normalLine, staleGiftLine]

    const evaluate = jest.fn(async () => ({ appliedPromotions: [] }))
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CartPromotionApplication) {
        return [
          {
            id: 'application-1',
            promotionId: 'promo-6',
            cartLineId: 'gift-line-1',
            amountNet: null,
            amountGross: null,
          },
        ]
      }
      return []
    })

    const { em, removed } = makeEm()
    const container = makeContainer({ evaluate })
    const removedGiftLines: CartLine[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings: [],
      createdGiftLines: [],
      removedGiftLines,
    })
    await phase()

    expect(removedGiftLines).toHaveLength(1)
    expect(removedGiftLines[0].id).toBe('gift-line-1')
    expect(staleGiftLine.deletedAt).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    expect(lines).toEqual([normalLine])
    expect(removed).toHaveLength(1)
    expect(removed[0].id).toBe('application-1')
  })

  it('leaves an existing gift line untouched when its promotion still applies and nothing changed', async () => {
    const cart = makeCart()
    const giftLine = makeLine({
      id: 'gift-line-1',
      origin: 'promotion',
      promotionId: 'promo-7',
      productId: 'gift-product-7',
      unitPriceNet: '0',
      unitPriceGross: '0',
    })
    const lines = [giftLine]

    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-7',
          promotionName: 'Still a gift',
          effects: [
            {
              type: 'ADD_FREE_ITEM',
              appliesTo: 'order',
              currency: 'USD',
              label: {},
              productId: 'gift-product-7',
              variantId: null,
              quantity: 1,
              reason: 'FREE_PRODUCT',
              promotionId: 'promo-7',
            },
          ],
        },
      ],
    }))
    mockFindWithDecryption.mockImplementation(async () => [])

    const { em, persisted, removed } = makeEm()
    const container = makeContainer({ evaluate })
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings: [],
      createdGiftLines,
      removedGiftLines,
    })
    await phase()

    expect(createdGiftLines).toHaveLength(0)
    expect(removedGiftLines).toHaveLength(0)
    expect(lines).toEqual([giftLine])
    expect(giftLine.deletedAt).toBeNull()
    // No application row existed and the kept gift line produces no monetary amount to
    // sync — nothing is persisted or removed.
    expect(persisted).toHaveLength(0)
    expect(removed).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // Step 7.2 — codes:[] sourced from existing applications, reservation extension/lapse,
  // and the key design decision (a code-bearing row survives an evaluation where its
  // promotion produces no effect; a codeless one does not).
  // ---------------------------------------------------------------------------

  it('TC-CART-PROM-apply-01: derives evaluate()\'s codes from existing code-bearing CartPromotionApplication rows, deduped by codeId', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({ appliedPromotions: [] }))
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CartPromotionApplication) {
        return [
          { id: 'app-1', promotionId: 'promo-1', cartLineId: null, codeId: 'code-1', codeType: 'static', code: 'SAVE10', amountNet: null, amountGross: null },
          // Same codeId, different line — a cumulative benefit's second target. Must not
          // produce a duplicate CodeRef.
          { id: 'app-2', promotionId: 'promo-1', cartLineId: 'line-2', codeId: 'code-1', codeType: 'static', code: 'SAVE10', amountNet: null, amountGross: null },
        ]
      }
      return []
    })

    const { em } = makeEm({ reservedCodeIds: ['code-1'] })
    const container = makeContainer({ evaluate })

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings: [],
      createdGiftLines: [],
      removedGiftLines: [],
    })
    await phase()

    expect(container.evaluate).toHaveBeenCalledTimes(1)
    const input = container.evaluate.mock.calls[0][0]
    expect(input.codes).toEqual([{ id: 'code-1', type: 'static' }])
    expect(container.extendReservation).toHaveBeenCalledWith('code-1', 'cart-1')
  })

  it('TC-CART-PROM-apply-02: a code-bearing application survives an evaluation where its promotion produces no effect — the row is kept with its effect zeroed, not deleted', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    // The promotion the held code unlocks does not currently match the cart (e.g. a
    // minimum-cart-value rule) — absent from `appliedPromotions`, same as a genuinely
    // inapplicable automatic promotion would be.
    const evaluate = jest.fn(async () => ({ appliedPromotions: [] }))
    const existingApplicationRow: Row = {
      id: 'app-code',
      promotionId: 'promo-code',
      cartLineId: 'line-1',
      codeId: 'code-2',
      codeType: 'static',
      code: 'MINCART',
      effect: { type: 'LINE_DISCOUNT' },
      amountNet: '-2.0000',
      amountGross: '-2.4000',
    }
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CartPromotionApplication) return [existingApplicationRow]
      return []
    })

    const { em, removed } = makeEm({ reservedCodeIds: ['code-2'] })
    const container = makeContainer({ evaluate })

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings: [],
      createdGiftLines: [],
      removedGiftLines: [],
    })
    await phase()

    // Never removed — the KEY DESIGN DECISION.
    expect(removed).toHaveLength(0)
    // The sync loop mutates the SAME row object `findWithDecryption` returned, in place.
    expect(existingApplicationRow.effect).toEqual({})
    expect(existingApplicationRow.amountNet).toBeNull()
    expect(existingApplicationRow.amountGross).toBeNull()
    expect(existingApplicationRow.cartLineId).toBeNull()
  })

  it('TC-CART-PROM-apply-03: regression — a CODELESS automatic promotion absent from the result is still pruned (Step 7.1 behavior, unaffected by the Step 7.2 code exemption)', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({ appliedPromotions: [] }))
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CartPromotionApplication) {
        return [
          { id: 'app-automatic', promotionId: 'promo-automatic', cartLineId: 'line-1', codeId: null, codeType: null, code: null, amountNet: '-1.0000', amountGross: '-1.2000' },
        ]
      }
      return []
    })

    const { em, removed } = makeEm()
    const container = makeContainer({ evaluate })

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings: [],
      createdGiftLines: [],
      removedGiftLines: [],
    })
    await phase()

    expect(removed).toHaveLength(1)
    expect(removed[0].id).toBe('app-automatic')
  })

  it('TC-CART-PROM-04: a lapsed reservation (extendReservation ran, but the CodeReservation row is gone) removes the application row, excludes the code from evaluate(), and surfaces a promotion_no_longer_valid warning', async () => {
    const cart = makeCart()
    const line = makeLine({ id: 'line-1' })
    const lines = [line]

    const evaluate = jest.fn(async () => ({ appliedPromotions: [] }))
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CartPromotionApplication) {
        return [
          { id: 'app-lapsed', promotionId: 'promo-lapsed', cartLineId: 'line-1', codeId: 'code-lapsed', codeType: 'static', code: 'GONE', amountNet: '-1.0000', amountGross: '-1.2000' },
        ]
      }
      return []
    })

    // No `reservedCodeIds` entry for 'code-lapsed' — `em.findOne` resolves `null` for it,
    // simulating a reservation the promotions-side sweeper already released independently.
    const { em, removed } = makeEm()
    const container = makeContainer({ evaluate })
    const warnings: any[] = []

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings,
      createdGiftLines: [],
      removedGiftLines: [],
    })
    await phase()

    expect(container.extendReservation).toHaveBeenCalledWith('code-lapsed', 'cart-1')
    const input = container.evaluate.mock.calls[0][0]
    expect(input.codes).toEqual([])
    expect(removed).toHaveLength(1)
    expect(removed[0].id).toBe('app-lapsed')
    expect(warnings).toEqual([{ code: 'promotion_no_longer_valid', promotionId: 'promo-lapsed' }])
  })

  it('TC-CART-PROM-apply-05: a promotion whose code-bearing effect moves to a different line carries its code linkage onto the freshly created row', async () => {
    const cart = makeCart()
    const line1 = makeLine({ id: 'line-1' })
    const line2 = makeLine({ id: 'line-2', productId: 'product-2' })
    const lines = [line1, line2]

    // The SAME promotion now targets line-2 instead of line-1 (e.g. line-1's quantity
    // dropped below the benefit's minimum).
    const evaluate = jest.fn(async () => ({
      appliedPromotions: [
        {
          promotionId: 'promo-moved',
          promotionName: 'Moved discount',
          effects: [
            {
              type: 'LINE_DISCOUNT',
              appliesTo: 'line',
              currency: 'USD',
              label: { en: 'Moved discount' },
              targetLineId: 'line-2',
              targetProductId: 'product-2',
              targetVariantId: null,
              lineQuantity: 2,
              appliedQuantity: 2,
              amountNet: '-1.0000',
              amountGross: '-1.2000',
              basis: 'net',
            },
          ],
        },
      ],
    }))
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CartPromotionApplication) {
        return [
          { id: 'app-old', promotionId: 'promo-moved', cartLineId: 'line-1', codeId: 'code-moved', codeType: 'dynamic', code: 'MOVE', amountNet: '-1.0000', amountGross: '-1.2000' },
        ]
      }
      return []
    })

    const { em, persisted, removed } = makeEm({ reservedCodeIds: ['code-moved'] })
    const container = makeContainer({ evaluate })

    const phase = buildPromotionsEffectsPhase({
      em,
      container,
      cart,
      lines,
      assortmentScope: undefined,
      tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      now: new Date('2026-02-01T00:00:00.000Z'),
      adjustments: [],
      warnings: [],
      createdGiftLines: [],
      removedGiftLines: [],
    })
    await phase()

    // The OLD row (keyed to line-1) is gone; a NEW row (keyed to line-2) was created
    // carrying the SAME code linkage forward, not nulled out.
    expect(removed).toHaveLength(1)
    expect(removed[0].id).toBe('app-old')
    const newApplication = persisted.find((row) => row.cartLineId === 'line-2')
    expect(newApplication).toMatchObject({
      promotionId: 'promo-moved',
      cartLineId: 'line-2',
      codeId: 'code-moved',
      codeType: 'dynamic',
      code: 'MOVE',
    })
  })
})
