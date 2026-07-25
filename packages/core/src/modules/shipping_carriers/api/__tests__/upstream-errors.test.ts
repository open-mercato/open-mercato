/** @jest-environment node */
import { POST as cancelShipment } from '@open-mercato/core/modules/shipping_carriers/api/cancel/route'
import { GET as searchDropOffPoints } from '@open-mercato/core/modules/shipping_carriers/api/points/route'
import { POST as calculateRates } from '@open-mercato/core/modules/shipping_carriers/api/rates/route'
import { POST as createShipment } from '@open-mercato/core/modules/shipping_carriers/api/shipments/route'
import { GET as getTracking } from '@open-mercato/core/modules/shipping_carriers/api/tracking/route'
import { POST as refreshTracking } from '@open-mercato/core/modules/shipping_carriers/api/tracking/refresh/route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const shipmentId = '44444444-4444-4444-8444-444444444444'
const sensitiveMessage = 'carrier failed with token=sk_live_secret at https://internal-carrier.local'

const serviceMock = {
  calculateRates: jest.fn(),
  cancelShipment: jest.fn(),
  createShipment: jest.fn(),
  getTracking: jest.fn(),
  refreshTracking: jest.fn(),
  searchDropOffPoints: jest.fn(),
}
const mockTranslate = jest.fn((_key: string, fallback: string) => fallback)
const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({ readJsonSafe: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: mockTranslate, t: mockTranslate })),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})
const carrierLoggerError = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('shipping_carriers').error as jest.Mock

function createJsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const address = { countryCode: 'PL', postalCode: '00-001', city: 'Warsaw', line1: 'Test 1' }
const parcel = { weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }

const createPayload = {
  providerKey: 'test-carrier',
  orderId,
  origin: address,
  destination: { ...address, postalCode: '30-001', city: 'Krakow' },
  packages: [parcel],
  serviceCode: 'standard',
}

const ratePayload = {
  providerKey: 'test-carrier',
  origin: address,
  destination: { ...address, postalCode: '30-001', city: 'Krakow' },
  packages: [parcel],
}

describe('shipping carrier upstream errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId, orgId: organizationId, sub: 'user_1' })
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'shippingCarrierService') return serviceMock
        throw new Error(`[internal] Unexpected container resolve: ${name}`)
      },
    })
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it.each([
    {
      name: 'shipment creation',
      setup: () => {
        ;(readJsonSafe as jest.Mock).mockResolvedValue(createPayload)
        serviceMock.createShipment.mockRejectedValue(new Error(sensitiveMessage))
        return createShipment(createJsonRequest('/api/shipping-carriers/shipments', createPayload))
      },
    },
    {
      name: 'rate calculation',
      setup: () => {
        ;(readJsonSafe as jest.Mock).mockResolvedValue(ratePayload)
        serviceMock.calculateRates.mockRejectedValue(new Error(sensitiveMessage))
        return calculateRates(createJsonRequest('/api/shipping-carriers/rates', ratePayload))
      },
    },
    {
      name: 'tracking lookup',
      setup: () => {
        serviceMock.getTracking.mockRejectedValue(new Error(sensitiveMessage))
        return getTracking(new Request(`http://localhost/api/shipping-carriers/tracking?providerKey=test-carrier&shipmentId=${shipmentId}`))
      },
    },
    {
      name: 'tracking refresh',
      setup: () => {
        const payload = { providerKey: 'test-carrier', shipmentId }
        ;(readJsonSafe as jest.Mock).mockResolvedValue(payload)
        serviceMock.refreshTracking.mockRejectedValue(new Error(sensitiveMessage))
        return refreshTracking(createJsonRequest('/api/shipping-carriers/tracking/refresh', payload))
      },
    },
    {
      name: 'drop-off point search',
      setup: () => {
        serviceMock.searchDropOffPoints.mockRejectedValue(new Error(sensitiveMessage))
        return searchDropOffPoints(new Request('http://localhost/api/shipping-carriers/points?providerKey=test-carrier&query=KRA'))
      },
    },
    {
      name: 'shipment cancellation',
      setup: () => {
        const payload = { providerKey: 'test-carrier', shipmentId, reason: 'Customer requested' }
        ;(readJsonSafe as jest.Mock).mockResolvedValue(payload)
        serviceMock.cancelShipment.mockRejectedValue(new Error(sensitiveMessage))
        return cancelShipment(createJsonRequest('/api/shipping-carriers/cancel', payload))
      },
    },
  ])('returns a generic 502 response for $name without dropping the server-side error detail', async ({ setup }) => {
    const response = await setup()
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.error).toBe('Carrier provider request failed. Try again later.')
    expect(body.error).not.toContain('sk_live_secret')
    expect(body.error).not.toContain('internal-carrier.local')
    expect(carrierLoggerError).toHaveBeenCalledWith('Provider upstream error', { routeId: expect.any(String), err: expect.any(Error) })
  })
})
