/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/shipping_carriers/api/cancel/route'
import { CarrierShipmentNotFoundError } from '@open-mercato/core/modules/shipping_carriers/lib/shipping-service'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const shipmentId = '44444444-4444-4444-8444-444444444444'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const cancelShipmentMock = jest.fn()
const translateMock = jest.fn((_key: string, fallback: string) => fallback)

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
        return { cancelShipment: cancelShipmentMock }
      }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: translateMock, t: translateMock })),
}))

function createMockRequest(body: unknown): Request {
  return new Request('http://localhost/api/shipping-carriers/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validCancelPayload = {
  providerKey: 'test-carrier',
  shipmentId,
  reason: 'Customer requested',
}

function createNotFoundErrorFromSeparateBundle(): Error {
  let separateCopy: typeof import('@open-mercato/core/modules/shipping_carriers/lib/shipping-service') | undefined
  jest.isolateModules(() => {
    separateCopy = jest.requireActual('@open-mercato/core/modules/shipping_carriers/lib/shipping-service')
  })
  if (!separateCopy) throw new Error('[internal] shipping-service did not load')
  const error = new separateCopy.CarrierShipmentNotFoundError()
  expect(error).not.toBeInstanceOf(CarrierShipmentNotFoundError)
  return error
}

describe('shipping carrier cancel route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    cancelShipmentMock.mockResolvedValue({ status: 'cancelled' })
  })

  it('runs the mutation guard before cancelling a shipment', async () => {
    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: shipmentId,
        operation: 'custom',
        requestMethod: 'POST',
        mutationPayload: expect.objectContaining({ providerKey: 'test-carrier', shipmentId }),
      }),
    )
  })

  it('runs the after-success hook when the guard requests it', async () => {
    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(200)
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: shipmentId,
        operation: 'custom',
        requestMethod: 'POST',
        metadata: { token: 'guard' },
      }),
    )
  })

  it('returns the guard error response when the guard blocks cancellation', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 422, body: { error: 'blocked' } })

    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(422)
    expect(cancelShipmentMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('does not run the after-success hook when the guard does not request it', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false })

    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(200)
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('returns 404 instead of an upstream error when the shipment is not found in scope', async () => {
    cancelShipmentMock.mockRejectedValueOnce(new CarrierShipmentNotFoundError())

    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Shipment not found' })
    expect(translateMock).toHaveBeenCalledWith('shipping_carriers.errors.shipmentNotFound', 'Shipment not found')
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the not-found error comes from a separately bundled copy of the service', async () => {
    cancelShipmentMock.mockRejectedValueOnce(createNotFoundErrorFromSeparateBundle())

    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Shipment not found' })
  })
})
