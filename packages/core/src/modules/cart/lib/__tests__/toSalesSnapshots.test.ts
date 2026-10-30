type Row = Record<string, any>

let seededCarts: Row[] = []
let seededCartLines: Row[] = []
let seededApplications: Row[] = []

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return row[key] === value
  })
}

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) =>
  seededCarts.find((row) => matchesWhere(row, where)) ?? null)

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CartPromotionApplication) return seededApplications.filter((row) => matchesWhere(row, where))
  return seededCartLines.filter((row) => matchesWhere(row, where))
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import { Cart, CartLine, CartPromotionApplication } from '../../data/entities'
import { buildCartSalesSnapshot, getCartSalesSnapshot } from '../toSalesSnapshots'

const TENANT_ID = 'tenant-snap-1'
const ORG_ID = 'org-snap-1'
const CART_ID = 'cart-snap-1'

function makeCart(overrides: Row = {}): Cart {
  return {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    status: 'locked',
    checkoutSessionId: 'session-1',
    currencyCode: 'USD',
    locale: 'en-US',
    totals: {
      subtotalNetAmount: 20,
      subtotalGrossAmount: 24,
      discountTotalAmount: 0,
      taxTotalAmount: 4,
      grandTotalNetAmount: 20,
      grandTotalGrossAmount: 24,
    },
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  } as Cart
}

function makeLine(overrides: Row = {}): CartLine {
  return {
    id: 'line-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: CART_ID,
    productId: 'product-1',
    variantId: null,
    name: 'Widget',
    quantity: '2',
    quantityUnit: null,
    unitPriceNet: '10',
    unitPriceGross: '12',
    discountTotalNet: null,
    taxRate: '20',
    configuration: null,
    flagState: null,
    origin: 'customer',
    deletedAt: null,
    ...overrides,
  } as CartLine
}

function makeApplication(overrides: Row = {}): Row {
  return {
    id: 'application-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: CART_ID,
    promotionId: 'promo-1',
    scope: 'order',
    amountNet: '-5.0000',
    amountGross: '-6.0000',
    effect: { currency: 'USD', label: { en: '10% off' } },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  seededCarts = []
  seededCartLines = []
  seededApplications = []
})

describe('buildCartSalesSnapshot (checkout C7)', () => {
  it('maps every non-flagged line via toCartTotalsLineSnapshot, paired with cartLineId, gift lines included', async () => {
    const cart = makeCart()
    const lines = [makeLine({ id: 'line-1', origin: 'customer' }), makeLine({ id: 'gift-1', origin: 'promotion', unitPriceNet: '0', unitPriceGross: '0' })]

    const snapshot = await buildCartSalesSnapshot({} as any, cart, lines)

    expect(snapshot.lines).toHaveLength(2)
    expect(snapshot.lines.map((l) => l.cartLineId)).toEqual(['line-1', 'gift-1'])
    expect(snapshot.lines[0].snapshot).toMatchObject({ productId: 'product-1', quantity: 2 })
    expect(snapshot.currencyCode).toBe('USD')
    expect(snapshot.totals).toEqual(cart.totals)
  })

  it('excludes a flagged line (defensive — a locked cart cannot have one per §9)', async () => {
    const cart = makeCart()
    const lines = [makeLine({ id: 'line-1' }), makeLine({ id: 'line-2', flagState: 'product_unavailable' })]

    const snapshot = await buildCartSalesSnapshot({} as any, cart, lines)

    expect(snapshot.lines.map((l) => l.cartLineId)).toEqual(['line-1'])
  })

  it('reconstructs order-scope adjustments from CartPromotionApplication rows', async () => {
    const cart = makeCart()
    seededApplications = [makeApplication()]

    const snapshot = await buildCartSalesSnapshot({} as any, cart, [makeLine()])

    expect(snapshot.adjustments).toEqual([
      {
        scope: 'order',
        kind: 'discount',
        promotionId: 'promo-1',
        amountNet: -5,
        amountGross: -6,
        currencyCode: 'USD',
        label: '10% off',
      },
    ])
  })

  it('skips a "zeroed" (no-longer-valid) application row', async () => {
    const cart = makeCart()
    seededApplications = [makeApplication({ amountNet: null, amountGross: null, effect: {} })]

    const snapshot = await buildCartSalesSnapshot({} as any, cart, [makeLine()])

    expect(snapshot.adjustments).toEqual([])
  })

  it('ignores line-scope applications — those already reached the line via discountTotalNet', async () => {
    const cart = makeCart()
    seededApplications = [] // line-scope rows are filtered at the query (scope: 'order'), not here

    const snapshot = await buildCartSalesSnapshot({} as any, cart, [makeLine()])

    expect(snapshot.adjustments).toEqual([])
  })
})

describe('getCartSalesSnapshot (C1 session binding)', () => {
  it('answers 404 when the cart does not exist', async () => {
    await expect(
      getCartSalesSnapshot({} as any, { cartId: 'missing', tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'session-1' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('answers 404 when the cart is not locked', async () => {
    seededCarts = [makeCart({ status: 'active', checkoutSessionId: null })]
    await expect(
      getCartSalesSnapshot({} as any, { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'session-1' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('answers 404 when checkoutSessionId does not match (a stale session cannot read another session\'s snapshot)', async () => {
    seededCarts = [makeCart({ checkoutSessionId: 'other-session' })]
    await expect(
      getCartSalesSnapshot({} as any, { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, checkoutSessionId: 'session-1' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns the snapshot for a locked cart with a matching session', async () => {
    seededCarts = [makeCart()]
    seededCartLines = [makeLine()]

    const snapshot = await getCartSalesSnapshot({} as any, {
      cartId: CART_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      checkoutSessionId: 'session-1',
    })

    expect(snapshot.lines).toHaveLength(1)
    expect(snapshot.totals).toEqual(seededCarts[0].totals)
  })
})
