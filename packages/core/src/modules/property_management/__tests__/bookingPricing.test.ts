/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { bookingPriceContext, wallClockDate } from '../lib/bookingRecords'
import { resolvePriceSnapshot } from '../lib/productUse'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const PRODUCT = '70000000-0000-4000-8000-000000000001'
const CHANNEL = '70000000-0000-4000-8000-000000000002'
const PERSON = '70000000-0000-4000-8000-000000000003'
const COMPANY = '70000000-0000-4000-8000-000000000004'
const PRICE_KIND = { id: '70000000-0000-4000-8000-000000000005', code: 'regular', isPromotion: false }

const container = {
  resolve: (name: string) => {
    if (name === 'catalogPricingService') return new DefaultCatalogPricingService(null)
    throw new Error(`[internal] unexpected ${name}`)
  },
} as unknown as AwilixContainer

function seedPrice(em: FakeEm, id: string, overrides: Record<string, unknown>) {
  em.seed(CatalogProductPrice, {
    id,
    ...scope,
    product: PRODUCT,
    variant: null,
    offer: null,
    priceKind: PRICE_KIND,
    kind: 'regular',
    currencyCode: 'EUR',
    unitPriceNet: '50.0000',
    unitPriceGross: '61.5000',
    minQuantity: 1,
    channelId: null,
    customerId: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  } as never)
}

describe('booking price resolution', () => {
  it('prices a product that has only a billing-channel price when the channel is passed', async () => {
    const em = new FakeEm()
    seedPrice(em, 'channel', { channelId: CHANNEL, unitPriceNet: '45.0000' })
    expect(await resolvePriceSnapshot(em as never, container, scope, PRODUCT)).toMatchObject({ priceAmount: null })
    expect(await resolvePriceSnapshot(em as never, container, scope, PRODUCT, { channelId: CHANNEL })).toMatchObject({
      priceAmount: '45.0000',
      currencyCode: 'EUR',
    })
  })

  it('prefers the billing-channel price and then the booked company price over the base price', async () => {
    const em = new FakeEm()
    seedPrice(em, 'base', {})
    seedPrice(em, 'channel', { channelId: CHANNEL, unitPriceNet: '45.0000' })
    seedPrice(em, 'company', { channelId: CHANNEL, customerId: COMPANY, unitPriceNet: '40.0000' })
    const anonymous = bookingPriceContext({ channelId: CHANNEL, startsAt: '2030-03-10T09:00' })
    expect((await resolvePriceSnapshot(em as never, container, scope, PRODUCT, anonymous)).priceAmount).toBe('45.0000')
    const forCompany = bookingPriceContext({
      channelId: CHANNEL,
      startsAt: '2030-03-10T09:00',
      party: { bookedByPersonId: PERSON, customerCompanyId: COMPANY },
    })
    expect(forCompany.customerIds).toEqual([PERSON, COMPANY])
    expect((await resolvePriceSnapshot(em as never, container, scope, PRODUCT, forCompany)).priceAmount).toBe('40.0000')
  })

  it('uses the price valid at the booked time, not today', async () => {
    const em = new FakeEm()
    seedPrice(em, 'current', { endsAt: new Date(2030, 0, 1) })
    seedPrice(em, 'next-year', { unitPriceNet: '70.0000', startsAt: new Date(2030, 0, 1) })
    const context = bookingPriceContext({ channelId: CHANNEL, startsAt: '2030-03-10T09:00' })
    expect(context.date).toEqual(wallClockDate('2030-03-10T09:00'))
    expect((await resolvePriceSnapshot(em as never, container, scope, PRODUCT, context)).priceAmount).toBe('70.0000')
  })

  it('never bills a gross-only price as net', async () => {
    const em = new FakeEm()
    seedPrice(em, 'gross-only', { unitPriceNet: null, unitPriceGross: '61.5000' })
    expect(await resolvePriceSnapshot(em as never, container, scope, PRODUCT)).toEqual({ priceAmount: null, currencyCode: 'EUR', priceKindId: null })
    seedPrice(em, 'channel-gross-only', { channelId: CHANNEL, unitPriceNet: null, unitPriceGross: '55.0000' })
    seedPrice(em, 'net', { unitPriceNet: '50.0000' })
    expect(await resolvePriceSnapshot(em as never, container, scope, PRODUCT, { channelId: CHANNEL })).toMatchObject({
      priceAmount: '50.0000',
      currencyCode: 'EUR',
    })
  })
})
