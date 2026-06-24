/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/shipping_carriers/api/shipments/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const orderId = '44444444-4444-4444-8444-444444444444'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const createShipmentMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    tenantId,
    orgId: organizationId,
    sub: userId,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'shippingCarrierService') {
        return { createShipment: createShipmentMock }
      }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

function createMockRequest(body: unknown): Request {
  return new Request('http://localhost/api/shipping-carriers/shipments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validCreatePayload = {
  providerKey: 'test-carrier',
  orderId,
  origin: { countryCode: 'PL', postalCode: '00-001', city: 'Warsaw', line1: 'Test 1' },
  destination: { countryCode: 'PL', postalCode: '00-002', city: 'Krakow', line1: 'Test 2' },
  packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
  serviceCode: 'standard',
}

describe('shipping carrier shipments route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    createShipmentMock.mockResolvedValue({
      id: 'shipment-1',
      carrierShipmentId: 'carrier-1',
      trackingNumber: 'track-1',
      unifiedStatus: 'label_created',
      labelUrl: 'https://example.com/label.pdf',
    })
  })

  it('runs the mutation guard before creating a shipment', async () => {
    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(201)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: orderId,
        operation: 'create',
        requestMethod: 'POST',
        mutationPayload: expect.objectContaining({ providerKey: 'test-carrier', orderId }),
      }),
    )
  })

  it('runs the after-success hook when the guard requests it', async () => {
    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(201)
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: orderId,
        operation: 'create',
        requestMethod: 'POST',
        metadata: { token: 'guard' },
      }),
    )
  })

  it('returns the guard error response when the guard blocks creation', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 422, body: { error: 'blocked' } })

    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(422)
    expect(createShipmentMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('does not run the after-success hook when the guard does not request it', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false })

    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(201)
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
})
