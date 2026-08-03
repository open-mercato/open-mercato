/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/entities/api/records'

const mockQE = {
  query: jest.fn(async (_entityId: string, _options: { filters?: Record<string, unknown> }) => ({
    items: [
      { id: 'rec-1', cf_title: 'Berlin Conference', created_at: '2024-10-03T00:00:00Z' },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
  })),
}

const mockEm = {
  findOne: jest.fn(async () => ({ id: 'ce-1', entityId: 'example:custom' })),
  getKysely: () => ({
    selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({ execute: async () => [] }) }) }) }),
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'queryEngine' ? mockQE : mockEm) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScope: async () => ({ selectedId: 'org', filterIds: ['org'] }),
  getSelectedOrganizationFromRequest: () => 'org',
}))

describe('GET /api/entities/records server-side search', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('passes an OR of ilike clauses across requested searchFields to the query engine', async () => {
    const url = 'http://x/api/entities/records?entityId=example:custom&page=1&pageSize=50&search=Berlin&searchFields=id,title,location'
    const req = new Request(url)
    const res = await GET(req)
    expect(res.status).toBe(200)

    expect(mockQE.query).toHaveBeenCalled()
    const [, opts] = mockQE.query.mock.calls[0] as [string, { filters?: Record<string, unknown> }]
    const orClauses = (opts?.filters as any)?.$or as Array<Record<string, unknown>>
    expect(Array.isArray(orClauses)).toBe(true)
    expect(orClauses).toEqual([
      { id: { $ilike: '%Berlin%' } },
      { title: { $ilike: '%Berlin%' } },
      { location: { $ilike: '%Berlin%' } },
    ])
  })

  it('defaults to searching the id field when no searchFields are provided', async () => {
    const url = 'http://x/api/entities/records?entityId=example:custom&page=1&pageSize=50&search=abc'
    const req = new Request(url)
    const res = await GET(req)
    expect(res.status).toBe(200)

    const [, opts] = mockQE.query.mock.calls[0] as [string, { filters?: Record<string, unknown> }]
    expect((opts?.filters as any)?.$or).toEqual([{ id: { $ilike: '%abc%' } }])
  })

  it('does not add a search filter when the term is blank', async () => {
    const url = 'http://x/api/entities/records?entityId=example:custom&page=1&pageSize=50&search=%20%20&searchFields=title'
    const req = new Request(url)
    const res = await GET(req)
    expect(res.status).toBe(200)

    const [, opts] = mockQE.query.mock.calls[0] as [string, { filters?: Record<string, unknown> }]
    expect((opts?.filters as any)?.$or).toBeUndefined()
  })

  it('does not treat search/searchFields as record filters', async () => {
    const url = 'http://x/api/entities/records?entityId=example:custom&page=1&pageSize=50&search=Berlin&searchFields=title'
    const req = new Request(url)
    const res = await GET(req)
    expect(res.status).toBe(200)

    const [, opts] = mockQE.query.mock.calls[0] as [string, { filters?: Record<string, unknown> }]
    expect((opts?.filters as any)?.search).toBeUndefined()
    expect((opts?.filters as any)?.searchFields).toBeUndefined()
  })
})
