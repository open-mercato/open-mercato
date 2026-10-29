/** @jest-environment node */
import { GET } from '../transactions/route'

const mockResolve = jest.fn()
const mockGetAuth = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))

type RawWhere = { sql: string; params: unknown[] }

function makeQueryBuilder(rawWheres: RawWhere[]) {
  const qb = {
    where: jest.fn(() => qb),
    andWhere: jest.fn((condition: unknown, params?: unknown[]) => {
      if (typeof condition === 'string') rawWheres.push({ sql: condition, params: params ?? [] })
      return qb
    }),
    clone: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    limit: jest.fn(() => qb),
    offset: jest.fn(() => qb),
    getResultList: jest.fn(async () => []),
    getCount: jest.fn(async () => 0),
  }
  return qb
}

function listRequest(query: string): Request {
  return {
    method: 'GET',
    url: `http://localhost/api/payment_gateways/transactions?${query}`,
    headers: new Headers(),
  } as unknown as Request
}

describe('payment_gateways transactions list route', () => {
  let rawWheres: RawWhere[]

  beforeEach(() => {
    jest.clearAllMocks()
    rawWheres = []
    const qb = makeQueryBuilder(rawWheres)
    mockResolve.mockImplementation((key: string) => {
      if (key === 'em') return { createQueryBuilder: jest.fn(() => qb) }
      throw new Error(`[internal] unexpected resolve(${key})`)
    })
    mockGetAuth.mockResolvedValue({
      sub: '33333333-3333-4333-8333-333333333333',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
  })

  it('attaches the escape clause to every ilike predicate of the search filter', async () => {
    const response = await GET(listRequest('page=1&pageSize=5&search=mock_pi'))

    expect(response.status).toBe(200)
    expect(rawWheres).toHaveLength(1)
    const { sql } = rawWheres[0]
    const ilikeCount = sql.match(/\bilike\s+\?/gi)?.length ?? 0
    const escapedIlikeCount = sql.match(/\bilike\s+\?\s+escape\s+'\\'/gi)?.length ?? 0
    expect(ilikeCount).toBe(6)
    expect(escapedIlikeCount).toBe(ilikeCount)
    expect(sql).not.toMatch(/\)\s*escape\b/i)
  })

  it('binds the escaped search term once per searched column', async () => {
    await GET(listRequest('search=50%25_x'))

    expect(rawWheres).toHaveLength(1)
    expect(rawWheres[0].params).toEqual(Array(6).fill('%50\\%\\_x%'))
  })

  it('adds no raw search filter when search is absent', async () => {
    const response = await GET(listRequest('page=1&pageSize=5'))

    expect(response.status).toBe(200)
    expect(rawWheres).toHaveLength(0)
  })
})
