import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DefaultCatalogPricingService } from '../catalogPricingService'
import { DefaultCatalogBuyerPricingService, type BuyerPricingContext } from '../catalogBuyerPricingService'
import type { PriceRow } from '../../lib/pricing'

type MockTaxRate = {
  id: string
  tenantId: string
  organizationId: string
  rate: string
  customerGroupId: string | null
  channelId: string | null
  productCategoryId: string | null
  priority: number
  isDefault: boolean
  code: string
  startsAt: Date | null
  endsAt: Date | null
  deletedAt: null
}

const mockTaxRateStore: MockTaxRate[] = []

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    const tenantId = where.tenantId as string
    const organizationId = where.organizationId as string
    return mockTaxRateStore.filter((rate) => rate.tenantId === tenantId && rate.organizationId === organizationId)
  }),
}))

const findMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const TENANT = 'tenant-1'
const ORG = 'org-1'
const em = {} as EntityManager
const scope = { tenantId: TENANT, organizationId: ORG }

function baseRow(overrides: Partial<PriceRow> = {}): PriceRow {
  return {
    id: overrides.id ?? 'price-id',
    organizationId: ORG,
    tenantId: TENANT,
    currencyCode: 'USD',
    priceKind: { id: 'pk-regular', code: 'regular', isPromotion: false } as any,
    kind: 'regular',
    minQuantity: 1,
    unitPriceNet: '10.00',
    unitPriceGross: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as PriceRow
}

function baseContext(overrides: Partial<BuyerPricingContext> = {}): BuyerPricingContext {
  return {
    channelId: null,
    customerId: null,
    customerIds: [],
    customerGroupId: null,
    customerGroupIds: [],
    currencyCode: 'USD',
    quantity: 1,
    date: new Date('2024-02-01T00:00:00Z'),
    ...overrides,
  }
}

function addTaxRate(overrides: Partial<MockTaxRate> = {}): MockTaxRate {
  const rate: MockTaxRate = {
    id: overrides.id ?? `rate-${mockTaxRateStore.length + 1}`,
    tenantId: TENANT,
    organizationId: ORG,
    rate: '23.0000',
    customerGroupId: null,
    channelId: null,
    productCategoryId: null,
    priority: 0,
    isDefault: true,
    code: 'standard',
    startsAt: null,
    endsAt: null,
    deletedAt: null,
    ...overrides,
  }
  mockTaxRateStore.push(rate)
  return rate
}

function buildService(): DefaultCatalogBuyerPricingService {
  return new DefaultCatalogBuyerPricingService(new DefaultCatalogPricingService(null))
}

beforeEach(() => {
  mockTaxRateStore.length = 0
  findMock.mockClear()
})

describe('DefaultCatalogBuyerPricingService.resolveLinePrice', () => {
  it('selects the winning price row and derives the missing side from the resolved tax rate', async () => {
    addTaxRate({ rate: '20.0000' })
    const rows = [baseRow({ id: 'regular', unitPriceNet: '10.00', unitPriceGross: null })]

    const result = await buildService().resolveLinePrice(em, rows, baseContext(), scope)

    expect(result.priceRow?.id).toBe('regular')
    expect(result.amountNet).toBe(10)
    expect(result.amountGross).toBe(12)
    expect(result.taxRatePercent).toBe(20)
    expect(result.priceIsPromotional).toBe(false)
  })

  it('uses the row-carried tax rate instead of querying for a fallback when present', async () => {
    const rows = [baseRow({ id: 'with-rate', unitPriceNet: '10.00', unitPriceGross: null, taxRate: '15.0000' } as any)]

    const result = await buildService().resolveLinePrice(em, rows, baseContext(), scope)

    expect(result.amountGross).toBe(11.5)
    expect(result.taxRatePercent).toBe(15)
    expect(findMock).not.toHaveBeenCalled()
  })

  it('prefers the active customer-group tax rate over the ungrouped default', async () => {
    addTaxRate({ rate: '23.0000', customerGroupId: null })
    addTaxRate({ rate: '5.0000', customerGroupId: 'group-a' })
    const rows = [baseRow({ unitPriceNet: '100.00', unitPriceGross: null })]

    const result = await buildService().resolveLinePrice(
      em,
      rows,
      baseContext({ customerGroupIds: ['group-a'] }),
      scope,
    )

    expect(result.taxRatePercent).toBe(5)
    expect(result.amountGross).toBe(105)
  })

  it('flags priceIsPromotional when the winning row is a promotional price kind', async () => {
    addTaxRate({ rate: '0.0000' })
    const rows = [
      baseRow({ id: 'regular', unitPriceNet: '10.00', unitPriceGross: null }),
      baseRow({
        id: 'promo',
        unitPriceNet: '8.00',
        unitPriceGross: null,
        priceKind: { id: 'pk-promo', code: 'promotion', isPromotion: true } as any,
        kind: 'promotion',
      }),
    ]

    const result = await buildService().resolveLinePrice(em, rows, baseContext(), scope)

    expect(result.priceRow?.id).toBe('promo')
    expect(result.priceIsPromotional).toBe(true)
  })

  it('returns a null price and no tiers when no row matches', async () => {
    const result = await buildService().resolveLinePrice(em, [], baseContext(), scope)

    expect(result.priceRow).toBeNull()
    expect(result.amountNet).toBeNull()
    expect(result.amountGross).toBeNull()
    expect(result.priceIsPromotional).toBe(false)
    expect(result.tiers).toEqual([])
    expect(result.currentTier).toBeNull()
    expect(result.nextTier).toBeNull()
  })

  it('collapses quantity tiers and resolves the current and next tier for the requested quantity', async () => {
    addTaxRate({ rate: '0.0000' })
    const rows = [
      baseRow({ id: 'tier-1', minQuantity: 1, unitPriceNet: '10.00', unitPriceGross: null }),
      baseRow({ id: 'tier-5', minQuantity: 5, unitPriceNet: '9.00', unitPriceGross: null }),
      baseRow({ id: 'tier-10', minQuantity: 10, unitPriceNet: '8.00', unitPriceGross: null }),
    ]

    const atFive = await buildService().resolveLinePrice(em, rows, baseContext({ quantity: 5 }), scope)
    expect(atFive.tiers).toEqual([
      { minQuantity: 1, maxQuantity: 4, amountNet: 10, amountGross: 10 },
      { minQuantity: 5, maxQuantity: 9, amountNet: 9, amountGross: 9 },
      { minQuantity: 10, maxQuantity: null, amountNet: 8, amountGross: 8 },
    ])
    expect(atFive.currentTier).toEqual({ minQuantity: 5, maxQuantity: 9, amountNet: 9, amountGross: 9 })
    expect(atFive.nextTier).toEqual({ minQuantity: 10, maxQuantity: null, amountNet: 8, amountGross: 8 })

    const atTwelve = await buildService().resolveLinePrice(em, rows, baseContext({ quantity: 12 }), scope)
    expect(atTwelve.currentTier).toEqual({ minQuantity: 10, maxQuantity: null, amountNet: 8, amountGross: 8 })
    expect(atTwelve.nextTier).toBeNull()
  })

  it('returns no tiers when every quantity resolves to the same price', async () => {
    addTaxRate({ rate: '0.0000' })
    const rows = [baseRow({ id: 'flat', minQuantity: 1, unitPriceNet: '10.00', unitPriceGross: null })]

    const result = await buildService().resolveLinePrice(em, rows, baseContext({ quantity: 3 }), scope)

    expect(result.tiers).toEqual([])
    expect(result.currentTier).toBeNull()
    expect(result.nextTier).toBeNull()
  })
})
