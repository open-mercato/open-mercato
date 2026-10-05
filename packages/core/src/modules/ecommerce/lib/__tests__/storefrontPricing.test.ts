import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { buildPriceRowFilter, selectBestPrice, type PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import type { OmnibusBlock, OmnibusResolutionRequest } from '@open-mercato/core/modules/catalog/lib/omnibusTypes'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { SalesTaxRate } from '@open-mercato/core/modules/sales/data/entities'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import {
  buildStorefrontPricingContext,
  resolveStorefrontPrices,
  selectStorefrontTaxRate,
} from '../storefrontPricing'
import type { BuyerContext, StoreContext } from '../types'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/catalog/lib/omnibusPresentedEntry', () => ({
  ...jest.requireActual('@open-mercato/core/modules/catalog/lib/omnibusPresentedEntry'),
  resolveOmnibusPresentedEntries: jest.fn(async (_em: unknown, prices: Array<{ id: string }>) => {
    const entries = new Map<string, { priceId: string; changeType: 'update'; recordedAt: Date }>()
    for (const price of prices) {
      entries.set(price.id, { priceId: price.id, changeType: 'update', recordedAt: new Date('2026-09-01T00:00:00Z') })
    }
    return entries
  }),
}))

const mockedFind = findWithDecryption as jest.Mock

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const CHANNEL_ID = 'channel-1'
const NOW = new Date('2026-10-05T12:00:00Z')

type PriceKindFixture = { id: string; code: string; isPromotion: boolean; displayMode: string }

const REGULAR_KIND: PriceKindFixture = { id: 'pk-regular', code: 'regular', isPromotion: false, displayMode: 'including-tax' }
const PROMO_KIND: PriceKindFixture = { id: 'pk-promo', code: 'promotion', isPromotion: true, displayMode: 'including-tax' }
const GROUP_KIND: PriceKindFixture = { id: 'pk-group', code: 'wholesale', isPromotion: false, displayMode: 'excluding-tax' }

type RowInput = {
  id: string
  productId?: string | null
  variantId?: string | null
  kind?: PriceKindFixture
  net?: string | null
  gross?: string | null
  taxRate?: string | null
  minQuantity?: number
  maxQuantity?: number | null
  customerId?: string | null
  customerGroupId?: string | null
  channelId?: string | null
  currencyCode?: string
}

function priceRow(input: RowInput): PriceRow {
  const kind = input.kind ?? REGULAR_KIND
  return {
    id: input.id,
    product: input.productId ? { id: input.productId } : null,
    variant: input.variantId ? { id: input.variantId } : null,
    offer: null,
    priceKind: { ...kind },
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    currencyCode: input.currencyCode ?? 'EUR',
    kind: kind.code,
    minQuantity: input.minQuantity ?? 1,
    maxQuantity: input.maxQuantity ?? null,
    unitPriceNet: input.net === undefined ? null : input.net,
    unitPriceGross: input.gross === undefined ? null : input.gross,
    taxRate: input.taxRate ?? null,
    taxAmount: null,
    channelId: input.channelId ?? null,
    userId: null,
    userGroupId: null,
    customerId: input.customerId ?? null,
    customerGroupId: input.customerGroupId ?? null,
    metadata: null,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  } as unknown as PriceRow
}

type TaxRateInput = { id: string; rate: string; customerGroupId?: string | null; channelId?: string | null; priority?: number }

function taxRate(input: TaxRateInput) {
  return {
    id: input.id,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    name: input.id,
    code: input.id,
    rate: input.rate,
    customerGroupId: input.customerGroupId ?? null,
    channelId: input.channelId ?? null,
    productCategoryId: null,
    priority: input.priority ?? 0,
    isDefault: false,
    startsAt: null,
    endsAt: null,
    deletedAt: null,
  }
}

function fieldValue(record: Record<string, unknown>, key: string): unknown {
  const value = record[key]
  if (value && typeof value === 'object' && !(value instanceof Date) && 'id' in value) {
    return (value as { id: unknown }).id
  }
  return value ?? null
}

