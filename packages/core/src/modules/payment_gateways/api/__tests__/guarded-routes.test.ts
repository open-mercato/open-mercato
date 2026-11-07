/** @jest-environment node */

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { conflict, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runPaymentGatewayMutationGuardAfterSuccess,
  runPaymentGatewayMutationGuards,
} from '../guards'
import { POST as createSession } from '../sessions/route'
import { POST as capturePayment } from '../capture/route'
import { POST as refundPayment } from '../refund/route'
import { POST as cancelPayment } from '../cancel/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))

jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => []),
  runPaymentGatewayMutationGuards: jest.fn(),
  runPaymentGatewayMutationGuardAfterSuccess: jest.fn(),
}))

const TXN_ID = '11111111-1111-4111-8111-111111111111'
const OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const RESOURCE_KIND = 'payment_gateways.gateway_transaction'

const service = {
  createPaymentSession: jest.fn(),
  capturePayment: jest.fn(),
  refundPayment: jest.fn(),
  cancelPayment: jest.fn(),
}

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/payment_gateways', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1', features: [] })
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (key: string) => {
      if (key === 'paymentGatewayService') return service
      throw new Error(`unexpected resolve(${key})`)
    },
  })
  ;(runPaymentGatewayMutationGuards as jest.Mock).mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  service.createPaymentSession.mockResolvedValue({
    transaction: { id: 'txn_created', providerKey: 'stripe', paymentId: 'pay_1' },
    session: { sessionId: 'sess_1', status: 'pending', clientSecret: null, providerData: null, clientSession: null },
  })
  service.capturePayment.mockResolvedValue({ ok: true })
  service.refundPayment.mockResolvedValue({ ok: true })
  service.cancelPayment.mockResolvedValue({ ok: true })
})

describe('payment gateway write routes wire the mutation guard lifecycle', () => {
  describe('POST /payment_gateways/sessions (create)', () => {
    const body = { providerKey: 'stripe', amount: 10, currencyCode: 'USD' }

    it('runs the mutation guard with a create operation before mutating', async () => {
      await createSession(buildRequest(body))
      expect(runPaymentGatewayMutationGuards).toHaveBeenCalledTimes(1)
      expect(runPaymentGatewayMutationGuards).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resourceKind: RESOURCE_KIND, operation: 'create' }),
        [],
      )
    })

    it('returns the guard rejection and does not create the session when blocked', async () => {
      ;(runPaymentGatewayMutationGuards as jest.Mock).mockResolvedValue({
        ok: false,
        errorStatus: 423,
        errorBody: { error: 'Record is locked', code: 'record_locked' },
        afterSuccessCallbacks: [],
      })
      const response = await createSession(buildRequest(body))
      expect(response.status).toBe(423)
      expect(await response.json()).toEqual({ error: 'Record is locked', code: 'record_locked' })
      expect(service.createPaymentSession).not.toHaveBeenCalled()
    })

    it('runs after-success hooks once the session is created', async () => {
      const response = await createSession(buildRequest(body))
      expect(response.status).toBe(201)
      expect(service.createPaymentSession).toHaveBeenCalledTimes(1)
      expect(runPaymentGatewayMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
    })

    it('surfaces an order reconciliation conflict as 409 instead of a gateway error', async () => {
      service.createPaymentSession.mockRejectedValue(
        conflict('Payment session amount 1 does not match the amount due for order o-1'),
      )
      const response = await createSession(buildRequest(body))
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: 'Payment session amount 1 does not match the amount due for order o-1',
      })
      expect(runPaymentGatewayMutationGuardAfterSuccess).not.toHaveBeenCalled()
    })

    it('preserves a typed missing-adapter response as 422', async () => {
      service.createPaymentSession.mockRejectedValue(
        new CrudHttpError(422, { error: 'No gateway adapter registered for provider: missing' }),
      )

      const response = await createSession(buildRequest(body))

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'No gateway adapter registered for provider: missing' })
    })

    it('does not expose unexpected internal errors in a 502 response', async () => {
      service.createPaymentSession.mockRejectedValue(
        new Error('[internal] Completed payment session is missing its gateway transaction'),
      )

      const response = await createSession(buildRequest(body))

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'Failed to create payment session' })
    })
  })

  describe('POST /payment_gateways/capture (update)', () => {
    const body = { transactionId: TXN_ID }

    it('runs the mutation guard with an update operation scoped to the transaction', async () => {
      await capturePayment(buildRequest(body))
      expect(runPaymentGatewayMutationGuards).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resourceKind: RESOURCE_KIND, operation: 'update', resourceId: TXN_ID }),
        [],
      )
    })

    it('returns the guard rejection and does not capture when blocked', async () => {
      ;(runPaymentGatewayMutationGuards as jest.Mock).mockResolvedValue({
        ok: false,
        errorStatus: 423,
        errorBody: { error: 'Record is locked', code: 'record_locked' },
        afterSuccessCallbacks: [],
      })
      const response = await capturePayment(buildRequest(body))
      expect(response.status).toBe(423)
      expect(service.capturePayment).not.toHaveBeenCalled()
    })

    it('runs after-success hooks once the capture succeeds', async () => {
      const response = await capturePayment(buildRequest({ ...body, operationId: OPERATION_ID }))
      expect(response.status).toBe(200)
      expect(service.capturePayment).toHaveBeenCalledWith(TXN_ID, undefined, { organizationId: 'o1', tenantId: 't1' }, OPERATION_ID)
      expect(runPaymentGatewayMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /payment_gateways/refund (update)', () => {
    const body = { transactionId: TXN_ID }

    it('runs the mutation guard with an update operation scoped to the transaction', async () => {
      await refundPayment(buildRequest(body))
      expect(runPaymentGatewayMutationGuards).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resourceKind: RESOURCE_KIND, operation: 'update', resourceId: TXN_ID }),
        [],
      )
    })

    it('returns the guard rejection and does not refund when blocked', async () => {
      ;(runPaymentGatewayMutationGuards as jest.Mock).mockResolvedValue({
        ok: false,
        errorStatus: 423,
        errorBody: { error: 'Record is locked', code: 'record_locked' },
        afterSuccessCallbacks: [],
      })
      const response = await refundPayment(buildRequest(body))
      expect(response.status).toBe(423)
      expect(service.refundPayment).not.toHaveBeenCalled()
    })

    it('runs after-success hooks once the refund succeeds', async () => {
      const response = await refundPayment(buildRequest({ ...body, operationId: OPERATION_ID }))
      expect(response.status).toBe(200)
      expect(service.refundPayment).toHaveBeenCalledWith(TXN_ID, undefined, undefined, { organizationId: 'o1', tenantId: 't1' }, OPERATION_ID)
      expect(runPaymentGatewayMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /payment_gateways/cancel (update)', () => {
    const body = { transactionId: TXN_ID }

    it('runs the mutation guard with an update operation scoped to the transaction', async () => {
      await cancelPayment(buildRequest(body))
      expect(runPaymentGatewayMutationGuards).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resourceKind: RESOURCE_KIND, operation: 'update', resourceId: TXN_ID }),
        [],
      )
    })

    it('returns the guard rejection and does not cancel when blocked', async () => {
      ;(runPaymentGatewayMutationGuards as jest.Mock).mockResolvedValue({
        ok: false,
        errorStatus: 423,
        errorBody: { error: 'Record is locked', code: 'record_locked' },
        afterSuccessCallbacks: [],
      })
      const response = await cancelPayment(buildRequest(body))
      expect(response.status).toBe(423)
      expect(service.cancelPayment).not.toHaveBeenCalled()
    })

    it('runs after-success hooks once the cancel succeeds', async () => {
      const response = await cancelPayment(buildRequest({ ...body, operationId: OPERATION_ID }))
      expect(response.status).toBe(200)
      expect(service.cancelPayment).toHaveBeenCalledWith(TXN_ID, undefined, { organizationId: 'o1', tenantId: 't1' }, OPERATION_ID)
      expect(runPaymentGatewayMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
    })
  })
})

