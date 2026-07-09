import type { EntityManager } from '@mikro-orm/postgresql'
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
const mockValidateCrudMutationGuard = jest.fn()
const mockRunCrudMutationGuardAfterSuccess = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => mockValidateCrudMutationGuard(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => mockRunCrudMutationGuardAfterSuccess(...args),
}))

type MockEntityManager = {
  find: jest.Mock
  findOne: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
}

type MockRbacService = {
  loadAcl: jest.Mock
}

type TemplatesRoute = typeof import('../api/templates/route')

type PersistedTemplate = {
  id: string
  tenantId: string
  organizationId: string
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
let POST: TemplatesRoute['POST']
let PUT: TemplatesRoute['PUT']
let DELETE: TemplatesRoute['DELETE']

const mockRbacService: MockRbacService = {
  loadAcl: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string): unknown => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
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
  const route = await import('../api/templates/route')
  GET = route.GET
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
  mockValidateCrudMutationGuard.mockResolvedValue(null)
  mockRunCrudMutationGuardAfterSuccess.mockResolvedValue(undefined)
  mockAcl(['documents.view'])
})

describe('documents templates route', () => {
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

  it('persists a scoped template on POST', async () => {
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
    expect(mockEm.create).toHaveBeenCalledWith(
      DocumentTemplate,
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        name: payload.name,
        description: payload.description,
        bodyHtml: payload.bodyHtml,
        contextSlots: payload.contextSlots,
        createdByUserId: USER_ID,
        isActive: false,
      }),
    )
    expect(mockEm.persist).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      createdByUserId: USER_ID,
    }))
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
  })
})

describe('document template defaults seeding', () => {
  it('creates each default template once across repeated runs', async () => {
    const persisted: PersistedTemplate[] = []
    const em: MockEntityManager = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown, where: unknown) => {
        if (entity !== DocumentTemplate) return null
        const query = readRecord(where)
        return persisted.find((template) => (
          template.tenantId === query.tenantId
          && template.organizationId === query.organizationId
          && template.name === query.name
          && template.deletedAt === null
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
    expect(new Set(persisted.map((template) => template.name)).size).toBe(DEFAULT_DOCUMENT_TEMPLATES.length)
    expect(persisted).toEqual(expect.arrayContaining(
      DEFAULT_DOCUMENT_TEMPLATES.map((seed) => expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        name: seed.name,
        description: seed.description,
        bodyHtml: seed.bodyHtml,
        contextSlots: seed.contextSlots,
        createdByUserId: USER_ID,
        isActive: true,
      })),
    ))
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