function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') return (condition as Array<Record<string, unknown>>).every((part) => matchesWhere(record, part))
    if (key === '$or') return (condition as Array<Record<string, unknown>>).some((part) => matchesWhere(record, part))
    const actual = fieldValue(record, key)
    if (condition === null) return actual === null
    if (condition && typeof condition === 'object' && '$in' in condition) {
      return ((condition as { $in: unknown[] }).$in).includes(actual)
    }
    return actual === condition
  })
}

type Fixture = { rows: PriceRow[]; taxRates?: ReturnType<typeof taxRate>[] }

const fetchedRowCounts: number[] = []

function installFixture(fixture: Fixture) {
  fetchedRowCounts.length = 0
  mockedFind.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === CatalogProductPrice) {
      const matched = fixture.rows.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
      fetchedRowCounts.push(matched.length)
      return matched
    }
    if (entity === SalesTaxRate) {
      return (fixture.taxRates ?? []).filter((rate) => matchesWhere(rate as unknown as Record<string, unknown>, where))
    }
    return []
  })
}

function priceRowCalls() {
  return mockedFind.mock.calls.filter(([, entity]) => entity === CatalogProductPrice)
}

function taxRateCalls() {
  return mockedFind.mock.calls.filter(([, entity]) => entity === SalesTaxRate)
}

function makeBuyer(overrides: Partial<BuyerContext> = {}): BuyerContext {
  return {
    customerUserId: null,
    customerId: null,
    companyId: null,
    customerIds: [],
    customerGroupIds: [],
    isAuthenticated: false,
    taxMode: 'gross',
    priceKindId: null,
    allowPurchaseOnAccount: false,
    approvalRequiredAbove: null,
    assortmentScope: null,
    assortmentScopeHash: 'none',
    priceScopeKey: 'key',
    customerOverlayId: null,
    ...overrides,
  }
}

function makeContext(
  buyer: Partial<BuyerContext> = {},
  overrides: { channelPriceKindId?: string | null; locale?: string; currencyCode?: string } = {},
): StoreContext {
  return {
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'pl'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    channel: {
      channelBindingId: 'binding-1',
      salesChannelId: CHANNEL_ID,
      priceKindId: overrides.channelPriceKindId ?? null,
      priceSortFallback: 'approximate',
    },
    buyer: makeBuyer(buyer),
    effectiveLocale: overrides.locale ?? 'en',
    requestedLocale: null,
    currencyCode: overrides.currencyCode ?? 'EUR',
    digest: 'digest',
  }
}

type OmnibusFake = { resolveOmnibusBlocks: jest.Mock }

function makeContainer(options: { pricing?: unknown; omnibus?: OmnibusFake | null; withoutPricing?: boolean } = {}) {
  const services: Record<string, unknown> = {
    em: {},
    catalogPricingService: options.withoutPricing ? undefined : options.pricing ?? new DefaultCatalogPricingService(null),
    catalogOmnibusService: options.omnibus === null ? undefined : options.omnibus,
  }
  return {
    resolve: (name: string) => {
      const service = services[name]
      if (service === undefined) throw new Error(`not registered: ${name}`)
      return service
    },
  }
}

function omnibusBlock(overrides: Partial<OmnibusBlock> = {}): OmnibusBlock {
  return {
    presentedPriceKindId: REGULAR_KIND.id,
    lookbackDays: 30,
    minimizationAxis: 'gross',
    promotionAnchorAt: null,
    windowStart: '2026-09-05T12:00:00.000Z',
    windowEnd: '2026-10-05T12:00:00.000Z',
    coverageStartAt: null,
    lowestPriceNet: '73.1707',
    lowestPriceGross: '90.0000',
    previousPriceNet: null,
    previousPriceGross: null,
    currencyCode: 'EUR',
    applicable: true,
    applicabilityReason: 'announced_promotion',
    ...overrides,
  }
}

beforeEach(() => {
  mockedFind.mockReset()
})

