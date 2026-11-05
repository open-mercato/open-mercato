import { GET } from '../route'

// Minimal mocks for dependencies used by the route
jest.mock('../../utils', () => ({
  resolveWidgetScope: jest.fn(async () => ({
    container: {},
    em: {
      find: jest.fn(async () => [
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Deal A',
          status: 'open',
          organizationId: '22222222-2222-2222-2222-222222222222',
          createdAt: new Date('2025-01-01T10:00:00.000Z'),
          ownerUserId: null,
          valueAmount: null,
          valueCurrency: null,
        },
      ]),
    },
    tenantId: '33333333-3333-3333-3333-333333333333',
    organizationIds: ['22222222-2222-2222-2222-222222222222'],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (k: string, fb?: string) => fb ?? k,
  }),
}))

describe('customers new-deals widget route', () => {
  it('returns 200 with items on happy path', async () => {
    const req = new Request('http://localhost/api?limit=5')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items[0]).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Deal A',
      status: 'open',
      organizationId: '22222222-2222-2222-2222-222222222222',
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
