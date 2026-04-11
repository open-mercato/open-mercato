import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { POST } from '../route'

const LINK_ID = '11111111-1111-4111-8111-111111111111'
const TRANSACTION_ID = '22222222-2222-4222-8222-222222222222'
const GATEWAY_TRANSACTION_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const TENANT_ID = '55555555-5555-4555-8555-555555555555'

const mockCreatePaymentSession = jest.fn()
const mockCommandExecute = jest.fn()
const mockEmFindOne = jest.fn()
const mockTransactional = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(),
}))

jest.mock('../../../../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

function createLink() {
  return {
    id: LINK_ID,
    name: 'Donation',
    title: 'Donation',
    slug: 'donate',
    status: 'active',
    pricingMode: 'custom_amount',
    customAmountMin: '1.00',
    customAmountMax: '100.00',
    customAmountCurrencyCode: 'USD',
    gatewayProviderKey: 'test_gateway',
    gatewaySettings: null,
    legalDocuments: null,
    collectCustomerDetails: false,
    customerFieldsSchema: [],
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    templateId: null,
  }
}

function createTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: TRANSACTION_ID,
    linkId: LINK_ID,
    status: 'pending',
    amount: '25.00',
    currencyCode: 'USD',
    gatewayTransactionId: null,
    paymentStatus: null,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    ...overrides,
  }
}

describe('POST /api/checkout/pay/[slug]/submit', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return {}
        if (name === 'em') return { findOne: mockEmFindOne, transactional: mockTransactional }
        if (name === 'commandBus') return { execute: mockCommandExecute }
        if (name === 'paymentGatewayService') {
          return { createPaymentSession: mockCreatePaymentSession }
        }
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
    mockCreatePaymentSession.mockResolvedValue({
      transaction: {
        id: GATEWAY_TRANSACTION_ID,
        unifiedStatus: 'pending',
      },
    })
    mockCommandExecute.mockResolvedValue({ result: { ok: true } })
    mockEmFindOne.mockResolvedValue({
      id: GATEWAY_TRANSACTION_ID,
      providerKey: 'test_gateway',
      redirectUrl: 'https://payments.example/session',
      gatewayMetadata: {
        clientSession: {
          type: 'redirect',
          redirectUrl: 'https://payments.example/session',
        },
      },
    })
    mockTransactional.mockImplementation(async (callback: (tx: { findOne: typeof mockEmFindOne; flush: jest.Mock }) => Promise<unknown>) =>
      callback({ findOne: mockEmFindOne, flush: jest.fn() }),
    )
  })

  it('uses the stored transaction amount when replaying an idempotency key before gateway session creation', async () => {
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(createLink())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction({ gatewayTransactionId: GATEWAY_TRANSACTION_ID }))

    const response = await POST(
      new Request('https://merchant.example/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'replay-key-123456',
          origin: 'https://merchant.example',
        },
        body: JSON.stringify({
          customerData: {},
          acceptedLegalConsents: {},
          amount: 1,
        }),
      }),
      { params: { slug: 'donate' } },
    )

    expect(response.status).toBe(201)
    expect(mockCommandExecute).not.toHaveBeenCalledWith(
      'checkout.transaction.create',
      expect.anything(),
    )
    expect(mockCreatePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: TRANSACTION_ID,
        amount: 25,
        currencyCode: 'USD',
      }),
    )
  })

  it('creates one payment session for concurrent idempotent submits with a pending gateway transaction id', async () => {
    const sharedTransaction = createTransaction()
    let transactionQueue = Promise.resolve()
    mockTransactional.mockImplementation(async (callback: (tx: { findOne: typeof mockEmFindOne; flush: jest.Mock }) => Promise<unknown>) => {
      const run = transactionQueue.then(() => callback({ findOne: mockEmFindOne, flush: jest.fn() }))
      transactionQueue = run.then(() => undefined, () => undefined)
      return run
    })
    ;(findOneWithDecryption as jest.Mock).mockImplementation(async (_em, _entity, where: Record<string, unknown>) => {
      if (typeof where.slug === 'string') return createLink()
      if (typeof where.linkId === 'string' && typeof where.idempotencyKey === 'string') return sharedTransaction
      if (where.id === TRANSACTION_ID) return sharedTransaction
      return null
    })

    const buildRequest = () =>
      new Request('https://merchant.example/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'parallel-key-123456',
          origin: 'https://merchant.example',
        },
        body: JSON.stringify({
          customerData: {},
          acceptedLegalConsents: {},
          amount: 25,
        }),
      })

    const [firstResponse, secondResponse] = await Promise.all([
      POST(buildRequest(), { params: { slug: 'donate' } }),
      POST(buildRequest(), { params: { slug: 'donate' } }),
    ])

    expect([firstResponse.status, secondResponse.status].sort((left, right) => left - right)).toEqual([200, 201])
    expect(mockCreatePaymentSession).toHaveBeenCalledTimes(1)
  })
})
