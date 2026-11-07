jest.mock('@open-mercato/core/modules/shipping_carriers/lib/adapter-registry', () => ({
  listShippingAdapters: jest.fn(),
}))
jest.mock('../cartLinesPeer', () => {
  const actual = jest.requireActual('../cartLinesPeer')
  return {
    ...actual,
    lookupCartLinePeers: jest.fn(),
    lookupCatalogProductWeightDimensions: jest.fn(),
    lookupCatalogVariantWeightDimensions: jest.fn(),
  }
})
jest.mock('../warehousePeer', () => ({
  lookupPrimaryWarehouseAddress: jest.fn(),
}))
jest.mock('../storeSettingsPeer', () => ({
  lookupStoreFlatRateFallback: jest.fn(),
}))
jest.mock('../linkFlatRate', () => ({
  lookupLinkFlatRateFallback: jest.fn(),
}))

import { listShippingAdapters } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { lookupCartLinePeers, lookupCatalogProductWeightDimensions, lookupCatalogVariantWeightDimensions } from '../cartLinesPeer'
import { lookupPrimaryWarehouseAddress } from '../warehousePeer'
import { lookupStoreFlatRateFallback } from '../storeSettingsPeer'
import { lookupLinkFlatRateFallback } from '../linkFlatRate'
import { computeDeliveryOptions, type DeliveryQuoteSessionInput } from '../deliveryRateQuote'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockListShippingAdapters = listShippingAdapters as jest.Mock
const mockLookupCartLinePeers = lookupCartLinePeers as jest.Mock
const mockLookupCatalogProductWeightDimensions = lookupCatalogProductWeightDimensions as jest.Mock
const mockLookupCatalogVariantWeightDimensions = lookupCatalogVariantWeightDimensions as jest.Mock
const mockLookupPrimaryWarehouseAddress = lookupPrimaryWarehouseAddress as jest.Mock
const mockLookupStoreFlatRateFallback = lookupStoreFlatRateFallback as jest.Mock
const mockLookupLinkFlatRateFallback = lookupLinkFlatRateFallback as jest.Mock

const DESTINATION = { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '5th Ave' }
const WAREHOUSE = { id: 'wh-1', addressLine1: '1 Warehouse Rd', city: 'Columbus', postalCode: '43215', country: 'US' }

function baseSession(overrides: Partial<DeliveryQuoteSessionInput> = {}): DeliveryQuoteSessionInput {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    cartId: 'cart-1',
    storeId: 'store-1',
    linkId: null,
    channel: 'storefront',
    currencyCode: 'USD',
    ...overrides,
  }
}

function makeContainer(opts: { shippingCarrierService?: unknown; wmsAvailable?: boolean } = {}) {
  const { shippingCarrierService, wmsAvailable = true } = opts
  return {
    resolve: (name: string) => {
      if (name === 'wmsReservationService') {
        if (!wmsAvailable) throw new Error('wms is not registered')
        return {}
      }
      if (name === 'shippingCarrierService') {
        if (!shippingCarrierService) throw new Error('shippingCarrierService is not registered')
        return shippingCarrierService
      }
      throw new Error(`Unexpected DI token: ${name}`)
    },
  }
}

const em = {} as any

describe('computeDeliveryOptions (C13/D-R5-35)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLookupCartLinePeers.mockResolvedValue([])
    mockLookupCatalogProductWeightDimensions.mockResolvedValue([])
    mockLookupCatalogVariantWeightDimensions.mockResolvedValue([])
    mockLookupPrimaryWarehouseAddress.mockResolvedValue(WAREHOUSE)
    mockLookupStoreFlatRateFallback.mockResolvedValue(null)
    mockLookupLinkFlatRateFallback.mockResolvedValue(null)
    mockListShippingAdapters.mockReturnValue([])
  })

  it('returns carrier rates when a carrier successfully quotes', async () => {
    const calculateRates = jest.fn().mockResolvedValue([
      { serviceCode: 'express', serviceName: 'Express', amount: 12.5, currencyCode: 'USD', estimatedDays: 2 },
    ])
    mockListShippingAdapters.mockReturnValue([{ providerKey: 'acme' }])
    const container = makeContainer({ shippingCarrierService: { calculateRates } })

    const options = await computeDeliveryOptions(container, em, baseSession(), DESTINATION)

    expect(options).toEqual([
      {
        deliveryMethodCode: 'acme:express',
        providerKey: 'acme',
        serviceCode: 'express',
        label: 'Express',
        cost: '12.50',
        currencyCode: 'USD',
        estimatedDays: 2,
        source: 'carrier',
      },
    ])
  })

  it('falls back to the STORE flat rate for a storefront cart when no carrier is configured', async () => {
    mockLookupStoreFlatRateFallback.mockResolvedValue({ amount: 7.5, currencyCode: 'USD' })
    const container = makeContainer({ shippingCarrierService: undefined })

    const options = await computeDeliveryOptions(container, em, baseSession({ channel: 'storefront', storeId: 'store-1' }), DESTINATION)

    expect(options).toEqual([
      expect.objectContaining({ deliveryMethodCode: 'flat_rate', source: 'flat_rate', cost: '7.50', currencyCode: 'USD' }),
    ])
    expect(mockLookupStoreFlatRateFallback).toHaveBeenCalledWith(em, 'store-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(mockLookupLinkFlatRateFallback).not.toHaveBeenCalled()
  })

  it('falls back to the LINK flat rate for a pay_link cart, never the store', async () => {
    mockLookupLinkFlatRateFallback.mockResolvedValue({ amount: 4.25, currencyCode: 'USD' })
    const container = makeContainer({ shippingCarrierService: undefined })

    const options = await computeDeliveryOptions(
      container,
      em,
      baseSession({ channel: 'pay_link', linkId: 'link-1', storeId: null }),
      DESTINATION,
    )

    expect(options).toEqual([
      expect.objectContaining({ deliveryMethodCode: 'flat_rate', source: 'flat_rate', cost: '4.25' }),
    ])
    expect(mockLookupLinkFlatRateFallback).toHaveBeenCalledWith(em, 'link-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(mockLookupStoreFlatRateFallback).not.toHaveBeenCalled()
  })

  it('falls back to the flat rate when every configured carrier fails (R10)', async () => {
    const calculateRates = jest.fn().mockRejectedValue(new Error('carrier unreachable'))
    mockListShippingAdapters.mockReturnValue([{ providerKey: 'acme' }])
    mockLookupStoreFlatRateFallback.mockResolvedValue({ amount: 9.99, currencyCode: 'USD' })
    const container = makeContainer({ shippingCarrierService: { calculateRates } })

    const options = await computeDeliveryOptions(container, em, baseSession(), DESTINATION)

    expect(options).toEqual([expect.objectContaining({ source: 'flat_rate', cost: '9.99' })])
  })

  it('throws 422 delivery_unavailable when neither a carrier rate nor a flat rate is available', async () => {
    const container = makeContainer({ shippingCarrierService: undefined })

    await expect(computeDeliveryOptions(container, em, baseSession(), DESTINATION)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'delivery_unavailable' }),
    })
  })

  it('throws 422 delivery_unavailable (never a 500) when the carrier module is absent and shipping_carriers is not installed', async () => {
    mockLookupPrimaryWarehouseAddress.mockResolvedValue(null)
    const container = makeContainer({ shippingCarrierService: undefined, wmsAvailable: false })

    await expect(computeDeliveryOptions(container, em, baseSession(), DESTINATION)).rejects.toBeInstanceOf(CrudHttpError)
  })
})
