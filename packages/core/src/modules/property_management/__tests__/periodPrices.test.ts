/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { Building, Floor, ProductUse, Space, Unit, UnitProductPeriod } from '../data/entities'
import { periodPricesOf } from '../lib/productUse'
import { FakeEm } from './support/fakeEm'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const PRODUCT = '60000000-0000-4000-8000-000000000001'
const OTHER_PRODUCT = '60000000-0000-4000-8000-000000000002'
const BUILDING = '60000000-0000-4000-8000-000000000010'
const FLOOR = '60000000-0000-4000-8000-000000000011'
const SPACE = '60000000-0000-4000-8000-000000000012'
const PRICE_KIND = { id: '60000000-0000-4000-8000-000000000005', code: 'regular', isPromotion: false }

const pricingContainer = {
  resolve: (name: string) => {
    if (name === 'catalogPricingService') return new DefaultCatalogPricingService(null)
    throw new Error(`[internal] unexpected ${name}`)
  },
} as unknown as AwilixContainer

const route = { em: null as FakeEm | null }

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    ctx: { container: pricingContainer, auth: {} },
    em: route.em,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    translate: (_key: string, fallback: string) => fallback,
    permitted: null,
  })),
  handleRouteError: jest.fn(async (err: unknown) => {
    throw err
  }),
}))

import { GET } from '../api/leases/available-units/route'
import { decorateUnits } from '../api/units/route'

function seedPrice(em: FakeEm, id: string, productId: string, amount: string) {
  em.seed(CatalogProductPrice, {
    id,
    ...scope,
    product: productId,
    variant: null,
    offer: null,
    priceKind: PRICE_KIND,
    kind: 'regular',
    currencyCode: 'EUR',
    unitPriceNet: amount,
    unitPriceGross: amount,
    minQuantity: 1,
  } as never)
}

function seedPeriod(em: FakeEm, id: string, unitId: string, productId: string, price: { amount: string; currencyCode: string } | null) {
  return em.seed(UnitProductPeriod, {
    id,
    ...scope,
    unitId,
    catalogProductId: productId,
    productName: 'Private office',
    use: 'leasable',
    billingUnit: 'month',
    priceAmount: price?.amount ?? null,
    currencyCode: price?.currencyCode ?? null,
    priceKindId: null,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: null,
  } as never) as unknown as UnitProductPeriod
}

function priceQueries(find: jest.SpyInstance): number {
  return find.mock.calls.filter(([entity]) => entity === CatalogProductPrice).length
}

describe('periodPricesOf', () => {
  it('keeps stored snapshots and falls back to the catalog price once per distinct product', async () => {
    const em = new FakeEm()
    seedPrice(em, 'price-1', PRODUCT, '1200.0000')
    seedPrice(em, 'price-2', OTHER_PRODUCT, '900.0000')
    const periods = [
      seedPeriod(em, 'period-a', 'unit-a', PRODUCT, null),
      seedPeriod(em, 'period-b', 'unit-b', PRODUCT, null),
      seedPeriod(em, 'period-c', 'unit-c', OTHER_PRODUCT, { amount: '800.0000', currencyCode: 'PLN' }),
    ]
    const find = jest.spyOn(em, 'find')
    const prices = await periodPricesOf(em as never, pricingContainer, scope, periods)
    expect(prices.get('period-a')).toMatchObject({ priceAmount: '1200.0000', currencyCode: 'EUR' })
    expect(prices.get('period-b')).toMatchObject({ priceAmount: '1200.0000', currencyCode: 'EUR' })
    expect(prices.get('period-c')).toEqual({ priceAmount: '800.0000', currencyCode: 'PLN', priceKindId: null })
    expect(priceQueries(find)).toBe(1)
    expect(periods[0].priceAmount).toBeNull()
    expect(em.flushes).toBe(0)
  })
})

describe('available units GET', () => {
  it('returns the catalog price of a leasable unit whose open period has no price snapshot', async () => {
    const em = new FakeEm()
    route.em = em
    em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
    em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, name: 'Ground Floor', deletedAt: null } as never)
    em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Open plan', deletedAt: null } as never)
    for (const unitId of ['unit-a', 'unit-b']) {
      em.seed(Unit, { id: unitId, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: SPACE, name: unitId, catalogProductId: PRODUCT, width: '4', depth: '3', deletedAt: null } as never)
    }
    em.seed(ProductUse, { id: 'product-use-1', ...scope, catalogProductId: PRODUCT, use: 'leasable', billingUnit: 'month' } as never)
    seedPeriod(em, 'period-a', 'unit-a', PRODUCT, null)
    seedPeriod(em, 'period-b', 'unit-b', PRODUCT, { amount: '1000.0000', currencyCode: 'PLN' })
    seedPrice(em, 'price-1', PRODUCT, '1200.0000')
    const response = (await GET(new Request('http://localhost/api/property_management/leases/available-units'))) as unknown as {
      body: { items: Array<{ id: string; priceAmount: string | null; currencyCode: string | null }> }
    }
    expect(response.body.items.map((item) => [item.id, item.priceAmount, item.currencyCode])).toEqual([
      ['unit-a', '1200.0000', 'EUR'],
      ['unit-b', '1000.0000', 'PLN'],
    ])
    expect((em.rows(UnitProductPeriod)[0] as unknown as UnitProductPeriod).priceAmount).toBeNull()
  })
})

describe('units list decoration', () => {
  it('falls back to one batched catalog price query for open periods without a price snapshot', async () => {
    const em = new FakeEm()
    seedPrice(em, 'price-1', PRODUCT, '1200.0000')
    seedPrice(em, 'price-2', OTHER_PRODUCT, '900.0000')
    seedPeriod(em, 'period-a', 'unit-a', PRODUCT, null)
    seedPeriod(em, 'period-b', 'unit-b', OTHER_PRODUCT, null)
    seedPeriod(em, 'period-c', 'unit-c', PRODUCT, { amount: '1000.0000', currencyCode: 'PLN' })
    const items = [
      { id: 'unit-a', catalogProductId: PRODUCT },
      { id: 'unit-b', catalogProductId: OTHER_PRODUCT },
      { id: 'unit-c', catalogProductId: PRODUCT },
      { id: 'unit-d', catalogProductId: PRODUCT },
    ]
    const find = jest.spyOn(em, 'find')
    const ctx = {
      container: { resolve: (name: string) => (name === 'em' ? em : pricingContainer.resolve(name)) },
      auth: { tenantId: TENANT, orgId: ORG },
      selectedOrganizationId: ORG,
    }
    await decorateUnits({ items }, ctx as never)
    expect(items.map((item) => [item.id, (item as Record<string, unknown>).price])).toEqual([
      ['unit-a', { amount: '1200.0000', currencyCode: 'EUR' }],
      ['unit-b', { amount: '900.0000', currencyCode: 'EUR' }],
      ['unit-c', { amount: '1000.0000', currencyCode: 'PLN' }],
      ['unit-d', null],
    ])
    expect(priceQueries(find)).toBe(1)
    expect(em.flushes).toBe(0)
  })
})
