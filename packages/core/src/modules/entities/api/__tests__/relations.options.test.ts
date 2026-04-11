/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/entities/api/relations/options'

const mockQE = {
  query: jest.fn(async () => ({
    items: [
      { id: 'rec-1', title: 'Alpha' },
      { id: 'rec-2', title: 'Beta' },
    ],
  })),
}

const mockEm = {}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (key: string) => (key === 'queryEngine' ? mockQE : mockEm) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }),
}))

describe('GET /api/entities/relations/options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('supports id-scoped lookups through the existing relation options permission surface', async () => {
    const req = new Request(
      'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=title&ids=rec-1,rec-2',
    )

    const res = await GET(req)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      items: [
        { value: 'rec-1', label: 'Alpha' },
        { value: 'rec-2', label: 'Beta' },
      ],
    })
    expect(mockQE.query).toHaveBeenCalledWith(
      'virtual:case_study',
      expect.objectContaining({
        tenantId: 't1',
        organizationId: 'org',
        fields: ['id', 'title'],
        filters: { id: { $in: ['rec-1', 'rec-2'] } },
        page: { page: 1, pageSize: 2 },
      }),
    )
  })

  it('returns only the requested safe route context fields', async () => {
    mockQE.query.mockResolvedValueOnce({
      items: [
        { id: 'rec-1', title: 'Ada Lovelace', kind: 'person' },
      ],
    })

    const req = new Request(
      'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=title&ids=rec-1&routeContextFields=kind,email',
    )

    const res = await GET(req)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      items: [
        { value: 'rec-1', label: 'Ada Lovelace', routeContext: { kind: 'person' } },
      ],
    })
    expect(mockQE.query).toHaveBeenCalledWith(
      'customers:customer_entity',
      expect.objectContaining({
        fields: ['id', 'title', 'kind'],
        filters: { id: 'rec-1' },
        page: { page: 1, pageSize: 1 },
      }),
    )
  })
})