describe('payment gateway write routes reject sub-minor amounts', () => {
  beforeEach(() => {
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (key: string) => {
        if (key === 'paymentGatewayService') return service
        if (key === 'em') return {}
        throw new Error(`unexpected resolve(${key})`)
      },
    })
    mockFindOneWithDecryption.mockResolvedValue({ id: TXN_ID, currencyCode: 'USD' })
  })

  it('rejects a session amount with more decimals than the currency has', async () => {
    const response = await createSession(buildRequest({ providerKey: 'stripe', amount: '10.005', currencyCode: 'USD' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Amount 10.005 has more decimal places than USD supports (2)' })
    expect(service.createPaymentSession).not.toHaveBeenCalled()
  })

  it('rejects a positive session amount whose numeric copy underflows to zero', async () => {
    const response = await createSession(buildRequest({ providerKey: 'stripe', amount: '1e-400', currencyCode: 'USD' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: 'Invalid payload',
      details: { fieldErrors: { amount: [expect.any(String)] } },
    })
    expect(service.createPaymentSession).not.toHaveBeenCalled()
    expect(runPaymentGatewayMutationGuards).not.toHaveBeenCalled()
  })

  it('passes a session amount within the currency decimals through exactly', async () => {
    const response = await createSession(buildRequest({ providerKey: 'stripe', amount: '10.05', currencyCode: 'USD' }))
    expect(response.status).toBe(201)
    expect(service.createPaymentSession).toHaveBeenCalledWith(expect.objectContaining({ amountExact: '10.05' }))
  })

  it('rejects a capture amount with more decimals than the transaction currency has', async () => {
    const response = await capturePayment(buildRequest({ transactionId: TXN_ID, amount: '10.005' }))
    expect(response.status).toBe(400)
    expect(service.capturePayment).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: TXN_ID, organizationId: 'o1', tenantId: 't1' }),
      undefined,
      { organizationId: 'o1', tenantId: 't1' },
    )
  })

  it('rejects a refund amount with more decimals than the transaction currency has', async () => {
    const response = await refundPayment(buildRequest({ transactionId: TXN_ID, amount: '1.001' }))
    expect(response.status).toBe(400)
    expect(service.refundPayment).not.toHaveBeenCalled()
  })

  it('skips the lookup when no capture amount is given', async () => {
    const response = await capturePayment(buildRequest({ transactionId: TXN_ID }))
    expect(response.status).toBe(200)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(service.capturePayment).toHaveBeenCalledWith(TXN_ID, undefined, { organizationId: 'o1', tenantId: 't1' }, undefined)
  })
})
