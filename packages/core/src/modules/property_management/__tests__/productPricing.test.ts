/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { Unit, UnitProductPeriod } from '../data/entities'
import { periodPriceOf, recordPeriodPrice, resolvePriceSnapshot } from '../lib/productUse'
import { resolveLeaseProduct } from '../lib/leaseRecords'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const PRODUCT = '60000000-0000-4000-8000-000000000001'
const DEFAULT_VARIANT = '60000000-0000-4000-8000-000000000002'
const SIBLING_VARIANT = '60000000-0000-4000-8000-000000000003'
const UNIT = '60000000-0000-4000-8000-000000000004'
const PRICE_KIND = { id: '60000000-0000-4000-8000-000000000005', code: 'regular', isPromotion: false }

const container = {
  resolve: (name: string) => {
    if (name === 'catalogPricingService') return new DefaultCatalogPricingService(null)
    throw new Error(`[internal] unexpected ${name}`)
  },
} as unknown as AwilixContainer

function seedPrice(em: FakeEm, id: string, data: { variant?: string | null; amount: string; currencyCode?: string }) {
  em.seed(CatalogProductPrice, {
    id,
    ...scope,
    product: PRODUCT,
    variant: data.variant ?? null,
    offer: null,
    priceKind: PRICE_KIND,
    kind: 'regular',
    currencyCode: data.currencyCode ?? 'USD',
    unitPriceNet: data.amount,
    unitPriceGross: data.amount,
    minQuantity: 1,
  } as never)
}

function seedVariant(em: FakeEm, id: string, isDefault: boolean) {
  em.seed(CatalogProductVariant, { id, ...scope, product: PRODUCT, isDefault, isActive: true, deletedAt: null } as never)
}

function seedUnit(em: FakeEm, period: { use: 'leasable' | 'bookable'; priceAmount?: string | null; currencyCode?: string | null }) {
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, title: 'Meeting room', deletedAt: null } as never)
  const unit = em.seed(Unit, { id: UNIT, ...scope, buildingId: 'b1', floorId: 'f1', spaceId: 's1', catalogProductId: PRODUCT, deletedAt: null } as never) as unknown as Unit
  const record = em.seed(UnitProductPeriod, {
    id: 'period-1',
    ...scope,
    unitId: UNIT,
    catalogProductId: PRODUCT,
    productName: 'Meeting room',
    use: period.use,
    billingUnit: period.use === 'leasable' ? 'month' : 'hour',
    priceAmount: period.priceAmount ?? null,
    currencyCode: period.currencyCode ?? null,
    priceKindId: null,
    validTo: null,
  } as never) as unknown as UnitProductPeriod
  return { unit, period: record }
}

describe('resolvePriceSnapshot', () => {
  it('prices a product whose only price belongs to its default variant', async () => {
    const em = new FakeEm()
    seedVariant(em, DEFAULT_VARIANT, true)
    seedPrice(em, 'variant-price', { variant: DEFAULT_VARIANT, amount: '40.0000' })
    expect(await resolvePriceSnapshot(em as never, container, scope, PRODUCT)).toEqual({
      priceAmount: '40.0000',
      currencyCode: 'USD',
      priceKindId: PRICE_KIND.id,
    })
  })

  it('never prices off a sibling variant', async () => {
    const em = new FakeEm()
    seedVariant(em, DEFAULT_VARIANT, true)
    seedVariant(em, SIBLING_VARIANT, false)
    seedPrice(em, 'sibling-price', { variant: SIBLING_VARIANT, amount: '99.0000' })
    expect((await resolvePriceSnapshot(em as never, container, scope, PRODUCT)).priceAmount).toBeNull()
    seedPrice(em, 'product-price', { amount: '35.0000' })
    expect((await resolvePriceSnapshot(em as never, container, scope, PRODUCT)).priceAmount).toBe('35.0000')
  })

  it('prefers the default variant price over the product-level price, as the catalog does', async () => {
    const em = new FakeEm()
    seedVariant(em, DEFAULT_VARIANT, true)
    seedPrice(em, 'product-price', { amount: '35.0000' })
    seedPrice(em, 'variant-price', { variant: DEFAULT_VARIANT, amount: '40.0000' })
    expect((await resolvePriceSnapshot(em as never, container, scope, PRODUCT)).priceAmount).toBe('40.0000')
  })

  it('uses product-level prices when the product has no default variant', async () => {
    const em = new FakeEm()
    seedPrice(em, 'product-price', { amount: '35.0000' })
    expect((await resolvePriceSnapshot(em as never, container, scope, PRODUCT)).priceAmount).toBe('35.0000')
  })
})

