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
}

// Columns the fake information_schema reports for a table, as `table.column`.
let mockSchemaColumns: Set<string>

const mockKysely = {
  selectFrom: () => ({
    select: () => ({
      where: (_column: string, _operator: string, table: string) => ({
        where: (_column2: string, _operator2: string, column: string) => ({
          executeTakeFirst: async () =>
            mockSchemaColumns.has(`${table}.${column}`) ? { column_name: column } : undefined,
        }),
      }),
    }),
  }),
}

const mockEm = {
  // Custom (doc-storage) entities: registered rows make an id queryable.
  findOne: jest.fn(),
  // CustomFieldDef rows backing the declared-label-field check.
  find: jest.fn(),
  getMetadata: () => ({
    find: (className: string) => (
      registeredTables[className] ? { tableName: registeredTables[className] } : undefined
    ),
    getAll: () => Object.values(registeredTables).map((tableName) => ({ tableName })),
  }),
  getKysely: () => mockKysely,
}

const mockRbac = {
  loadAcl: jest.fn(),
}

const mockSearchIndexer = {
  getEntityConfig: jest.fn(),
  getAllEntityConfigs: jest.fn(() => []),
}

// DI keys the fake request container can resolve. Keys absent from this map
// make `hasRegistration` fail closed, mirroring the real container.
let mockRegistrations: Record<string, unknown>

const mockAuth: {
  sub: string
  orgId: string | null
  tenantId: string | null
  isSuperAdmin?: boolean
  roles: string[]
} = { sub: 'user-1', orgId: 'org', tenantId: 't1', roles: ['admin'] }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'queryEngine') return mockQE
      if (key === 'rbacService') return mockRbac
      if (key === 'searchIndexer') return mockSearchIndexer
      return mockEm
    },
    hasRegistration: (key: string) => key in mockRegistrations,
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => mockAuth,
}))

// The customer-entity search registration the default mocks expose: the target
// the existing permission-surface tests query is gated by `customers.people.view`.
const CUSTOMER_ENTITY_CONFIG = {
  entityId: 'customers:customer_entity',
  aclFeatures: ['customers.people.view'],
}

function primeDefaults() {
  mockQE.query.mockImplementation(async () => ({
    items: [
      { id: 'rec-1', title: 'Alpha' },
      { id: 'rec-2', title: 'Beta' },
    ],
  }))
  mockEm.findOne.mockImplementation(async (_entity: unknown, where: { entityId?: string }) => (
    typeof where?.entityId === 'string' && where.entityId.startsWith('virtual:')
      ? { labelField: null }
      : null
  ))
  mockEm.find.mockResolvedValue([])
  mockRbac.loadAcl.mockResolvedValue({
    isSuperAdmin: false,
    features: ['customers.people.view'],
    organizations: null,
  })
  mockSearchIndexer.getEntityConfig.mockImplementation((entityId: string) => (
    entityId === 'customers:customer_entity' ? CUSTOMER_ENTITY_CONFIG : undefined
  ))
  mockSearchIndexer.getAllEntityConfigs.mockReturnValue([CUSTOMER_ENTITY_CONFIG])
  mockRegistrations = {
    queryEngine: mockQE,
    em: mockEm,
    rbacService: mockRbac,
    searchIndexer: mockSearchIndexer,
  }
  Object.assign(mockAuth, { sub: 'user-1', orgId: 'org', tenantId: 't1', isSuperAdmin: undefined })
  // `customer_entities` really carries `display_name`; `title` is modelled so the
  // pre-existing projection tests keep exercising the pass-through path.
  mockSchemaColumns = new Set(['customer_entities.display_name', 'customer_entities.title'])
}

