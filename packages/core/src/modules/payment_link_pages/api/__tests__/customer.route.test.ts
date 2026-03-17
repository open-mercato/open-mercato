/** @jest-environment node */

const mockCreateRequestContainer = jest.fn()
const mockReadJsonSafe = jest.fn()
const mockLoadPublicPaymentLinkState = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockCommandExecute = jest.fn()
const mockFlush = jest.fn()
const mockFindOne = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((request: Request) => mockReadJsonSafe(request)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../../payment_gateways/lib/public-payment-links', () => ({
  loadPublicPaymentLinkState: jest.fn((...args: unknown[]) => mockLoadPublicPaymentLinkState(...args)),
}))

type RouteModule = typeof import('../pay/[token]/customer/route')

let POST: RouteModule['POST']

describe('payment link customer capture route', () => {
  beforeAll(async () => {
    const routeModule = await import('../pay/[token]/customer/route')
    POST = routeModule.POST
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockReadJsonSafe.mockResolvedValue({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+48 555 100 200',
      companyName: 'Acme Commerce',
      acceptedTerms: true,
    })
    mockLoadPublicPaymentLinkState.mockResolvedValue({
      link: {
        id: 'link-1',
        token: 'pay_token',
        title: 'Invoice link',
        description: 'Secure payment',
        providerKey: 'mock',
        status: 'active',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        metadata: null,
      },
      transaction: {
        id: 'txn-1',
        paymentId: 'payment-1',
        providerKey: 'mock',
      },
      accessGranted: true,
      passwordRequired: false,
      paymentLinkWidgetSpotId: 'payment-gateways.payment-link:mock',
      amount: 49.99,
      currencyCode: 'USD',
      pageMetadata: { brandName: 'Acme' },
      customFields: { supportEmail: 'billing@example.com' },
      customFieldsetCode: 'invoice',
      customerCapture: {
        enabled: true,
        companyRequired: false,
        termsRequired: true,
        termsMarkdown: '## Terms',
        collectedAt: null,
        termsAcceptedAt: null,
        companyEntityId: null,
        personEntityId: null,
        companyName: null,
        personName: null,
        email: null,
      },
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') {
          return { execute: mockCommandExecute }
        }
        if (name === 'em') {
          return {
            flush: mockFlush,
            findOne: mockFindOne,
          }
        }
        return undefined
      }),
    })
    mockFindOneWithDecryption.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    mockCommandExecute
      .mockResolvedValueOnce({ result: { entityId: 'company-1', companyId: 'company-profile-1' } })
      .mockResolvedValueOnce({ result: { entityId: 'person-1', personId: 'person-profile-1' } })
    mockFlush.mockResolvedValue(undefined)
    mockFindOne.mockResolvedValue(null)
  })

  it('creates missing customer records and stores capture metadata on the payment link', async () => {
    const response = await POST(
      new Request('http://localhost/api/payment_link_pages/pay/pay_token/customer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: { token: 'pay_token' } },
    )

    expect(response.status).toBe(200)
    expect(mockCommandExecute).toHaveBeenCalledTimes(2)
    expect(mockCommandExecute).toHaveBeenNthCalledWith(
      1,
      'customers.companies.create',
      expect.objectContaining({
        input: expect.objectContaining({ displayName: 'Acme Commerce' }),
      }),
    )
    expect(mockCommandExecute).toHaveBeenNthCalledWith(
      2,
      'customers.people.create',
      expect.objectContaining({
        input: expect.objectContaining({
          displayName: 'Jane Doe',
          primaryEmail: 'jane@example.com',
          companyEntityId: 'company-1',
        }),
      }),
    )
    expect(mockFlush).toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      customerCapture: {
        collected: true,
      },
    })
  })

  it('rejects the submission when required terms are not accepted', async () => {
    mockReadJsonSafe.mockResolvedValue({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      acceptedTerms: false,
    })

    const response = await POST(
      new Request('http://localhost/api/payment_link_pages/pay/pay_token/customer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: { token: 'pay_token' } },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Terms must be accepted',
    })
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })
})