describe('buildStorefrontPricingContext', () => {
  it('builds the context from the buyer with the group price kind overriding the channel default', () => {
    const ctx = makeContext(
      {
        priceKindId: GROUP_KIND.id,
        customerId: 'person-1',
        companyId: 'company-1',
        customerIds: ['person-1', 'company-1'],
        customerGroupIds: ['group-a', 'group-b'],
      },
      { channelPriceKindId: REGULAR_KIND.id },
    )
    const pricingContext = buildStorefrontPricingContext(ctx, { date: NOW })
    expect(pricingContext).toEqual({
      channelId: CHANNEL_ID,
      priceKindId: GROUP_KIND.id,
      customerId: 'person-1',
      customerIds: ['person-1', 'company-1'],
      customerGroupIds: ['group-a', 'group-b'],
      currencyCode: 'EUR',
      quantity: 1,
      date: NOW,
    })
  })

  it('falls back to the channel price kind and honours quantity overrides', () => {
    const ctx = makeContext({}, { channelPriceKindId: REGULAR_KIND.id })
    const pricingContext = buildStorefrontPricingContext(ctx, { quantity: 25, date: NOW })
    expect(pricingContext.priceKindId).toBe(REGULAR_KIND.id)
    expect(pricingContext.quantity).toBe(25)
    expect(pricingContext.customerIds).toEqual([])
  })
})

describe('resolveStorefrontPrices — batched narrowed fetch', () => {
  function contractRows(count: number): PriceRow[] {
    return Array.from({ length: count }, (_, index) =>
      priceRow({ id: `contract-${index}`, productId: 'p1', gross: '50.00', net: '40.65', customerId: `other-customer-${index}` }),
    )
  }

  it('issues one narrowed price-row query per page and ignores other customers contract rows', async () => {
    const baseRows = [
      priceRow({ id: 'p1-list', productId: 'p1', gross: '100.00', net: '81.30' }),
      priceRow({ id: 'p1-own', productId: 'p1', gross: '70.00', net: '56.91', customerId: 'person-1' }),
      priceRow({ id: 'p2-list', productId: 'p2', gross: '20.00', net: '16.26' }),
      priceRow({ id: 'v1-list', productId: 'p2', variantId: 'v1', gross: '25.00', net: '20.33' }),
    ]
    const ctx = makeContext({ customerId: 'person-1', companyId: 'company-1', customerIds: ['person-1', 'company-1'] })
    const items = [
      { productId: 'p1', variantIds: [] },
      { productId: 'p2', variantIds: ['v1'] },
    ]

    installFixture({ rows: [...baseRows, ...contractRows(5)] })
    const small = await resolveStorefrontPrices(makeContainer({ omnibus: null }), ctx, items, { date: NOW })
    const smallCount = fetchedRowCounts[0]

    expect(priceRowCalls()).toHaveLength(1)
    const [, , where, options, scope] = priceRowCalls()[0]
    const pricingContext = buildStorefrontPricingContext(ctx, { date: NOW })
    expect(where.$and[0]).toEqual(buildPriceRowFilter(pricingContext))
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toBe(ORGANIZATION_ID)
    expect(options.populate).toEqual(expect.arrayContaining(['priceKind']))
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })

    mockedFind.mockReset()
    installFixture({ rows: [...baseRows, ...contractRows(500)] })
    const large = await resolveStorefrontPrices(makeContainer({ omnibus: null }), ctx, items, { date: NOW })
    expect(fetchedRowCounts[0]).toBe(smallCount)
    expect(smallCount).toBe(baseRows.length)

    expect(small.get('p1')?.price?.amount).toBe(70)
    expect(large.get('p1')?.price?.amount).toBe(70)
    const unnarrowed = selectBestPrice(
      [...baseRows, ...contractRows(500)].filter((row) => (row.product as { id: string } | null)?.id === 'p1'),
      pricingContext,
    )
    expect(unnarrowed?.id).toBe('p1-own')
  })

  it('applies registered resolvers through catalogPricingService and falls back to selectBestPrice when absent', async () => {
    const rows = [
      priceRow({ id: 'p1-list', productId: 'p1', gross: '100.00', net: '81.30' }),
      priceRow({ id: 'p1-alt', productId: 'p1', gross: '60.00', net: '48.78' }),
    ]
    installFixture({ rows })
    const resolvePriceMany = jest.fn(async (entries: Array<{ rows: PriceRow[] }>) =>
      entries.map((entry) => entry.rows.find((row) => row.id === 'p1-alt') ?? null),
    )
    const viaService = await resolveStorefrontPrices(
      makeContainer({ pricing: { resolvePriceMany, resolvePrice: jest.fn() }, omnibus: null }),
      makeContext(),
      [{ productId: 'p1', variantIds: [] }],
      { date: NOW },
    )
    expect(resolvePriceMany).toHaveBeenCalled()
    expect(viaService.get('p1')?.price?.amount).toBe(60)

    const fallback = await resolveStorefrontPrices(
      makeContainer({ withoutPricing: true, omnibus: null }),
      makeContext(),
      [{ productId: 'p1', variantIds: [] }],
      { date: NOW },
    )
    expect(fallback.get('p1')?.price).not.toBeNull()
  })

  it('returns an empty map without querying when the page has no items', async () => {
    installFixture({ rows: [] })
    const result = await resolveStorefrontPrices(makeContainer(), makeContext(), [])
    expect(result.size).toBe(0)
    expect(mockedFind).not.toHaveBeenCalled()
  })
})

