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
  CustomerEntity: 'customer_entities', SalesOrder: 'sales_orders', User: 'users',
}

const mockRbac = { userHasAllFeatures: jest.fn(async () => true), loadAcl: jest.fn(async () => ({ isSuperAdmin: true })) }

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
  createRequestContainer: async () => ({ resolve: (key: string) => (key === 'queryEngine' ? mockQE : key === 'rbacService' ? mockRbac : mockEm) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ sub: 'actor', orgId: 'org', tenantId: 't1', roles: ['admin'] }),
}))

jest.mock('@open-mercato/core/modules/entities/lib/entityClassification', () => ({
  classifyRecordsEntity: async (_em: unknown, entityId: string) => ({
    kind: entityId.startsWith('virtual:') ? 'custom' : ['p:0', 'nosuch:thing', 'person'].includes(entityId) ? 'unknown' : 'system', restricted: entityId === 'virtual:restricted',
  }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  getModules: () => [{ customEntities: [{ id: 'customers:customer_entity', labelField: 'title' }, { id: 'third_party:entry', labelField: 'externalReference' }] }],
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

describe('GET /api/entities/relations/options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: true })
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

  it('caps pageSize at 100 even when more ids are requested', async () => {
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
        page: { page: 1, pageSize: 100 },
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

  it.each(['security:user_mfa_method', 'directory:tenant', 'auth:session'])('rejects sensitive target %s before querying data', async (entityId) => {
    const response = await GET(new Request(`http://x/api/entities/relations/options?entityId=${entityId}&labelField=secret`))
    expect(response.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('requires the target view feature even with the metadata feature', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=sales:sales_order&labelField=title'))
    expect(response.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it.each(['password_hash', 'secret', 'cf:private', 'title,title'])('rejects unsafe label %s before querying data', async (labelField) => {
    const response = await GET(new Request(`http://x/api/entities/relations/options?entityId=virtual:example&labelField=${encodeURIComponent(labelField)}`))
    expect(response.status).toBe(400)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('enforces restricted custom entity ACL', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=virtual:restricted&labelField=title'))
    expect(response.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('does not turn a third-party declaration into an implicit system-data grant', async () => {
    registeredTables.Entry = 'entries'
    mockRbac.loadAcl.mockResolvedValueOnce({ isSuperAdmin: false })
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=third_party:entry&labelField=externalReference'))
    expect(response.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
    delete registeredTables.Entry
  })

  it('checks mapped target permissions using the authenticated scope', async () => {
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=sales:sales_order&labelField=title&tenantId=foreign'))
    expect(response.status).toBe(200)
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('actor', ['sales.orders.view'], { tenantId: 't1', organizationId: 'org' })
    expect(mockQE.query).toHaveBeenCalledWith('sales:sales_order', expect.objectContaining({ tenantId: 't1', organizationId: 'org' }))
  })

  it('preserves third-party declared labels', async () => {
    registeredTables.Entry = 'entries'
    mockQE.query.mockResolvedValueOnce({ items: [] })
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=third_party:entry&labelField=externalReference'))
    expect(response.status).toBe(200)
    expect(mockQE.query).toHaveBeenCalledWith('third_party:entry', expect.objectContaining({ fields: ['id', 'externalReference'] }))
    delete registeredTables.Entry
  })

})
