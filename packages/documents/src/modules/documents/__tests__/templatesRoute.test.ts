import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { DocumentTemplate } from '../data/entities'
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  seedDefaultDocumentTemplates,
} from '../lib/templateSeeds'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const TEMPLATE_ID = '44444444-4444-4444-8444-444444444444'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunMutationGuardAfterSuccess = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('../lib/platformServices', () => ({
  ...jest.requireActual('../lib/platformServices'),
  resolveOrganizationScopeService: () => ({
    resolve: jest.fn(), resolveFresh: jest.fn(),
    resolveForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockRunRouteMutationGuards(...args),
}))

type MockEntityManager = {
  find: jest.Mock
  findAndCount: jest.Mock
  count: jest.Mock
  findOne: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  clear: jest.Mock
}

type MockRbacService = {
  loadAcl: jest.Mock
}

type TemplatesRoute = typeof import('../api/templates/route')
type TemplateDetailRoute = typeof import('../api/templates/[templateId]/route')

type PersistedTemplate = {
  id: string
  tenantId: string
  organizationId: string
  seedKey: string | null
  name: string
  description: string | null
  bodyHtml: string
  contextSlots: { slot: string; entityType: string; required?: boolean }[] | null
  createdByUserId: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
}

let mockEm: MockEntityManager
let GET: TemplatesRoute['GET']
let GET_DETAIL: TemplateDetailRoute['GET']
let POST: TemplatesRoute['POST']
let PUT: TemplatesRoute['PUT']
let DELETE: TemplatesRoute['DELETE']

const mockRbacService: MockRbacService = {
  loadAcl: jest.fn(),
}
const mockCommandExecute = jest.fn()
const mockCommandBus = { execute: (...args: unknown[]) => mockCommandExecute(...args) }

const mockContainer = {
  resolve: jest.fn((token: string): unknown => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    if (token === 'commandBus') return mockCommandBus
    return undefined
  }),
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function makeRouteEm(): MockEntityManager {
  const persisted: unknown[] = []
  const em: MockEntityManager = {
    find: jest.fn(async () => []),
    findAndCount: jest.fn(async () => [[], 0]),
    count: jest.fn(async () => 0),
    findOne: jest.fn(async () => null),
    create: jest.fn((_entity: unknown, data: unknown) => ({
      ...readRecord(data),
      createdAt: new Date('2026-07-09T09:00:00.000Z'),
      updatedAt: new Date('2026-07-09T09:00:00.000Z'),
    })),
    persist: jest.fn((value: unknown) => {
      persisted.push(value)
      return em
    }),
    flush: jest.fn(async () => undefined),
    clear: jest.fn(),
  }
  return em
}

function makeRequest(method: string, body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/documents/templates', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function mockAcl(features: string[]): void {
  mockRbacService.loadAcl.mockResolvedValue({
    isSuperAdmin: false,
    features,
    organizations: null,
  })
}

beforeAll(async () => {
  const [route, detailRoute] = await Promise.all([
    import('../api/templates/route'),
    import('../api/templates/[templateId]/route'),
  ])
  GET = route.GET
  GET_DETAIL = detailRoute.GET
  POST = route.POST
  PUT = route.PUT
  DELETE = route.DELETE
})

beforeEach(() => {
  jest.clearAllMocks()
  mockEm = makeRouteEm()
  mockCreateRequestContainer.mockResolvedValue(mockContainer)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    roles: [],
    features: [],
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  })
  mockRunMutationGuardAfterSuccess.mockResolvedValue(undefined)
  mockRunRouteMutationGuards.mockResolvedValue({
    ok: true,
    runAfterSuccess: mockRunMutationGuardAfterSuccess,
  })
  mockCommandExecute.mockResolvedValue({
    result: { id: TEMPLATE_ID, updatedAt: '2026-07-09T09:00:00.000Z' },
    logEntry: null,
  })
  mockAcl(['documents.view'])
})