describe('periodPriceOf', () => {
  it('resolves the current product price for a period that has none, without writing it', async () => {
    const em = new FakeEm()
    const { period } = seedUnit(em, { use: 'leasable' })
    seedVariant(em, DEFAULT_VARIANT, true)
    seedPrice(em, 'variant-price', { variant: DEFAULT_VARIANT, amount: '40.0000' })
    expect(await periodPriceOf(em as never, container, scope, period)).toMatchObject({ priceAmount: '40.0000', currencyCode: 'USD' })
    expect(period.priceAmount).toBeNull()
    expect(em.flushes).toBe(0)
  })

  it('keeps an existing snapshot even when the catalog price changed', async () => {
    const em = new FakeEm()
    const { period } = seedUnit(em, { use: 'leasable', priceAmount: '30.0000', currencyCode: 'PLN' })
    seedPrice(em, 'product-price', { amount: '40.0000' })
    expect(await periodPriceOf(em as never, container, scope, period)).toMatchObject({ priceAmount: '30.0000', currencyCode: 'PLN' })
  })
})

describe('recordPeriodPrice', () => {
  const price = { priceAmount: '40.0000', currencyCode: 'USD', priceKindId: PRICE_KIND.id }

  it('records the price on the open period that has none', async () => {
    const em = new FakeEm()
    const { period } = seedUnit(em, { use: 'leasable' })
    await recordPeriodPrice(em as never, scope, UNIT, PRODUCT, price)
    expect(period).toMatchObject({ priceAmount: '40.0000', currencyCode: 'USD', priceKindId: PRICE_KIND.id })
    expect(em.flushes).toBe(1)
  })

  it('keeps an existing snapshot', async () => {
    const em = new FakeEm()
    const { period } = seedUnit(em, { use: 'leasable', priceAmount: '30.0000', currencyCode: 'PLN' })
    await recordPeriodPrice(em as never, scope, UNIT, PRODUCT, price)
    expect(period.priceAmount).toBe('30.0000')
    expect(em.flushes).toBe(0)
  })

  it('writes nothing while the product still has no price', async () => {
    const em = new FakeEm()
    const { period } = seedUnit(em, { use: 'leasable' })
    await recordPeriodPrice(em as never, scope, UNIT, PRODUCT, { priceAmount: null, currencyCode: null, priceKindId: null })
    expect(period.currencyCode).toBeNull()
    expect(em.flushes).toBe(0)
  })

  it('writes nothing when the open period belongs to another product', async () => {
    const em = new FakeEm()
    const { period } = seedUnit(em, { use: 'leasable' })
    await recordPeriodPrice(em as never, scope, UNIT, '60000000-0000-4000-8000-000000000099', price)
    expect(period.priceAmount).toBeNull()
    expect(em.flushes).toBe(0)
  })
})

describe('resolveLeaseProduct', () => {
  it('leases a unit whose period was snapshotted before the product had a price', async () => {
    const em = new FakeEm()
    const { unit, period } = seedUnit(em, { use: 'leasable' })
    seedVariant(em, DEFAULT_VARIANT, true)
    seedPrice(em, 'variant-price', { variant: DEFAULT_VARIANT, amount: '1200.0000', currencyCode: 'EUR' })
    const resolved = await resolveLeaseProduct(em as never, container, scope, unit)
    expect(resolved.product).toEqual({ catalogProductId: PRODUCT, productName: 'Meeting room', currencyCode: 'EUR' })
    expect(resolved.periodPrice).toMatchObject({ priceAmount: '1200.0000', currencyCode: 'EUR' })
    expect(period.currencyCode).toBeNull()
  })

  it('still refuses a unit whose product has no price at all', async () => {
    const em = new FakeEm()
    const { unit } = seedUnit(em, { use: 'leasable' })
    await expect(resolveLeaseProduct(em as never, container, scope, unit)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'lease_currency_missing' }),
    })
    await expect(resolveLeaseProduct(em as never, container, scope, unit)).rejects.toBeInstanceOf(CrudHttpError)
  })
})