describe('resolveStorefrontPrices — tax mode', () => {
  const rows = [priceRow({ id: 'p1-list', productId: 'p1', gross: '123.00', net: '100.00' })]

  it('takes the gross side for gross buyers and the net side for net buyers', async () => {
    installFixture({ rows })
    const gross = await resolveStorefrontPrices(makeContainer({ omnibus: null }), makeContext({ taxMode: 'gross' }), [
      { productId: 'p1', variantIds: [] },
    ])
    expect(gross.get('p1')?.price).toMatchObject({ amount: 123, displayMode: 'gross', currencyCode: 'EUR' })

    const net = await resolveStorefrontPrices(makeContainer({ omnibus: null }), makeContext({ taxMode: 'net' }), [
      { productId: 'p1', variantIds: [] },
    ])
    expect(net.get('p1')?.price).toMatchObject({ amount: 100, displayMode: 'net' })
    expect(taxRateCalls()).toHaveLength(0)
  })

  it('derives the missing side from the row tax rate before consulting SalesTaxRate', async () => {
    installFixture({ rows: [priceRow({ id: 'p1-net', productId: 'p1', net: '100.00', gross: null, taxRate: '23' })] })
    const result = await resolveStorefrontPrices(makeContainer({ omnibus: null }), makeContext({ taxMode: 'gross' }), [
      { productId: 'p1', variantIds: [] },
    ])
    expect(result.get('p1')?.price?.amount).toBe(123)
    expect(taxRateCalls()).toHaveLength(0)
  })

  it('derives through SalesTaxRate by the multi-group rule and loads tax rates once per page', async () => {
    installFixture({
      rows: [
        priceRow({ id: 'p1-net', productId: 'p1', net: '100.00', gross: null }),
        priceRow({ id: 'p2-net', productId: 'p2', net: '200.00', gross: null }),
      ],
      taxRates: [
        taxRate({ id: 'ungrouped', rate: '23.0000' }),
        taxRate({ id: 'group-b-rate', rate: '8.0000', customerGroupId: 'group-b' }),
        taxRate({ id: 'group-a-rate', rate: '5.0000', customerGroupId: 'group-a' }),
        taxRate({ id: 'foreign-group', rate: '0.0000', customerGroupId: 'group-z' }),
      ],
    })
    const items = [
      { productId: 'p1', variantIds: [] },
      { productId: 'p2', variantIds: [] },
    ]
    const grouped = await resolveStorefrontPrices(
      makeContainer({ omnibus: null }),
      makeContext({ taxMode: 'gross', customerGroupIds: ['group-a', 'group-b'] }),
      items,
    )
    expect(grouped.get('p1')?.price?.amount).toBe(105)
    expect(grouped.get('p2')?.price?.amount).toBe(210)
    expect(taxRateCalls()).toHaveLength(1)

    const ungrouped = await resolveStorefrontPrices(
      makeContainer({ omnibus: null }),
      makeContext({ taxMode: 'gross', customerGroupIds: ['group-c'] }),
      items,
    )
    expect(ungrouped.get('p1')?.price?.amount).toBe(123)
  })

  it('leaves the price unresolved when no tax rate can derive the missing side', async () => {
    installFixture({ rows: [priceRow({ id: 'p1-net', productId: 'p1', net: '100.00', gross: null })], taxRates: [] })
    const result = await resolveStorefrontPrices(makeContainer({ omnibus: null }), makeContext({ taxMode: 'gross' }), [
      { productId: 'p1', variantIds: [] },
    ])
    expect(result.get('p1')?.price).toBeNull()
  })

  it('formats amounts with the shared currency formatter for the effective locale', async () => {
    installFixture({ rows: [priceRow({ id: 'p1', productId: 'p1', gross: '129.00', net: '104.88', currencyCode: 'PLN' })] })
    const result = await resolveStorefrontPrices(
      makeContainer({ omnibus: null }),
      makeContext({ taxMode: 'gross' }, { locale: 'pl', currencyCode: 'PLN' }),
      [{ productId: 'p1', variantIds: [] }],
    )
    expect(result.get('p1')?.price?.formatted).toBe(formatCurrency(129, 'PLN', 'pl'))
  })
})

