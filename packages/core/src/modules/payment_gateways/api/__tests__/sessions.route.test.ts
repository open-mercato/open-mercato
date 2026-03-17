/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockReadJsonSafe = jest.fn()
const mockRunApiInterceptorsBefore = jest.fn()
const mockRunApiInterceptorsAfter = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockCreatePaymentSession = jest.fn()
const mockPersistAndFlush = jest.fn()
const mockCreateEntity = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((request: Request) => mockReadJsonSafe(request)),
}))

jest.mock('@open-mercato/shared/lib/crud/interceptor-runner', () => ({
  runApiInterceptorsBefore: jest.fn((args: unknown) => mockRunApiInterceptorsBefore(args)),
  runApiInterceptorsAfter: jest.fn((args: unknown) => mockRunApiInterceptorsAfter(args)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(),
  runCrudMutationGuardAfterSuccess: jest.fn(),
}))

type SessionsRouteModule = typeof import('../sessions/route')

let POST: SessionsRouteModule['POST']
let metadata: SessionsRouteModule['metadata']
let openApi: SessionsRouteModule['openApi']

describe('payment gateway sessions route', () => {
  beforeAll(async () => {
    const routeModule = await import('../sessions/route')
    POST = routeModule.POST
    metadata = routeModule.metadata
    openApi = routeModule.openApi
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['payment_gateways.manage'],
    })
    mockReadJsonSafe.mockResolvedValue({
      providerKey: 'stripe',
      amount: 49.99,
      currencyCode: 'USD',
      paymentLink: {
        enabled: true,
        title: 'Invoice INV-10024',
      },
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn((token: string) => {
        if (token === 'em') {
          return {
            create: mockCreateEntity,
            persistAndFlush: mockPersistAndFlush,
          }
        }
        if (token === 'paymentGatewayService') {
          return {
            createPaymentSession: mockCreatePaymentSession,
          }
        }
        return undefined
      }),
    })
    mockCreatePaymentSession.mockResolvedValue({
      transaction: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        providerKey: 'stripe',
        paymentId: '123e4567-e89b-12d3-a456-426614174001',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      session: {
        sessionId: 'pi_test_123',
        status: 'pending',
        redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        providerData: {
          paymentIntentId: 'pi_test_123',
        },
      },
    })
    mockCreateEntity.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      id: '123e4567-e89b-12d3-a456-426614174002',
      ...data,
    }))
    mockPersistAndFlush.mockResolvedValue(undefined)
    mockRunApiInterceptorsBefore.mockResolvedValue({
      ok: true,
      request: {
        method: 'POST',
        url: 'http://localhost/api/payment_gateways/sessions',
        headers: {},
        body: {
          providerKey: 'stripe',
          amount: 49.99,
          currencyCode: 'USD',
          paymentLink: {
            enabled: true,
            title: 'Invoice INV-10024',
          },
        },
      },
      metadataByInterceptor: {},
    })
    mockRunApiInterceptorsAfter.mockImplementation(async (args: {
      response: { statusCode: number; body: unknown; headers: Record<string, string> }
    }) => ({
      ok: true,
      statusCode: args.response.statusCode,
      body: args.response.body,
      headers: args.response.headers,
    }))
  })

  it('declares payment gateway manage access in metadata', () => {
    expect(metadata.POST).toEqual({
      requireAuth: true,
      requireFeatures: ['payment_gateways.manage'],
    })
  })

  it('rejects pay-by-link creation without a title', async () => {
    mockReadJsonSafe.mockResolvedValue({
      providerKey: 'stripe',
      amount: 49.99,
      currencyCode: 'USD',
      paymentLink: {
        enabled: true,
      },
    })
    mockRunApiInterceptorsBefore.mockResolvedValue({
      ok: true,
      request: {
        method: 'POST',
        url: 'http://localhost/api/payment_gateways/sessions',
        headers: {},
        body: {
          providerKey: 'stripe',
          amount: 49.99,
          currencyCode: 'USD',
          paymentLink: {
            enabled: true,
          },
        },
      },
      metadataByInterceptor: {},
    })

    const response = await POST(new Request('http://localhost/api/payment_gateways/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid payload',
      fieldErrors: {
        paymentLinkTitle: 'Enter a title for the payment link.',
      },
    })
  })

  it('documents pay-by-link request and response examples in OpenAPI', () => {
    const postDoc = openApi.methods.POST
    expect(postDoc?.requestBody?.example).toMatchObject({
      providerKey: 'stripe',
      paymentLink: {
        enabled: true,
        title: 'Invoice INV-10024',
        metadata: {
          logoUrl: 'https://merchant.example.com/logo.svg',
        },
        customFieldsetCode: 'invoice',
        customFields: {
          supportEmail: 'billing@example.com',
        },
      },
    })
    expect(postDoc?.responses?.find((response) => response.status === 201)?.example).toMatchObject({
      paymentLinkId: '123e4567-e89b-12d3-a456-426614174002',
      paymentLinkToken: 'pay_6NQ2gZf1wH7kPx',
      paymentLinkUrl: 'https://merchant.example.com/pay/pay_6NQ2gZf1wH7kPx',
    })
  })

  it('uses the generated payment link URL for hosted redirect return paths', async () => {
    mockReadJsonSafe.mockResolvedValue({
      providerKey: 'stripe',
      amount: 49.99,
      currencyCode: 'USD',
      providerInput: {
        checkoutProfile: 'payment_element_redirect',
      },
      paymentLink: {
        enabled: true,
        title: 'Invoice INV-10024',
      },
    })
    mockRunApiInterceptorsBefore.mockResolvedValue({
      ok: true,
      request: {
        method: 'POST',
        url: 'http://localhost/api/payment_gateways/sessions',
        headers: {},
        body: {
          providerKey: 'stripe',
          amount: 49.99,
          currencyCode: 'USD',
          providerInput: {
            checkoutProfile: 'payment_element_redirect',
          },
          paymentLink: {
            enabled: true,
            title: 'Invoice INV-10024',
          },
        },
      },
      metadataByInterceptor: {},
    })

    const response = await POST(new Request('http://localhost/api/payment_gateways/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))
    const body = await response.json()
    const createSessionInput = mockCreatePaymentSession.mock.calls[0]?.[0] as Record<string, unknown>

    expect(response.status).toBe(201)
    expect(body.paymentLinkUrl).toMatch(/^http:\/\/localhost\/pay\/[^/?#]+$/)
    expect(createSessionInput.successUrl).toBe(`${body.paymentLinkUrl}?checkout=success`)
    expect(createSessionInput.cancelUrl).toBe(`${body.paymentLinkUrl}?checkout=cancelled`)
  })
})
