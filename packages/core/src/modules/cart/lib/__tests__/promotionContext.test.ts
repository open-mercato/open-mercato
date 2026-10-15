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

function makeEm(opts: { allLines?: Row[] } = {}) {
  let createCounter = 0
  const persisted: Row[] = []
  const removed: Row[] = []
  const em: any = {
    find: jest.fn(async () => opts.allLines ?? []),
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
  return {
    resolve: (token: string): any => {
      if (token === 'promotionsService') return { evaluate }
      if (token === 'catalogScopedProductService') return { loadScopedProducts }
      if (token === 'salesCalculationService') return { calculateLine }
      throw new Error(`Unexpected DI token: ${token}`)
    },
    evaluate,
    loadScopedProducts,
    calculateLine,
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
})