describe('selectStorefrontTaxRate', () => {
  const rates = [
    { ...taxRate({ id: 'ungrouped', rate: '23' }) },
    { ...taxRate({ id: 'b', rate: '8', customerGroupId: 'group-b' }) },
    { ...taxRate({ id: 'a', rate: '5', customerGroupId: 'group-a' }) },
  ]

  it('prefers the highest-priority group in customerGroupIds order', () => {
    expect(selectStorefrontTaxRate(rates, ['group-b', 'group-a'], NOW)).toBe(8)
    expect(selectStorefrontTaxRate(rates, ['group-a', 'group-b'], NOW)).toBe(5)
  })

  it('skips groups without a rate and falls back to the ungrouped rate', () => {
    expect(selectStorefrontTaxRate(rates, ['group-x', 'group-b'], NOW)).toBe(8)
    expect(selectStorefrontTaxRate(rates, ['group-x'], NOW)).toBe(23)
    expect(selectStorefrontTaxRate([], ['group-x'], NOW)).toBeNull()
  })

  it('ignores rates outside their validity window', () => {
    const expired = { ...taxRate({ id: 'expired', rate: '3', customerGroupId: 'group-a' }), endsAt: new Date('2026-01-01') }
    expect(selectStorefrontTaxRate([expired, rates[0]], ['group-a'], NOW)).toBe(23)
  })
})

