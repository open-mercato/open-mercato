/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { POST } from '@open-mercato/core/modules/shipping_carriers/api/shipments/route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { ShipmentIdempotencyConflictError } from '@open-mercato/core/modules/shipping_carriers/lib/shipment-idempotency'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({ readJsonSafe: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
    t: (_key: string, fallback: string) => fallback,
  })),
}))

const createShipment = jest.fn()
let consoleErrorSpy: jest.SpyInstance

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: 'mock_carrier',
    orderId: randomUUID(),
    origin: { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '1 Sender St' },
    destination: { countryCode: 'US', postalCode: '90210', city: 'Beverly Hills', line1: '2 Receiver Ave' },
    packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
    serviceCode: 'standard',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 'tenant_1', orgId: 'org_1' })
  ;(createRequestContainer as jest.Mock).mockResolvedValue({ resolve: () => ({ createShipment }) })
  ;(readJsonSafe as jest.Mock).mockResolvedValue(validPayload({ idempotencyKey: 'idem-1' }))
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('POST /api/shipping-carriers/shipments idempotency contract', () => {
  test('maps a ShipmentIdempotencyConflictError to HTTP 409 with a machine-readable code', async () => {
    createShipment.mockRejectedValue(new ShipmentIdempotencyConflictError('idem-1'))

    const response = await POST({} as Request)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ code: 'idempotency_conflict' })
  })

  test('forwards the idempotency key to the service and returns 201 on success', async () => {
    createShipment.mockResolvedValue({
      id: 'ship_1',
      carrierShipmentId: 'carrier_1',
      trackingNumber: 'TRK_1',
      unifiedStatus: 'label_created',
      labelUrl: null,
    })

    const response = await POST({} as Request)

    expect(response.status).toBe(201)
    expect(createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'idem-1', organizationId: 'org_1', tenantId: 'tenant_1' }),
    )
  })

  test('non-idempotency upstream failures remain HTTP 502', async () => {
    createShipment.mockRejectedValue(new Error('carrier upstream exploded'))

    const response = await POST({} as Request)

    expect(response.status).toBe(502)
  })
})
