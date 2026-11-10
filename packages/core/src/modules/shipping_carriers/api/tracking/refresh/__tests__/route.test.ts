/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/shipping_carriers/api/tracking/refresh/route'
import { CarrierShipmentNotFoundError } from '@open-mercato/core/modules/shipping_carriers/lib/shipping-service'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const shipmentId = '44444444-4444-4444-8444-444444444444'

const refreshTrackingMock = jest.fn()
const translateMock = jest.fn((_key: string, fallback: string) => fallback)

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'shippingCarrierService') {
        return { refreshTracking: refreshTrackingMock }
      }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: translateMock, t: translateMock })),
}))

function createMockRequest(body: unknown): Request {
  return new Request('http://localhost/api/shipping-carriers/tracking/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('shipping carrier tracking refresh route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 404 instead of an upstream error when the shipment is not found in scope', async () => {
    refreshTrackingMock.mockRejectedValueOnce(new CarrierShipmentNotFoundError())

    const response = await POST(createMockRequest({ providerKey: 'test-carrier', shipmentId }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Shipment not found' })
    expect(translateMock).toHaveBeenCalledWith('shipping_carriers.errors.shipmentNotFound', 'Shipment not found')
    expect(refreshTrackingMock).toHaveBeenCalledWith({
      providerKey: 'test-carrier',
      shipmentId,
      organizationId,
      tenantId,
    })
  })
})