describe('GET /api/entities/relations/options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    primeDefaults()
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

  // --- GHSA-9mqj-q2h7-8279: fail-closed per-entity read ACL gate -------------------

  describe('target-entity read ACL (registered ORM entities)', () => {
    it('answers with an empty list and never queries when the target is not registered for search', async () => {
      mockSearchIndexer.getEntityConfig.mockReturnValue(undefined)
      mockSearchIndexer.getAllEntityConfigs.mockReturnValue([])

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [] })
      expect(mockRbac.loadAcl).toHaveBeenCalledWith('user-1', { tenantId: 't1', organizationId: 'org' })
      expect(mockQE.query).not.toHaveBeenCalled()
    })

    it('fails closed when the search registration declares no aclFeatures', async () => {
      mockSearchIndexer.getEntityConfig.mockReturnValue({ entityId: 'customers:customer_entity' })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [] })
      expect(mockQE.query).not.toHaveBeenCalled()
    })

    it('fails closed when the caller lacks the target entity aclFeatures', async () => {
      mockRbac.loadAcl.mockResolvedValue({
        isSuperAdmin: false,
        features: ['catalog.products.view'],
        organizations: null,
      })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [] })
      expect(mockQE.query).not.toHaveBeenCalled()
    })

    it('keeps serving a caller that holds the declared aclFeatures', async () => {
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1', display_name: 'Ada Lovelace' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        items: [{ value: 'rec-1', label: 'Ada Lovelace' }],
      })
      expect(mockQE.query).toHaveBeenCalledWith(
        'customers:customer_entity',
        expect.objectContaining({ fields: ['id', 'display_name'] }),
      )
    })

    it('honours wildcard feature grants against the declared aclFeatures', async () => {
      mockRbac.loadAcl.mockResolvedValue({
        isSuperAdmin: false,
        features: ['customers.*'],
        organizations: null,
      })
      mockQE.query.mockResolvedValueOnce({ items: [] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      expect(mockQE.query).toHaveBeenCalledWith('customers:customer_entity', expect.any(Object))
    })

    it('lets a superadmin read any registered target without the feature grant', async () => {
      Object.assign(mockAuth, { isSuperAdmin: true })
      mockRbac.loadAcl.mockResolvedValue({
        isSuperAdmin: true,
        features: [],
        organizations: null,
      })
      mockSearchIndexer.getEntityConfig.mockReturnValue(undefined)
      mockSearchIndexer.getAllEntityConfigs.mockReturnValue([])
      mockQE.query.mockResolvedValueOnce({ items: [] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      expect(mockQE.query).toHaveBeenCalledWith('customers:customer_entity', expect.any(Object))
    })

    it('fails closed with 503 when the rbacService is not registered', async () => {
      delete mockRegistrations.rbacService

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name',
      )

      const res = await GET(req)

      expect(res.status).toBe(503)
      expect(mockQE.query).not.toHaveBeenCalled()
    })

    it('fails closed with 503 when the searchIndexer is not registered', async () => {
      delete mockRegistrations.searchIndexer

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=display_name',
      )

      const res = await GET(req)

      expect(res.status).toBe(503)
      expect(mockQE.query).not.toHaveBeenCalled()
    })
  })

  describe('target-entity read ACL (doc-storage custom entities)', () => {
    it('keeps working without any search registration for the target', async () => {
      mockSearchIndexer.getEntityConfig.mockReturnValue(undefined)
      mockSearchIndexer.getAllEntityConfigs.mockReturnValue([])
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1', title: 'Alpha' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=title&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'Alpha' }] })
      expect(mockRbac.loadAcl).not.toHaveBeenCalled()
    })

    it('keeps working when the ACL services are absent from the container entirely', async () => {
      delete mockRegistrations.rbacService
      delete mockRegistrations.searchIndexer
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1', title: 'Alpha' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=title&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'Alpha' }] })
    })
  })

  // --- GHSA-9mqj-q2h7-8279: safe labelField resolution -----------------------------

  describe('labelField hardening (registered ORM entities)', () => {
    it('drops a labelField outside the allowlist instead of projecting the column', async () => {
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=password_hash&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'rec-1' }] })
      const queryArg = mockQE.query.mock.calls[0][1] as {
        fields: string[]
        filters: Record<string, unknown>
      }
      expect(queryArg.fields).toEqual(['id'])
      expect(queryArg.filters).toEqual({ id: 'rec-1' })
      expect(JSON.stringify(queryArg)).not.toContain('password_hash')
    })

    it('falls back to the sniffed safe column when a caller labelField is rejected', async () => {
      mockSchemaColumns = new Set(['customer_entitys.name'])

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=password_hash',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      const queryArg = mockQE.query.mock.calls[0][1] as { fields: string[] }
      expect(queryArg.fields).toEqual(['id', 'name'])
    })

    it('degrades an allowlisted labelField that the target table does not carry', async () => {
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=full_name&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'rec-1' }] })
      const queryArg = mockQE.query.mock.calls[0][1] as { fields: string[] }
      expect(queryArg.fields).toEqual(['id'])
    })

    it('never consults custom-field definitions for a non-custom target', async () => {
      const req = new Request(
        'http://x/api/entities/relations/options?entityId=customers:customer_entity&labelField=title',
      )

      await GET(req)

      expect(mockEm.find).not.toHaveBeenCalled()
    })
  })

  describe('labelField hardening (doc-storage custom entities)', () => {
    it('accepts an allowlisted labelField without consulting field definitions', async () => {
      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=title&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      expect(mockEm.find).not.toHaveBeenCalled()
      expect(mockQE.query).toHaveBeenCalledWith(
        'virtual:case_study',
        expect.objectContaining({ fields: ['id', 'title'] }),
      )
    })

    it('accepts a declared non-encrypted field of the entity as the label source', async () => {
      mockEm.find.mockResolvedValueOnce([{ key: 'summary', configJson: {} }])
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1', summary: 'Q3 intake' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=summary&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'Q3 intake' }] })
      expect(mockQE.query).toHaveBeenCalledWith(
        'virtual:case_study',
        expect.objectContaining({ fields: ['id', 'summary'] }),
      )
    })

    it('rejects a declared encrypted field as the label source', async () => {
      mockEm.find.mockResolvedValueOnce([{ key: 'secret', configJson: { encrypted: true } }])
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=secret&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'rec-1' }] })
      const queryArg = mockQE.query.mock.calls[0][1] as { fields: string[] }
      expect(queryArg.fields).toEqual(['id'])
    })

    it('rejects a field the entity never declared', async () => {
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=password_hash&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'rec-1' }] })
      const queryArg = mockQE.query.mock.calls[0][1] as { fields: string[] }
      expect(queryArg.fields).toEqual(['id'])
    })

    it('uses the entity-configured labelField when it is a declared field', async () => {
      mockEm.findOne.mockResolvedValueOnce({ labelField: 'summary' })
      mockEm.find.mockResolvedValueOnce([{ key: 'summary', configJson: {} }])
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1', summary: 'Q3 intake' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'Q3 intake' }] })
      expect(mockQE.query).toHaveBeenCalledWith(
        'virtual:case_study',
        expect.objectContaining({ fields: ['id', 'summary'] }),
      )
    })

    it('drops an unsafe entity-configured labelField and falls back to id', async () => {
      mockEm.findOne.mockResolvedValueOnce({ labelField: 'password_hash' })
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'rec-1' }] })
      const queryArg = mockQE.query.mock.calls[0][1] as { fields: string[] }
      expect(queryArg.fields).toEqual(['id'])
    })

    it('treats a failing field-definitions lookup as not declared', async () => {
      mockEm.find.mockRejectedValueOnce(new Error('boom'))
      mockQE.query.mockResolvedValueOnce({ items: [{ id: 'rec-1' }] })

      const req = new Request(
        'http://x/api/entities/relations/options?entityId=virtual:case_study&labelField=summary&ids=rec-1',
      )

      const res = await GET(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ items: [{ value: 'rec-1', label: 'rec-1' }] })
      const queryArg = mockQE.query.mock.calls[0][1] as { fields: string[] }
      expect(queryArg.fields).toEqual(['id'])
    })
  })
})