describe('documents templates route', () => {
  it('returns collection management capability even when the list is empty', async () => {
    mockAcl(['documents.view', 'documents.templates.manage'])

    const response = await GET(makeRequest('GET'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      capabilities: { canManageTemplates: true },
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
  })

  it('applies bounded database pagination when pagination is omitted', async () => {
    mockAcl(['documents.view', 'documents.templates.manage'])
    const templates = Array.from({ length: 50 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      name: `Template ${index}`,
      description: null,
      bodyHtml: '<p>Template</p>',
      contextSlots: null,
      isActive: true,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    }))
    mockEm.find.mockResolvedValue(templates)
    mockEm.count.mockResolvedValue(101)

    const response = await GET(makeRequest('GET'))
    const body = await response.json() as { items: unknown[]; pageSize: number; total: number }

    expect(response.status).toBe(200)
    expect(mockEm.find).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
      { orderBy: { name: 'ASC', id: 'ASC' }, limit: 50, offset: 0 },
    )
    expect(body.items).toHaveLength(50)
    expect(body.items[0]).toMatchObject({ bodyHtml: '<p>Template</p>' })
    expect(body).toMatchObject({ total: 101, page: 1, pageSize: 50, totalPages: 3 })
  })

  it('returns a bounded summary projection without loading or serializing template bodies', async () => {
    mockEm.find.mockResolvedValue([{
      id: TEMPLATE_ID,
      name: 'Large template',
      description: 'Safe summary',
      bodyHtml: 'x'.repeat(500_000),
      contextSlots: null,
      isActive: true,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    }])
    mockEm.count.mockResolvedValue(1)

    const response = await GET(new Request(
      'http://localhost/api/documents/templates?page=1&pageSize=100&includeBody=false',
    ))
    const responseText = await response.text()
    const body = JSON.parse(responseText) as { items: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(mockEm.find).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
      {
        orderBy: { name: 'ASC', id: 'ASC' },
        limit: 100,
        offset: 0,
        fields: ['id', 'name', 'description', 'contextSlots', 'isActive', 'updatedAt', 'createdAt'],
      },
    )
    expect(body.items).toEqual([expect.objectContaining({ name: 'Large template' })])
    expect(body.items[0]).not.toHaveProperty('bodyHtml')
    expect(responseText.length).toBeLessThan(5_000)
  })

  it('keeps server-side template search compatible across names and descriptions', async () => {
    mockEm.find.mockResolvedValue([])
    mockEm.count.mockResolvedValue(0)

    const response = await GET(new Request(
      'http://localhost/api/documents/templates?page=1&pageSize=50&includeBody=false&search=customer',
    ))

    expect(response.status).toBe(200)
    const expectedSearch = {
      $or: [
        { name: { $ilike: '%customer%' } },
        { description: { $ilike: '%customer%' } },
      ],
    }
    expect(mockEm.find).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining(expectedSearch),
      expect.objectContaining({ limit: 50, offset: 0 }),
    )
    expect(mockEm.count).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining(expectedSearch),
    )
  })

  it('rejects page sizes above the strict collection cap', async () => {
    const response = await GET(new Request(
      'http://localhost/api/documents/templates?page=1&pageSize=101&includeBody=false',
    ))

    expect(response.status).toBe(400)
    expect(mockEm.find.mock.calls.some(([entity]) => entity === DocumentTemplate)).toBe(false)
  })

  it('returns the scoped full body from the selected-template detail endpoint', async () => {
    mockAcl(['documents.view', 'documents.templates.manage'])
    mockEm.findOne.mockResolvedValue({
      id: TEMPLATE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Selected template',
      description: null,
      bodyHtml: '<p>Selected body</p>',
      contextSlots: null,
      isActive: false,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    })

    const response = await GET_DETAIL(
      new Request(`http://localhost/api/documents/templates/${TEMPLATE_ID}`),
      { params: { templateId: TEMPLATE_ID } },
    )

    expect(response.status).toBe(200)
    expect(mockEm.findOne).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining({
        id: TEMPLATE_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        deletedAt: null,
      }),
      undefined,
    )
    await expect(response.json()).resolves.toMatchObject({
      id: TEMPLATE_ID,
      bodyHtml: '<p>Selected body</p>',
      isActive: false,
    })
  })

  it('denies the selected-template detail endpoint to a view-only caller', async () => {
    mockAcl(['documents.view'])
    mockEm.findOne.mockResolvedValue({
      id: TEMPLATE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Selected template',
      bodyHtml: '<p>Selected body</p>',
      contextSlots: null,
      isActive: true,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    })

    const response = await GET_DETAIL(
      new Request(`http://localhost/api/documents/templates/${TEMPLATE_ID}`),
      { params: { templateId: TEMPLATE_ID } },
    )

    expect(response.status).toBe(403)
  })

  it('bounds template reads with database pagination', async () => {
    mockAcl(['documents.view'])

    const response = await GET(new Request('http://localhost/api/documents/templates?page=2&pageSize=25'))

    expect(response.status).toBe(200)
    // A view-only caller never receives bodies, so the list loads the bounded
    // summary projection.
    expect(mockEm.find).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null }),
      expect.objectContaining({ orderBy: { name: 'ASC', id: 'ASC' }, limit: 25, offset: 25 }),
    )
    expect(mockEm.count).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null }),
    )
    await expect(response.json()).resolves.toMatchObject({ page: 2, pageSize: 25, totalPages: 1 })
  })

  it('keeps duplicate names stable across searched page boundaries', async () => {
    const firstId = '11111111-1111-4111-8111-111111111111'
    const secondId = '22222222-2222-4222-8222-222222222222'
    const duplicates = [secondId, firstId].map((id) => ({
      id,
      name: 'Quarterly plan',
      description: null,
      bodyHtml: '<p>Template</p>',
      contextSlots: null,
      isActive: true,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    }))
    mockEm.find.mockImplementation(async (
      entity: unknown,
      _where: unknown,
      options: { limit?: number; offset?: number },
    ) => {
      if (entity !== DocumentTemplate) return []
      const offset = options.offset ?? 0
      const limit = options.limit ?? duplicates.length
      return [...duplicates]
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
        .slice(offset, offset + limit)
    })
    mockEm.count.mockResolvedValue(2)

    const firstResponse = await GET(new Request(
      'http://localhost/api/documents/templates?search=Quarterly&page=1&pageSize=1',
    ))
    const secondResponse = await GET(new Request(
      'http://localhost/api/documents/templates?search=Quarterly&page=2&pageSize=1',
    ))

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    const templateFindCalls = mockEm.find.mock.calls.filter(([entity]) => entity === DocumentTemplate)
    const searchedFields = {
      $or: [
        { name: { $ilike: '%Quarterly%' } },
        { description: { $ilike: '%Quarterly%' } },
      ],
    }
    expect(templateFindCalls).toEqual([
      [
        DocumentTemplate,
        expect.objectContaining(searchedFields),
        expect.objectContaining({ orderBy: { name: 'ASC', id: 'ASC' }, limit: 1, offset: 0 }),
      ],
      [
        DocumentTemplate,
        expect.objectContaining(searchedFields),
        expect.objectContaining({ orderBy: { name: 'ASC', id: 'ASC' }, limit: 1, offset: 1 }),
      ],
    ])
    await expect(firstResponse.json()).resolves.toMatchObject({
      items: [{ id: firstId, name: 'Quarterly plan' }],
      page: 1,
      pageSize: 1,
      totalPages: 2,
    })
    await expect(secondResponse.json()).resolves.toMatchObject({
      items: [{ id: secondId, name: 'Quarterly plan' }],
      page: 2,
      pageSize: 1,
      totalPages: 2,
    })
  })

  it('supports a bounded active-template probe without hiding later active templates', async () => {
    const activeTemplate = {
      id: TEMPLATE_ID,
      name: 'Active template',
      description: null,
      bodyHtml: '<p>Template</p>',
      contextSlots: null,
      isActive: true,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    }
    mockEm.find.mockResolvedValue([activeTemplate])
    mockEm.count.mockResolvedValue(1)

    const response = await GET(new Request(
      'http://localhost/api/documents/templates?page=1&pageSize=1&isActive=true',
    ))

    expect(response.status).toBe(200)
    expect(mockEm.find).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        deletedAt: null,
        isActive: true,
      }),
      expect.objectContaining({ orderBy: { name: 'ASC', id: 'ASC' }, limit: 1, offset: 0 }),
    )
    await expect(response.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: TEMPLATE_ID, isActive: true })],
      total: 1,
      page: 1,
      pageSize: 1,
      totalPages: 1,
    })
  })

  it('rejects incomplete pagination parameters instead of silently changing the contract', async () => {
    const response = await GET(new Request('http://localhost/api/documents/templates?pageSize=25'))

    expect(response.status).toBe(400)
    expect(mockEm.find).not.toHaveBeenCalledWith(
      DocumentTemplate,
      expect.anything(),
      expect.anything(),
    )
  })

  it('blocks GET without documents.view', async () => {
    mockAcl([])

    const response = await GET(makeRequest('GET'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it.each(['POST', 'PUT', 'DELETE'])('blocks %s without documents.templates.manage', async (method) => {
    const handler = method === 'POST' ? POST : method === 'PUT' ? PUT : DELETE
    const body = method === 'POST'
      ? { name: 'Template', bodyHtml: '<p>Hello</p>' }
      : method === 'PUT'
        ? { id: TEMPLATE_ID, name: 'Updated template' }
        : { id: TEMPLATE_ID }
    const response = await handler(makeRequest(method, body))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('dispatches a scoped stable-id template command on POST', async () => {
    mockAcl(['documents.templates.manage'])
    const payload = {
      name: 'Custom template',
      description: 'Draft template',
      bodyHtml: '<h1>Hello {{customer.name}}</h1>',
      contextSlots: [
        { slot: 'customer', entityType: 'customer-person', required: true },
      ],
      isActive: false,
    }

    const response = await POST(makeRequest('POST', payload))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual({
      id: expect.any(String),
      updatedAt: '2026-07-09T09:00:00.000Z',
    })
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'documents.template.create',
      expect.objectContaining({ input: expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        templateId: expect.any(String),
        actorUserId: USER_ID,
        template: payload,
      }) }),
    )
  })

  it('applies registry guard payload transformations and runs after-success callbacks', async () => {
    mockAcl(['documents.templates.manage'])
    const payload = {
      name: 'Requested name',
      bodyHtml: '<p>Body</p>',
      isActive: true,
    }
    mockRunRouteMutationGuards.mockResolvedValueOnce({
      ok: true,
      modifiedPayload: { ...payload, name: 'Guarded name' },
      runAfterSuccess: mockRunMutationGuardAfterSuccess,
    })

    const response = await POST(makeRequest('POST', payload))

    expect(response.status).toBe(201)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        userId: USER_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        userFeatures: ['documents.templates.manage'],
      }),
      input: expect.objectContaining({
        resourceKind: 'documents:document_template',
        operation: 'create',
      }),
    }))
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'documents.template.create',
      expect.objectContaining({ input: expect.objectContaining({
        template: expect.objectContaining({ name: 'Guarded name' }),
      }) }),
    )
    expect(mockRunMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch when a registry mutation guard blocks creation', async () => {
    mockAcl(['documents.templates.manage'])
    mockRunRouteMutationGuards.mockResolvedValueOnce({
      ok: false,
      errorStatus: 422,
      errorBody: { error: 'documents.errors.guardBlocked' },
      response: Response.json({ error: 'documents.errors.guardBlocked' }, { status: 422 }),
    })

    const response = await POST(makeRequest('POST', {
      name: 'Blocked',
      bodyHtml: '<p>Body</p>',
    }))

    expect(response.status).toBe(422)
    expect(mockCommandExecute).not.toHaveBeenCalled()
    expect(mockRunMutationGuardAfterSuccess).not.toHaveBeenCalled()
  })

  it('rejects duplicate template slot names before persistence', async () => {
    mockAcl(['documents.templates.manage'])

    const response = await POST(makeRequest('POST', {
      name: 'Ambiguous template',
      bodyHtml: '<p>{{customer.name}}</p>',
      contextSlots: [
        { slot: 'customer', entityType: 'customer-person', required: true },
        { slot: 'customer', entityType: 'customer-company', required: false },
      ],
    }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it.each([
    ['PUT', 'documents.template.update'],
    ['DELETE', 'documents.template.delete'],
  ] as const)('dispatches %s through %s with the current template version', async (method, commandId) => {
    mockAcl(['documents.templates.manage'])
    mockEm.findOne.mockResolvedValue({
      id: TEMPLATE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Template',
      description: null,
      bodyHtml: '<p>Template</p>',
      contextSlots: null,
      seedKey: null,
      createdByUserId: USER_ID,
      isActive: true,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
      deletedAt: null,
    })
    const handler = method === 'PUT' ? PUT : DELETE
    const response = await handler(makeRequest(method, method === 'PUT'
      ? { id: TEMPLATE_ID, name: 'Updated' }
      : { id: TEMPLATE_ID }))

    expect(response.status).toBe(200)
    expect(mockCommandExecute).toHaveBeenCalledWith(
      commandId,
      expect.objectContaining({ input: expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        actorUserId: USER_ID,
        expectedUpdatedAt: '2026-07-10T10:00:00.000Z',
      }) }),
    )
  })
})

