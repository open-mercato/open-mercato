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

// Entity ids the fake ORM metadata knows about, keyed by the class name the
// resolver derives from the id's entity segment.
const registeredTables: Record<string, string> = {
  CustomerEntity: 'customer_entities',
  CatalogProduct: 'catalog_products',
}

const mockRbac = { userHasAllFeatures: jest.fn<Promise<boolean>, [string, string[], unknown]>() }
const mockScope = {
  tenantId: 't1', selectedId: 'selected-org', filterIds: ['selected-org'], allowedIds: ['selected-org'],
}
const mockResolveFeatureCheckContext = jest.fn(async () => ({ scope: mockScope, organizationId: 'selected-org' }))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: () => mockResolveFeatureCheckContext(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const mockEm = {
  // Custom (doc-storage) entities: registered rows make an id queryable.
  findOne: jest.fn(async (_entity: unknown, where: { entityId?: string }) => (
    typeof where?.entityId === 'string' && where.entityId.startsWith('virtual:')
      ? { labelField: null }
      : null
  )),
  getMetadata: () => ({
    find: (className: string) => (
      registeredTables[className] ? { tableName: registeredTables[className] } : undefined
    ),
    getAll: () => Object.values(registeredTables).map((tableName) => ({ tableName })),
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (key: string) => {
    if (key === 'rbacService') return mockRbac
    return key === 'queryEngine' ? mockQE : mockEm
  } }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ sub: 'actor', orgId: 'org', tenantId: 't1' }),
}))

describe('GET /api/entities/relations/options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
  })

  it.each(['q=Alpha', 'ids=rec-1'])('allows a catalog viewer to resolve product titles with %s', async (query) => {
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const response = await GET(new Request(`http://x/api/entities/relations/options?entityId=catalog:catalog_product&labelField=name&${query}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ items: [{ value: 'rec-1', label: 'Alpha' }, { value: 'rec-2', label: 'Beta' }] })
    expect(mockRbac.userHasAllFeatures).toHaveBeenLastCalledWith('actor', ['catalog.products.view'], { tenantId: 't1', organizationId: 'selected-org' })
    expect(mockQE.query).toHaveBeenCalledWith('catalog:catalog_product', expect.objectContaining({
      tenantId: 't1',
      organizationId: 'selected-org',
      fields: ['id', 'title'],
      filters: query.startsWith('q=') ? { title: { $ilike: '%Alpha%' } } : { id: 'rec-1' },
    }))
  })

  it('denies a caller without either feature before querying product options', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=catalog:catalog_product'))
    expect(response.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('denies a catalog viewer outside the allowed organization before querying', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)
    mockResolveFeatureCheckContext.mockResolvedValueOnce({ scope: mockScope, organizationId: 'selected-org' })
      .mockResolvedValueOnce({ scope: { ...mockScope, filterIds: ['other-org'] }, organizationId: 'selected-org' })
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=catalog:catalog_product'))
    expect(response.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it.each(['customers:customer_entity', 'catalog:catalog_product&labelField=metadata'])('keeps other targets and columns gated: %s', async (target) => {
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)
    const response = await GET(new Request(`http://x/api/entities/relations/options?entityId=${target}`))
    expect(response.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
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

  it('caps pageSize at 200 even when more ids are requested', async () => {
    const manyIds = Array.from({ length: 300 }, (_, index) => `id-${index}`).join(',')
    mockQE.query.mockResolvedValueOnce({ items: [] })

    const req = new Request(
      `http://x/api/entities/relations/options?entityId=virtual:example&labelField=title&ids=${manyIds}`,
    )

    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockQE.query).toHaveBeenCalledWith(
      'virtual:example',
      expect.objectContaining({
        page: { page: 1, pageSize: 200 },
      }),
    )
  })

  // #4949: a relation custom field whose `relatedEntityId` was never filled in sent
  // `entityId=p:0`; the query engine guessed a table name for it and Postgres raised
  // `relation "0s" does not exist`, surfacing as a 500 on every render of the section.
  it.each([
    ['a half-configured placeholder id', 'p:0'],
    ['a well-formed id no entity backs', 'nosuch:thing'],
    ['an id without a module segment', 'person'],
  ])('answers with an empty option list for %s', async (_label, entityId) => {
    const req = new Request(
      `http://x/api/entities/relations/options?entityId=${encodeURIComponent(entityId)}`,
    )

    const res = await GET(req)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ items: [] })
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('still queries a registered ORM entity that has no custom entity row', async () => {
    mockQE.query.mockResolvedValueOnce({ items: [] })

    const req = new Request(
      'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=title',
    )

    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockEm.findOne).toHaveBeenCalled()
    expect(mockQE.query).toHaveBeenCalledWith('customers:customer_entity', expect.any(Object))
  })

  it('defaults to pageSize 50 when no ids are provided', async () => {
    mockQE.query.mockResolvedValueOnce({ items: [] })

    const req = new Request(
      'http://x/api/entities/relations/options?entityId=virtual:example&labelField=title',
    )

    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockQE.query).toHaveBeenCalledWith(
      'virtual:example',
      expect.objectContaining({
        page: { page: 1, pageSize: 50 },
      }),
    )
  })
})
