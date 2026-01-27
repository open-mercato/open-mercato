import { GET } from '../route'

jest.mock('../../utils', () => ({
  resolveWidgetScope: jest.fn(async () => ({
    container: {},
    em: {},
    tenantId: '33333333-3333-3333-3333-333333333333',
    organizationIds: ['22222222-2222-2222-2222-222222222222'],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (k: string, fb?: string) => fb ?? k,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: jest.fn(async () => [
    [
      {
        id: '11111111-1111-1111-1111-111111111111',
        orderNumber: 'SO-1001',
        status: 'pending',
        fulfillmentStatus: null,
        paymentStatus: null,
        customerSnapshot: { displayName: 'Acme Corp' },
        customerEntityId: '44444444-4444-4444-4444-444444444444',
        grandTotalNetAmount: '100.00',
        grandTotalGrossAmount: '120.00',
        currencyCode: 'USD',
        createdAt: new Date('2026-01-27T10:00:00.000Z'),
      },
    ],
    1,
  ]),
}))

describe('sales new-orders widget route', () => {
  it('returns 200 with items on happy path', async () => {
    const req = new Request('http://localhost/api?limit=5')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items[0]).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      orderNumber: 'SO-1001',
      customerName: 'Acme Corp',
    })
  })

  it('returns 400 on invalid limit', async () => {
    const req = new Request('http://localhost/api?limit=0')
    const res = await GET(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })
})
