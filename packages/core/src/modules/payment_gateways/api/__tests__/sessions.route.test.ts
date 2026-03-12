/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockReadJsonSafe = jest.fn()
const mockRunApiInterceptorsBefore = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((request: Request) => mockReadJsonSafe(request)),
}))

jest.mock('@open-mercato/shared/lib/crud/interceptor-runner', () => ({
  runApiInterceptorsBefore: jest.fn((args: unknown) => mockRunApiInterceptorsBefore(args)),
  runApiInterceptorsAfter: jest.fn(),
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
      },
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn((token: string) => {
        if (token === 'em') return {}
        return undefined
      }),
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
  })

  it('declares payment gateway manage access in metadata', () => {
    expect(metadata.POST).toEqual({
      requireAuth: true,
      requireFeatures: ['payment_gateways.manage'],
    })
  })

  it('rejects pay-by-link creation without a title', async () => {
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
      },
    })
    expect(postDoc?.responses?.find((response) => response.status === 201)?.example).toMatchObject({
      paymentLinkId: '123e4567-e89b-12d3-a456-426614174002',
      paymentLinkToken: 'pay_6NQ2gZf1wH7kPx',
      paymentLinkUrl: 'https://merchant.example.com/pay/pay_6NQ2gZf1wH7kPx',
    })
  })
})
