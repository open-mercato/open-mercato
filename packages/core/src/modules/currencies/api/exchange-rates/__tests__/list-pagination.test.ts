/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

const em = {
  findAndCount: jest.fn(),
} as { findAndCount: jest.Mock }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId,
    orgId,
  })),
}))

import { GET } from '../route'

const makeRate = (i: number) => ({
  id: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
  organizationId: orgId,
  tenantId,
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  rate: (1 + i / 100).toFixed(6),
  date: new Date(`2026-01-${(i % 28 + 1).toString().padStart(2, '0')}T00:00:00.000Z`),
  source: 'TEST',
  type: null,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
})

describe('GET /api/currencies/exchange-rates pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('pushes limit and offset to findAndCount instead of slicing in memory', async () => {
    em.findAndCount.mockResolvedValue([[makeRate(1)], 5_000])
    const res = await GET(
      new Request('http://localhost/api/currencies/exchange-rates?page=10&pageSize=20'),
    )
    expect(em.findAndCount).toHaveBeenCalledTimes(1)
    const [entity, where, options] = em.findAndCount.mock.calls[0]
    expect(entity).toBeDefined()
    expect(where).toEqual(
      expect.objectContaining({ tenantId, organizationId: orgId, deletedAt: null }),
    )
    expect(options).toEqual(
      expect.objectContaining({
        orderBy: { date: 'DESC' },
        limit: 20,
        offset: 180,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }
    expect(body.total).toBe(5_000)
    expect(body.page).toBe(10)
    expect(body.pageSize).toBe(20)
    expect(body.totalPages).toBe(250)
  })

  it('respects sortField when passed', async () => {
    em.findAndCount.mockResolvedValue([[], 0])
    await GET(
      new Request('http://localhost/api/currencies/exchange-rates?page=1&pageSize=50&sortField=fromCurrencyCode&sortDir=asc'),
    )
    const options = em.findAndCount.mock.calls[0][2]
    expect(options.orderBy).toEqual({ fromCurrencyCode: 'ASC' })
    expect(options.limit).toBe(50)
    expect(options.offset).toBe(0)
  })

  it('returns the rows that findAndCount produced without applying any JS slice', async () => {
    const rates = [makeRate(1), makeRate(2)]
    em.findAndCount.mockResolvedValue([rates, 2])
    const res = await GET(
      new Request('http://localhost/api/currencies/exchange-rates?page=1&pageSize=50'),
    )
    const body = (await res.json()) as { items: { id: string }[] }
    expect(body.items.map((it) => it.id)).toEqual(rates.map((r) => r.id))
  })
})
