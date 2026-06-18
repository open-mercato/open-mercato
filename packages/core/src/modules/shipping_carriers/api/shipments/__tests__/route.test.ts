const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const createShipmentMock = jest.fn()
const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

const shippingCarrierService = { createShipment: createShipmentMock }
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'shippingCarrierService') return shippingCarrierService
    return {}
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    tenantId,
    orgId: organizationId,
    sub: userId,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { POST, metadata } from '../route'

const makePayload = () => ({
  providerKey: 'mock_carrier',
  orderId: '44444444-4444-4444-8444-444444444444',
  origin: {
    countryCode: 'PL',
    postalCode: '00-001',
    city: 'Warsaw',
    line1: 'Origin street 1',
  },
  destination: {
    countryCode: 'PL',
    postalCode: '30-001',
    city: 'Krakow',
    line1: 'Destination street 1',
  },
  packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
  serviceCode: 'standard',
  labelFormat: 'pdf' as const,
})

const postJson = (payload: unknown) =>
  POST(new Request('http://localhost/api/shipping-carriers/shipments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }))

describe('shipping carrier shipments route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue({
      ok: true,
      shouldRunAfterSuccess: true,
      metadata: { token: 'guard' },
    })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    createShipmentMock.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      carrierShipmentId: 'carrier-123',
      trackingNumber: 'TRACK123',
      unifiedStatus: 'label_created',
      labelUrl: 'https://example.test/label.pdf',
    })
  })

  it('runs mutation guards around shipment creation', async () => {
    const payload = makePayload()
    const response = await postJson(payload)

    expect(metadata.POST.requireFeatures).toEqual(['shipping_carriers.manage'])
    expect(response.status).toBe(201)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: payload.orderId,
        operation: 'create',
        requestMethod: 'POST',
        mutationPayload: expect.objectContaining({ orderId: payload.orderId }),
      }),
    )
    expect(createShipmentMock).toHaveBeenCalledWith(expect.objectContaining({
      ...payload,
      organizationId,
      tenantId,
    }))
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: '55555555-5555-4555-8555-555555555555',
        operation: 'create',
        requestMethod: 'POST',
        metadata: { token: 'guard' },
      }),
    )
  })

  it('does not create a shipment when the mutation guard blocks', async () => {
    validateCrudMutationGuardMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { error: 'blocked' },
    })

    const response = await postJson(makePayload())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'blocked' })
    expect(createShipmentMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
})
