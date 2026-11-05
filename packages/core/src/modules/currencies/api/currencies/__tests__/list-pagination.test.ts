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

const makeRow = (i: number) => ({
  id: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
  organizationId: orgId,
  tenantId,
  code: `C${i.toString().padStart(2, '0')}`,
  name: `Currency ${i}`,
  symbol: null,
  decimalPlaces: 2,
  thousandsSeparator: null,
  decimalSeparator: null,
  isBase: false,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
})

describe('GET /api/currencies/currencies pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('pushes limit and offset to findAndCount instead of slicing in memory', async () => {
    em.findAndCount.mockResolvedValue([[makeRow(1)], 137])
    const res = await GET(
      new Request('http://localhost/api/currencies/currencies?page=3&pageSize=25'),
    )
    expect(em.findAndCount).toHaveBeenCalledTimes(1)
    const [entity, where, options] = em.findAndCount.mock.calls[0]
    expect(entity).toBeDefined()
    expect(where).toEqual(
      expect.objectContaining({ tenantId, organizationId: orgId, deletedAt: null }),
    )
    expect(options).toEqual(
      expect.objectContaining({
        orderBy: { code: 'ASC' },
        limit: 25,
        offset: 50,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(137)
    expect(body.page).toBe(3)
    expect(body.pageSize).toBe(25)
    expect(body.totalPages).toBe(Math.ceil(137 / 25))
  })

  it('respects sortField + sortDir when passed', async () => {
    em.findAndCount.mockResolvedValue([[], 0])
    await GET(
      new Request('http://localhost/api/currencies/currencies?page=1&pageSize=50&sortField=name&sortDir=desc'),
    )
    const options = em.findAndCount.mock.calls[0][2]
    expect(options.orderBy).toEqual({ name: 'DESC' })
    expect(options.limit).toBe(50)
    expect(options.offset).toBe(0)
  })

  it('returns the rows that findAndCount produced without applying any JS slice', async () => {
    const rows = [makeRow(1), makeRow(2), makeRow(3)]
    em.findAndCount.mockResolvedValue([rows, 3])
    const res = await GET(
      new Request('http://localhost/api/currencies/currencies?page=1&pageSize=50'),
    )
    const body = (await res.json()) as { items: { id: string }[] }
    expect(body.items.map((it) => it.id)).toEqual(rows.map((r) => r.id))
  })
})