describe('resolveStorefrontPrices — promotions and Omnibus', () => {
  const rows = [
    priceRow({ id: 'p1-list', productId: 'p1', gross: '100.00', net: '81.30' }),
    priceRow({ id: 'p1-promo', productId: 'p1', kind: PROMO_KIND, gross: '80.00', net: '65.04' }),
    priceRow({ id: 'p2-list', productId: 'p2', gross: '50.00', net: '40.65' }),
  ]
  const items = [
    { productId: 'p1', variantIds: [] },
    { productId: 'p2', variantIds: [] },
  ]

  it('presents a promotion with original and Omnibus lowest prior amounts from one batched call', async () => {
    installFixture({ rows })
    const omnibus: OmnibusFake = {
      resolveOmnibusBlocks: jest.fn(async (_em: unknown, requests: OmnibusResolutionRequest[]) =>
        requests.map(() => omnibusBlock()),
      ),
    }
    const result = await resolveStorefrontPrices(makeContainer({ omnibus }), makeContext({ taxMode: 'gross' }), items, {
      date: NOW,
    })
    const price = result.get('p1')?.price
    expect(price).toMatchObject({
      amount: 80,
      isPromotion: true,
      originalAmount: 100,
      lowestPriorAmount: 90,
      formattedOriginal: formatCurrency(100, 'EUR', 'en'),
      formattedLowestPrior: formatCurrency(90, 'EUR', 'en'),
    })
    expect(result.get('p2')?.price).toMatchObject({ amount: 50, isPromotion: false, originalAmount: null, lowestPriorAmount: null })
    expect(omnibus.resolveOmnibusBlocks).toHaveBeenCalledTimes(1)
    const [, requests] = omnibus.resolveOmnibusBlocks.mock.calls[0] as [unknown, OmnibusResolutionRequest[]]
    expect(requests).toHaveLength(1)
    expect(requests[0].context).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      productId: 'p1',
      channelId: CHANNEL_ID,
      priceKindId: PROMO_KIND.id,
      currencyCode: 'EUR',
      isStorefront: true,
    })
    expect(requests[0].priceKindIsPromotion).toBe(true)
    expect(requests[0].presentedEntry).toMatchObject({ priceId: 'p1-promo' })
    expect(priceRowCalls()).toHaveLength(1)
  })

  it('uses the net Omnibus side for net buyers', async () => {
    installFixture({ rows })
    const omnibus: OmnibusFake = {
      resolveOmnibusBlocks: jest.fn(async (_em: unknown, requests: OmnibusResolutionRequest[]) =>
        requests.map(() => omnibusBlock()),
      ),
    }
    const result = await resolveStorefrontPrices(makeContainer({ omnibus }), makeContext({ taxMode: 'net' }), items)
    expect(result.get('p1')?.price).toMatchObject({ amount: 65.04, originalAmount: 81.3, lowestPriorAmount: 73.1707 })
  })

  it.each([
    ['not applicable', omnibusBlock({ applicable: false, applicabilityReason: 'not_in_eu_market', lowestPriceGross: null, lowestPriceNet: null })],
    ['disabled (null block)', null],
    ['without a lowest price', omnibusBlock({ lowestPriceGross: null, lowestPriceNet: null, applicabilityReason: 'no_history' })],
  ])('suppresses promotion presentation when Omnibus is %s', async (_label, block) => {
    installFixture({ rows })
    const omnibus: OmnibusFake = {
      resolveOmnibusBlocks: jest.fn(async (_em: unknown, requests: OmnibusResolutionRequest[]) => requests.map(() => block)),
    }
    const result = await resolveStorefrontPrices(makeContainer({ omnibus }), makeContext({ taxMode: 'gross' }), items)
    expect(result.get('p1')?.price).toMatchObject({
      amount: 80,
      isPromotion: false,
      originalAmount: null,
      formattedOriginal: null,
      lowestPriorAmount: null,
      formattedLowestPrior: null,
    })
  })

  it('suppresses promotion presentation when the Omnibus service is not registered', async () => {
    installFixture({ rows })
    const result = await resolveStorefrontPrices(makeContainer({ omnibus: null }), makeContext({ taxMode: 'gross' }), items)
    expect(result.get('p1')?.price).toMatchObject({ amount: 80, isPromotion: false, originalAmount: null, lowestPriorAmount: null })
  })

  it('suppresses promotion presentation when Omnibus resolution throws', async () => {
    installFixture({ rows })
    const omnibus: OmnibusFake = { resolveOmnibusBlocks: jest.fn(async () => Promise.reject(new Error('boom'))) }
    const result = await resolveStorefrontPrices(makeContainer({ omnibus }), makeContext({ taxMode: 'gross' }), items)
    expect(result.get('p1')?.price).toMatchObject({ amount: 80, isPromotion: false, lowestPriorAmount: null })
  })
})