describe('document template defaults seeding', () => {
  it('creates each default template once across repeated runs', async () => {
    const persisted: PersistedTemplate[] = []
    const em: MockEntityManager = {
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      count: jest.fn(async () => 0),
      findOne: jest.fn(async (entity: unknown, where: unknown) => {
        if (entity !== DocumentTemplate) return null
        const query = readRecord(where)
        return persisted.find((template) => (
          template.tenantId === query.tenantId
          && template.organizationId === query.organizationId
          && (query.seedKey === undefined || template.seedKey === query.seedKey)
          && (query.name === undefined || template.name === query.name)
          && (query.deletedAt === undefined || template.deletedAt === query.deletedAt)
        )) ?? null
      }),
      create: jest.fn((_entity: unknown, data: unknown) => ({
        ...readRecord(data),
        createdAt: new Date('2026-07-09T10:00:00.000Z'),
        updatedAt: new Date('2026-07-09T10:00:00.000Z'),
        deletedAt: null,
      })),
      persist: jest.fn((value: unknown) => {
        persisted.push(value as PersistedTemplate)
        return em
      }),
      flush: jest.fn(async () => undefined),
      clear: jest.fn(),
    }

    await seedDefaultDocumentTemplates(em as unknown as EntityManager, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      createdByUserId: USER_ID,
    })
    await seedDefaultDocumentTemplates(em as unknown as EntityManager, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      createdByUserId: USER_ID,
    })

    expect(persisted).toHaveLength(DEFAULT_DOCUMENT_TEMPLATES.length)
    expect(new Set(persisted.map((template) => template.seedKey)).size).toBe(DEFAULT_DOCUMENT_TEMPLATES.length)
    expect(new Set(persisted.map((template) => template.name)).size).toBe(DEFAULT_DOCUMENT_TEMPLATES.length)
    expect(persisted).toEqual(expect.arrayContaining(
      DEFAULT_DOCUMENT_TEMPLATES.map((seed) => expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        seedKey: seed.seedKey,
        name: seed.name,
        description: seed.description,
        bodyHtml: seed.bodyHtml,
        contextSlots: seed.contextSlots,
        createdByUserId: USER_ID,
        isActive: true,
      })),
    ))
    expect(em.flush).toHaveBeenCalledTimes(DEFAULT_DOCUMENT_TEMPLATES.length)
  })

  it('adopts only exact legacy defaults, suffixes name collisions, and preserves deleted seed keys', async () => {
    const [legacySeed, collisionSeed, deletedSeed] = DEFAULT_DOCUMENT_TEMPLATES
    const makePersisted = (
      seed: (typeof DEFAULT_DOCUMENT_TEMPLATES)[number],
      overrides: Partial<PersistedTemplate> = {},
    ): PersistedTemplate => ({
      id: randomUUID(),
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      seedKey: null,
      name: seed.name,
      description: seed.description,
      bodyHtml: seed.bodyHtml,
      contextSlots: seed.contextSlots,
      createdByUserId: USER_ID,
      isActive: true,
      createdAt: new Date('2026-07-09T10:00:00.000Z'),
      updatedAt: new Date('2026-07-09T10:00:00.000Z'),
      deletedAt: null,
      ...overrides,
    })
    const legacy = makePersisted(legacySeed!)
    const customCollision = makePersisted(collisionSeed!, { bodyHtml: '<p>Custom content must survive</p>' })
    const deleted = makePersisted(deletedSeed!, {
      seedKey: deletedSeed!.seedKey,
      deletedAt: new Date('2026-07-09T11:00:00.000Z'),
    })
    const persisted: PersistedTemplate[] = [legacy, customCollision, deleted]
    const em: MockEntityManager = {
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      count: jest.fn(async () => 0),
      findOne: jest.fn(async (entity: unknown, where: unknown) => {
        if (entity !== DocumentTemplate) return null
        const query = readRecord(where)
        return persisted.find((template) => (
          template.tenantId === query.tenantId
          && template.organizationId === query.organizationId
          && (query.seedKey === undefined || template.seedKey === query.seedKey)
          && (query.name === undefined || template.name === query.name)
          && (query.deletedAt === undefined || template.deletedAt === query.deletedAt)
        )) ?? null
      }),
      create: jest.fn((_entity: unknown, data: unknown) => ({
        ...readRecord(data),
        createdAt: new Date('2026-07-09T10:00:00.000Z'),
        updatedAt: new Date('2026-07-09T10:00:00.000Z'),
        deletedAt: null,
      })),
      persist: jest.fn((value: unknown) => {
        persisted.push(value as PersistedTemplate)
        return em
      }),
      flush: jest.fn(async () => undefined),
      clear: jest.fn(),
    }

    await seedDefaultDocumentTemplates(em as unknown as EntityManager, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      createdByUserId: USER_ID,
    })

    expect(legacy.seedKey).toBe(legacySeed!.seedKey)
    expect(customCollision.bodyHtml).toBe('<p>Custom content must survive</p>')
    expect(persisted.find((template) => template.seedKey === collisionSeed!.seedKey)).toMatchObject({
      name: `${collisionSeed!.name} — Open Mercato default`,
      bodyHtml: collisionSeed!.bodyHtml,
    })
    expect(persisted.filter((template) => template.seedKey === deletedSeed!.seedKey)).toEqual([deleted])
    expect(deleted.deletedAt).not.toBeNull()
  })

  it('recovers a concurrent seed-key winner without clearing another entity manager', async () => {
    const persisted: PersistedTemplate[] = []
    let firstFlush = true
    const em: MockEntityManager = {
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      count: jest.fn(async () => 0),
      findOne: jest.fn(async (entity: unknown, where: unknown) => {
        if (entity !== DocumentTemplate) return null
        const query = readRecord(where)
        return persisted.find((template) => (
          template.tenantId === query.tenantId
          && template.organizationId === query.organizationId
          && (query.seedKey === undefined || template.seedKey === query.seedKey)
          && (query.name === undefined || template.name === query.name)
          && (query.deletedAt === undefined || template.deletedAt === query.deletedAt)
        )) ?? null
      }),
      create: jest.fn((_entity: unknown, data: unknown) => ({
        ...readRecord(data),
        createdAt: new Date('2026-07-09T10:00:00.000Z'),
        updatedAt: new Date('2026-07-09T10:00:00.000Z'),
        deletedAt: null,
      })),
      persist: jest.fn((value: unknown) => {
        persisted.push(value as PersistedTemplate)
        return em
      }),
      flush: jest.fn(async () => {
        if (!firstFlush) return
        firstFlush = false
        const seedKey = DEFAULT_DOCUMENT_TEMPLATES[0]!.seedKey
        const index = persisted.findIndex((template) => template.seedKey === seedKey)
        const contender = persisted[index]!
        persisted.splice(index, 1, { ...contender, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
        throw new Error('duplicate key value violates unique constraint')
      }),
      clear: jest.fn(),
    }

    await seedDefaultDocumentTemplates(em as unknown as EntityManager, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      createdByUserId: USER_ID,
    })

    expect(persisted).toHaveLength(DEFAULT_DOCUMENT_TEMPLATES.length)
    expect(new Set(persisted.map((template) => template.seedKey)).size).toBe(DEFAULT_DOCUMENT_TEMPLATES.length)
    expect(persisted.find((template) => template.seedKey === DEFAULT_DOCUMENT_TEMPLATES[0]!.seedKey)?.id)
      .toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(em.clear).toHaveBeenCalledTimes(1)
  })
})
