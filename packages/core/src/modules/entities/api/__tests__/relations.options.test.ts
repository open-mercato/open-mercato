/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/entities/api/relations/options'
import type { OrganizationScope } from '@open-mercato/shared/lib/auth/principal-service'

const mockResolveOrganizationScopeForRequest = jest.fn<Promise<OrganizationScope>, [unknown]>()
const mockGetSelectedOrganizationFromRequest = jest.fn((_request: Request): string | null => null)

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (args: unknown) => mockResolveOrganizationScopeForRequest(args),
  getSelectedOrganizationFromRequest: (request: Request) => mockGetSelectedOrganizationFromRequest(request),
}))

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
  CatalogProductVariant: 'catalog_product_variants',
  CustomerEntity: 'customer_entities', CustomerPersonProfile: 'customer_person_profiles', SalesOrder: 'sales_orders', User: 'users',
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
  getModules: () => [{ customEntities: [{ id: 'customers:customer_entity', labelField: 'title' }, { id: 'customers:customer_person_profile', labelField: 'displayName' }, { id: 'catalog:catalog_product_variant', labelField: 'sku' }, { id: 'third_party:entry', labelField: 'externalReference' }] }],
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

describe('GET /api/entities/relations/options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: true })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ tenantId: 't1', selectedId: 'org', filterIds: ['org'], allowedIds: ['org'] })
    mockGetSelectedOrganizationFromRequest.mockReturnValue(null)
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

  it('allows a non-superadmin with catalog view authority to look up declared variants', async () => {
    mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: false })

    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=catalog:catalog_product_variant'))

    expect(response.status).toBe(200)
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('actor', ['catalog.products.view'], { tenantId: 't1', organizationId: 'org' })
    expect(mockQE.query).toHaveBeenCalledWith('catalog:catalog_product_variant', expect.objectContaining({
      tenantId: 't1',
      organizationId: 'org',
      fields: ['id', 'sku'],
    }))
  })

  it('uses the selected organization for target permissions and relation records', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't1', selectedId: 'selected-org', filterIds: ['selected-org'], allowedIds: ['org', 'selected-org'],
    })
    const request = new Request('http://x/api/entities/relations/options?entityId=sales:sales_order&labelField=title', {
      headers: { cookie: 'om_selected_org=selected-org' },
    })

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(expect.objectContaining({ request }))
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('actor', ['sales.orders.view'], { tenantId: 't1', organizationId: 'selected-org' })
    expect(mockQE.query).toHaveBeenCalledWith('sales:sales_order', expect.objectContaining({ tenantId: 't1', organizationId: 'selected-org' }))
    expect(mockEm.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $or: [
        { tenantId: 't1', organizationId: 'selected-org' },
        { tenantId: 't1', organizationId: null },
        { tenantId: null, organizationId: null },
      ],
    }), expect.anything())
  })

  it('does not reuse home-organization target permissions for the selected organization', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't1', selectedId: 'selected-org', filterIds: ['selected-org'], allowedIds: ['org', 'selected-org'],
    })
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=sales:sales_order&labelField=title'))

    expect(response.status).toBe(403)
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('actor', ['sales.orders.view'], { tenantId: 't1', organizationId: 'selected-org' })
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('rejects a concrete selection lost while binding the feature-filtered organization scope', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't1', selectedId: null, filterIds: ['org', 'selected-org'], allowedIds: ['org', 'selected-org'],
    })
    mockGetSelectedOrganizationFromRequest.mockReturnValueOnce('unavailable-org')

    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=virtual:example&labelField=title'))

    expect(response.status).toBe(403)
    expect(mockEm.findOne).not.toHaveBeenCalled()
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it.each<OrganizationScope>([
    { tenantId: 't1', selectedId: 'org', filterIds: ['org'], allowedIds: ['org'], selectionRejected: true },
    { tenantId: 't1', selectedId: null, filterIds: [], allowedIds: ['org'] },
    { tenantId: 't1', selectedId: null, filterIds: null, allowedIds: [] },
    { tenantId: null, selectedId: null, filterIds: null, allowedIds: null },
  ])('denies rejected or empty organization scope before querying data: %j', async (scope) => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce(scope)

    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=virtual:example&labelField=title'))

    expect(response.status).toBe(403)
    expect(mockEm.findOne).not.toHaveBeenCalled()
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('retains finite allowed organization filters for an all-organization selection', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't1', selectedId: null, filterIds: ['org', 'selected-org'], allowedIds: ['org', 'selected-org'],
    })

    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=virtual:example&labelField=title'))

    expect(response.status).toBe(200)
    expect(mockQE.query).toHaveBeenCalledWith('virtual:example', expect.objectContaining({ tenantId: 't1', organizationIds: ['org', 'selected-org'] }))
    expect(mockQE.query).toHaveBeenCalledWith('virtual:example', expect.not.objectContaining({ organizationId: expect.anything() }))
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
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=virtual:restricted&labelField=title'))
    expect(response.status).toBe(403)
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledTimes(2)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('denies metadata-only access to unrestricted custom records before reading labels', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=virtual:example&labelField=title&tenantId=foreign'))
    expect(response.status).toBe(403)
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('actor', ['entities.records.view'], { tenantId: 't1', organizationId: 'org' })
    expect(mockQE.query).not.toHaveBeenCalled()
    expect(mockEm.findOne).not.toHaveBeenCalled()
  })

  it('allows a custom-record reader through the scoped relation query', async () => {
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=virtual:example&labelField=title&ids=rec-1'))
    expect(response.status).toBe(200)
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('actor', ['entities.records.view'], { tenantId: 't1', organizationId: 'org' })
    expect(mockQE.query).toHaveBeenCalledWith('virtual:example', expect.objectContaining({ tenantId: 't1', organizationId: 'org', forceCustomEntityStorage: true }))
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

  it('keeps declared customer profile labels readable by an authorized non-superadmin', async () => {
    mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockQE.query.mockResolvedValueOnce({ items: [{ id: 'person-1', displayName: 'Ada Lovelace' }] })
    const response = await GET(new Request('http://x/api/entities/relations/options?entityId=customers:customer_person_profile&labelField=displayName'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [{ value: 'person-1', label: 'Ada Lovelace' }] })
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('actor', ['customers.people.view'], { tenantId: 't1', organizationId: 'org' })
    expect(mockQE.query).toHaveBeenCalledWith('customers:customer_person_profile', expect.objectContaining({ fields: ['id', 'displayName'] }))
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
