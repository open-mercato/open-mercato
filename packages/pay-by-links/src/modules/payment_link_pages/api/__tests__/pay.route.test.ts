/** @jest-environment node */

const mockCreateRequestContainer = jest.fn()
const mockLoadPublicPaymentLinkState = jest.fn()
const mockApplyResponseEnricherToRecord = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

jest.mock('@open-mercato/shared/lib/crud/enricher-runner', () => ({
  applyResponseEnricherToRecord: jest.fn((...args: unknown[]) => mockApplyResponseEnricherToRecord(...args)),
}))

jest.mock('../../lib/public-payment-links', () => ({
  loadPublicPaymentLinkState: jest.fn((...args: unknown[]) => mockLoadPublicPaymentLinkState(...args)),
}))

type RouteModule = typeof import('../pay/[token]/route')

let GET: RouteModule['GET']

describe('payment link pages pay route', () => {
  beforeAll(async () => {
    const routeModule = await import('../pay/[token]/route')
    GET = routeModule.GET
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn(() => ({ mocked: true })),
    })
    mockLoadPublicPaymentLinkState.mockResolvedValue({
      link: {
        id: 'link-1',
        token: 'pay_token',
        title: 'Invoice link',
        description: 'Secure payment',
        providerKey: 'mock',
        status: 'active',
        completedAt: null,
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      transaction: {
        id: 'txn-1',
        paymentId: 'payment-1',
        providerKey: 'mock',
        providerSessionId: 'session-1',
        unifiedStatus: 'pending',
        gatewayStatus: 'pending',
        redirectUrl: 'https://example.com/checkout',
        clientSecret: null,
        amount: '49.99',
        currencyCode: 'USD',
        gatewayMetadata: { checkoutProfile: 'hosted' },
        createdAt: new Date('2026-03-17T10:00:00.000Z'),
        updatedAt: new Date('2026-03-17T10:05:00.000Z'),
      },
      accessGranted: true,
      passwordRequired: false,
      paymentLinkWidgetSpotId: 'payment-gateways.payment-link:mock',
      amount: 49.99,
      currencyCode: 'USD',
      pageMetadata: { brandName: 'Acme Commerce' },
      customFields: { supportEmail: 'billing@example.com' },
      customFieldsetCode: 'invoice',
      customerCapture: {
        enabled: true,
        companyRequired: false,
        collectedAt: '2026-03-17T10:10:00.000Z',
        companyEntityId: 'company-1',
        personEntityId: 'person-1',
        companyName: 'Acme Commerce',
        personName: 'Jane Doe',
        email: 'jane@example.com',
      },
    })
    mockApplyResponseEnricherToRecord.mockImplementation(async (record: Record<string, unknown>) => ({
      record: {
        ...record,
        _example: { marker: true },
      },
      _meta: {
        enrichedBy: ['example.page-enricher'],
      },
    }))
  })

  it('returns UMES-aware page payload with metadata and enricher meta', async () => {
    const response = await GET(
      new Request('http://localhost/api/payment_link_pages/pay/pay_token'),
      { params: { token: 'pay_token' } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      link: {
        id: 'link-1',
        metadata: { brandName: 'Acme Commerce' },
        customFields: { supportEmail: 'billing@example.com' },
        customFieldsetCode: 'invoice',
        customerCapture: {
          enabled: true,
          companyRequired: false,
          collected: true,
        },
      },
      transaction: {
        id: 'txn-1',
        paymentId: 'payment-1',
      },
      _example: { marker: true },
      _meta: {
        enrichedBy: ['example.page-enricher'],
      },
    })
  })
})
