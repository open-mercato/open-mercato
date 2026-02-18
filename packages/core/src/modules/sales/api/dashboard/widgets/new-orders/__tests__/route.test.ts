import { GET } from '../route'

const mockResolveWidgetScope = jest.fn()
const mockFindAndCountWithDecryption = jest.fn()
const mockResolveDateRange = jest.fn()

jest.mock('../../../../../../customers/api/dashboard/widgets/utils', () => ({
  resolveWidgetScope: (...args: unknown[]) => mockResolveWidgetScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
}))

jest.mock('@open-mercato/ui/backend/date-range', () => ({
  resolveDateRange: (...args: unknown[]) => mockResolveDateRange(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => unknown) => await fn(),
}))

describe('sales new-orders widget route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveWidgetScope.mockResolvedValue({
      container: { resolve: () => { throw new Error('cache unavailable') } },
      em: { marker: 'em' },
      tenantId: '33333333-3333-4333-8333-333333333333',
      organizationIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    })
    mockResolveDateRange.mockReturnValue({
      start: new Date('2026-02-01T00:00:00.000Z'),
      end: new Date('2026-02-07T23:59:59.999Z'),
    })
    mockFindAndCountWithDecryption.mockResolvedValue([
      [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          orderNumber: 'SO-1001',
          status: 'open',
          fulfillmentStatus: null,
          paymentStatus: null,
          customerSnapshot: { displayName: 'Acme Inc' },
          customerEntityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          grandTotalNetAmount: '100.00',
          grandTotalGrossAmount: '123.00',
          currencyCode: 'USD',
          createdAt: new Date('2026-02-05T10:00:00.000Z'),
        },
      ],
      1,
    ])
  })

  it('returns 200 with items and total', async () => {
    const req = new Request('http://localhost/api/sales/dashboard/widgets/new-orders?limit=5&datePeriod=last7d')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      orderNumber: 'SO-1001',
      customerName: 'Acme Inc',
      grossAmount: '123.00',
    })

    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      expect.objectContaining({ marker: 'em' }),
      expect.any(Function),
      expect.objectContaining({
        tenantId: '33333333-3333-4333-8333-333333333333',
        deletedAt: null,
        organizationId: { $in: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] },
      }),
      expect.objectContaining({ limit: 5 }),
      { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: null }
    )
  })

  it('returns 400 on invalid query parameters', async () => {
    const req = new Request('http://localhost/api/sales/dashboard/widgets/new-orders?limit=0')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(mockResolveWidgetScope).not.toHaveBeenCalled()
  })

  it('uses custom date range when datePeriod=custom', async () => {
    const req = new Request(
      'http://localhost/api/sales/dashboard/widgets/new-orders?datePeriod=custom&customFrom=2026-02-03T00:00:00.000Z&customTo=2026-02-04T00:00:00.000Z'
    )

    const res = await GET(req)
    expect(res.status).toBe(200)

    const where = mockFindAndCountWithDecryption.mock.calls[0][2]
    expect(where.createdAt.$gte.toISOString()).toBe('2026-02-03T00:00:00.000Z')
    expect(where.createdAt.$lte.toISOString()).toBe('2026-02-04T00:00:00.000Z')
    expect(mockResolveDateRange).not.toHaveBeenCalled()
  })
})