describe('resolveStorefrontPrices — price tiers', () => {
  const rows = [
    priceRow({ id: 'tier-1', productId: 'p1', gross: '100.00', net: '81.30', minQuantity: 1 }),
    priceRow({ id: 'tier-10', productId: 'p1', gross: '90.00', net: '73.17', minQuantity: 10 }),
    priceRow({ id: 'tier-50', productId: 'p1', gross: '80.00', net: '65.04', minQuantity: 50 }),
    priceRow({ id: 'tier-50-other', productId: 'p1', gross: '10.00', net: '8.13', minQuantity: 50, customerId: 'other-customer' }),
  ]

  it('resolves quantity breaks for the buyer on detail from the same batch', async () => {
    installFixture({ rows })
    const result = await resolveStorefrontPrices(
      makeContainer({ omnibus: null }),
      makeContext({ taxMode: 'gross' }),
      [{ productId: 'p1', variantIds: [] }],
      { detail: true },
    )
    const pricing = result.get('p1')
    expect(pricing?.price?.amount).toBe(100)
    expect(pricing?.priceTiers).toEqual([
      { minQuantity: 1, maxQuantity: 9, amount: 100, formatted: formatCurrency(100, 'EUR', 'en') },
      { minQuantity: 10, maxQuantity: 49, amount: 90, formatted: formatCurrency(90, 'EUR', 'en') },
      { minQuantity: 50, maxQuantity: null, amount: 80, formatted: formatCurrency(80, 'EUR', 'en') },
    ])
    expect(priceRowCalls()).toHaveLength(1)
  })

  it('omits tiers on list resolution and when only one price applies', async () => {
    installFixture({ rows })
    const list = await resolveStorefrontPrices(makeContainer({ omnibus: null }), makeContext(), [
      { productId: 'p1', variantIds: [] },
    ])
    expect(list.get('p1')?.priceTiers).toEqual([])

    installFixture({ rows: [priceRow({ id: 'single', productId: 'p1', gross: '100.00', net: '81.30' })] })
    const single = await resolveStorefrontPrices(
      makeContainer({ omnibus: null }),
      makeContext(),
      [{ productId: 'p1', variantIds: [] }],
      { detail: true },
    )
    expect(single.get('p1')?.priceTiers).toEqual([])
  })
})

describe('resolveStorefrontPrices — variants and price range', () => {
  it('resolves per-variant prices with product-level fallback and a min/max range', async () => {
    installFixture({
      rows: [
        priceRow({ id: 'base', productId: 'p1', gross: '60.00', net: '48.78' }),
        priceRow({ id: 'v1-row', productId: 'p1', variantId: 'v1', gross: '50.00', net: '40.65' }),
        priceRow({ id: 'v2-row', productId: 'p1', variantId: 'v2', gross: '70.00', net: '56.91' }),
      ],
    })
    const result = await resolveStorefrontPrices(
      makeContainer({ omnibus: null }),
      makeContext({ taxMode: 'gross' }),
      [{ productId: 'p1', variantIds: ['v1', 'v2', 'v3'] }],
      { detail: true },
    )
    const pricing = result.get('p1')
    expect(pricing?.variantPrices.get('v1')?.amount).toBe(50)
    expect(pricing?.variantPrices.get('v2')?.amount).toBe(70)
    expect(pricing?.variantPrices.get('v3')?.amount).toBe(60)
    expect(pricing?.priceRange).toEqual({
      min: 50,
      max: 70,
      formattedMin: formatCurrency(50, 'EUR', 'en'),
      formattedMax: formatCurrency(70, 'EUR', 'en'),
    })
  })

  it('returns a null range for simple products and null prices when nothing matches', async () => {
    installFixture({ rows: [priceRow({ id: 'other-currency', productId: 'p1', gross: '60.00', currencyCode: 'USD' })] })
    const result = await resolveStorefrontPrices(makeContainer({ omnibus: null }), makeContext(), [
      { productId: 'p1', variantIds: [] },
      { productId: 'p2', variantIds: ['v9'] },
    ])
    expect(result.get('p1')).toMatchObject({ price: null, priceRange: null, priceTiers: [] })
    expect(result.get('p2')?.priceRange).toBeNull()
    expect(result.get('p2')?.variantPrices.get('v9')).toBeNull()
  })
})
