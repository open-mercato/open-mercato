/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/shipping_carriers/api/tracking/route'
import { CarrierShipmentNotFoundError } from '@open-mercato/core/modules/shipping_carriers/lib/shipping-service'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const getTrackingMock = jest.fn()

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
        return { getTracking: getTrackingMock }
      }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

function createMockRequest(query: string): Request {
  return new Request(`http://localhost/api/shipping-carriers/tracking?${query}`, {
    method: 'GET',
  })
}

describe('shipping carrier tracking route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('maps missing scoped shipments to HTTP 404', async () => {
    getTrackingMock.mockRejectedValueOnce(new CarrierShipmentNotFoundError())

    const response = await GET(createMockRequest('providerKey=test-carrier&trackingNumber=TRACK-1'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Shipment not found' })
    expect(getTrackingMock).toHaveBeenCalledWith({
      providerKey: 'test-carrier',
      trackingNumber: 'TRACK-1',
      organizationId,
      tenantId,
    })
  })
})
