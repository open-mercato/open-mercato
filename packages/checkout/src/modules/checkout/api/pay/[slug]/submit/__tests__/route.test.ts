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

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(),
  RATE_LIMIT_FALLBACK_KEY: 'global',
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
  const originalAppUrl = process.env.APP_URL
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl
    if (originalPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl
  })

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.APP_URL = 'https://merchant.example'
    delete process.env.NEXT_PUBLIC_APP_URL

    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'em') return { findOne: mockEmFindOne }
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

  it('pins gateway success/cancel URLs to the configured origin instead of the spoofable request Host', async () => {
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(createLink())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction({ gatewayTransactionId: GATEWAY_TRANSACTION_ID }))

    // Bare Next.js: the inbound Host flows into req.url and there is no Origin/Referer.
    const response = await POST(
      new Request('https://evil.example/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'pin-key-1234567890',
        },
        body: JSON.stringify({ customerData: {}, acceptedLegalConsents: {}, amount: 1 }),
      }),
      { params: { slug: 'donate' } },
    )

    expect(response.status).toBe(201)
    expect(mockCreatePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: `https://merchant.example/pay/donate/success/${TRANSACTION_ID}`,
        cancelUrl: `https://merchant.example/pay/donate/cancel/${TRANSACTION_ID}`,
      }),
    )
  })

  it('pins the embedded session returnUrl/cancelUrl to the configured origin', async () => {
    mockEmFindOne.mockResolvedValue({
      id: GATEWAY_TRANSACTION_ID,
      providerKey: 'test_gateway',
      redirectUrl: null,
      gatewayMetadata: {
        clientSession: {
          type: 'embedded',
          rendererKey: 'inline',
          payload: {},
        },
      },
    })
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(createLink())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction({ gatewayTransactionId: GATEWAY_TRANSACTION_ID }))

    const response = await POST(
      new Request('https://evil.example/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'embedded-key-1234567',
        },
        body: JSON.stringify({ customerData: {}, acceptedLegalConsents: {}, amount: 1 }),
      }),
      { params: { slug: 'donate' } },
    )

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.paymentSession.payload.returnUrl).toBe(
      `https://merchant.example/pay/donate/success/${TRANSACTION_ID}`,
    )
    expect(payload.paymentSession.payload.cancelUrl).toBe(
      `https://merchant.example/pay/donate/cancel/${TRANSACTION_ID}`,
    )
  })

  it('rejects a spoofed X-Forwarded-Host that is not in the configured allowlist', async () => {
    const response = await POST(
      new Request('https://merchant.example/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'spoof-key-1234567890',
          'x-forwarded-host': 'evil.example',
        },
        body: JSON.stringify({ customerData: {}, acceptedLegalConsents: {}, amount: 1 }),
      }),
      { params: { slug: 'donate' } },
    )

    expect(response.status).toBe(403)
    const payload = await response.json()
    expect(payload.error).toBe('Invalid request host')
    expect(findOneWithDecryption as jest.Mock).not.toHaveBeenCalled()
  })

  it('accepts a correctly TLS-proxied request (internal http upstream, X-Forwarded-Proto https)', async () => {
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(createLink())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction())
      .mockResolvedValueOnce(createTransaction({ gatewayTransactionId: GATEWAY_TRANSACTION_ID }))

    // Proxy terminated TLS: the upstream connection is plain http to an internal
    // host, while X-Forwarded-* carry the real public origin (matches APP_URL).
    const response = await POST(
      new Request('http://10.0.0.5:3000/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'proxied-key-12345678',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'merchant.example',
          host: '10.0.0.5:3000',
        },
        body: JSON.stringify({ customerData: {}, acceptedLegalConsents: {}, amount: 1 }),
      }),
      { params: { slug: 'donate' } },
    )

    expect(response.status).toBe(201)
    expect(mockCreatePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: `https://merchant.example/pay/donate/success/${TRANSACTION_ID}`,
        cancelUrl: `https://merchant.example/pay/donate/cancel/${TRANSACTION_ID}`,
      }),
    )
  })

  it('closes the self-pass bypass where a matching spoofed Origin and Host are supplied together', async () => {
    const response = await POST(
      new Request('https://merchant.example/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'self-pass-key-123456',
          origin: 'https://evil.example',
          host: 'evil.example',
        },
        body: JSON.stringify({ customerData: {}, acceptedLegalConsents: {}, amount: 1 }),
      }),
      { params: { slug: 'donate' } },
    )

    expect(response.status).toBe(403)
    const payload = await response.json()
    expect(payload.error).toBe('Invalid request host')
  })
})
