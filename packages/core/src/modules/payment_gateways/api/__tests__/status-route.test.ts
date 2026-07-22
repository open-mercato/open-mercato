/** @jest-environment node */
import { GET, POST } from '../status/route'

const mockResolve = jest.fn()
const mockGetAuth = jest.fn()
const mockValidateGuard = jest.fn()
const mockRunGuardAfter = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => mockValidateGuard(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => mockRunGuardAfter(...args),
}))

const TRANSACTION_ID = '11111111-1111-4111-8111-111111111111'

function makeTransaction() {
  return {
    id: TRANSACTION_ID,
    paymentId: '22222222-2222-4222-8222-222222222222',
    providerKey: 'stripe',
    providerSessionId: 'sess_123',
    unifiedStatus: 'authorized',
    gatewayStatus: 'requires_capture',
    amount: '100.0000',
    currencyCode: 'USD',
    redirectUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }
}

function makeService() {
  return {
    findTransaction: jest.fn().mockResolvedValue(makeTransaction()),
    getPaymentStatus: jest.fn().mockResolvedValue({
      status: 'captured',
      amount: 100,
      amountReceived: 100,
      currencyCode: 'USD',
      providerData: {},
    }),
  }
}

function getRequest(transactionId: string = TRANSACTION_ID): Request {
  return {
    method: 'GET',
    url: `http://localhost/api/payment_gateways/status?transactionId=${transactionId}`,
    headers: new Headers(),
  } as unknown as Request
}

function postRequest(body: unknown): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/payment_gateways/status',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: jest.fn(async () => JSON.stringify(body)),
  } as unknown as Request
}

describe('payment_gateways status route', () => {
  let service: ReturnType<typeof makeService>

  beforeEach(() => {
    jest.clearAllMocks()
    service = makeService()
    mockGetAuth.mockResolvedValue({
      sub: '33333333-3333-4333-8333-333333333333',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockResolve.mockImplementation((token: string) => {
      if (token === 'paymentGatewayService') return service
      throw new Error(`Unexpected token: ${token}`)
    })
    mockValidateGuard.mockResolvedValue(null)
    mockRunGuardAfter.mockResolvedValue(undefined)
  })

  describe('GET (read-only)', () => {
    it('returns stored status WITHOUT polling the provider (a read must not mutate)', async () => {
      const res = await GET(getRequest())
      expect(res.status).toBe(200)
      const body = await res.json()
      // Regression for #3269: the GET handler must not invoke the mutating provider poller.
      expect(service.getPaymentStatus).not.toHaveBeenCalled()
      expect(service.findTransaction).toHaveBeenCalledTimes(1)
      // Response reflects the stored transaction state, not a freshly polled value.
      expect(body.status).toBe('authorized')
      expect(body.amount).toBe(100)
    })

    it('returns 404 when the transaction is missing', async () => {
      service.findTransaction.mockResolvedValue(null)
      const res = await GET(getRequest())
      expect(res.status).toBe(404)
      expect(service.getPaymentStatus).not.toHaveBeenCalled()
    })
  })

  describe('POST (guarded refresh)', () => {
    it('polls the provider and routes the write through the mutation guard lifecycle', async () => {
      const res = await POST(postRequest({ transactionId: TRANSACTION_ID }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(service.getPaymentStatus).toHaveBeenCalledTimes(1)
      expect(service.getPaymentStatus).toHaveBeenCalledWith(TRANSACTION_ID, {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      })
      expect(mockValidateGuard).toHaveBeenCalledTimes(1)
      const guardInput = mockValidateGuard.mock.calls[0][1]
      expect(guardInput).toMatchObject({
        resourceKind: 'payment_gateways.gateway_transaction',
        resourceId: TRANSACTION_ID,
        operation: 'custom',
        requestMethod: 'POST',
      })
      expect(body.status).toBe('captured')
    })

    it('blocks the write when the mutation guard denies it', async () => {
      mockValidateGuard.mockResolvedValue({ ok: false, status: 409, body: { error: 'locked' } })
      const res = await POST(postRequest({ transactionId: TRANSACTION_ID }))
      expect(res.status).toBe(409)
      expect(service.getPaymentStatus).not.toHaveBeenCalled()
    })

    it('rejects an invalid payload with 422', async () => {
      const res = await POST(postRequest({ transactionId: 'not-a-uuid' }))
      expect(res.status).toBe(422)
      expect(service.getPaymentStatus).not.toHaveBeenCalled()
    })

    it('returns 404 when the transaction is missing', async () => {
      service.findTransaction.mockResolvedValue(null)
      const res = await POST(postRequest({ transactionId: TRANSACTION_ID }))
      expect(res.status).toBe(404)
      expect(service.getPaymentStatus).not.toHaveBeenCalled()
    })
  })
})
