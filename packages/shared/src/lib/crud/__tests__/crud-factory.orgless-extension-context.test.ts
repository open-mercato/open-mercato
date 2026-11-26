import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { z } from 'zod'

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const homeOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const recordOrgId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type TestAuth = { sub: string; tenantId: string | null; orgId: string | null; isApiKey?: boolean }
type TestScope = { selectedId: string | null; filterIds: string[] | null; allowedIds: string[] | null; tenantId: string | null }

let currentAuth: TestAuth
let currentScope: TestScope

const rbacService = { getGrantedFeatures: jest.fn(async () => ['example.view']) }
const accessLogService = { log: jest.fn(async () => {}), logMany: jest.fn(async () => {}) }
const em = {
  getRepository: () => ({ find: async () => [], findOne: async () => null }),
}
const queryEngine = {
  query: jest.fn(async () => ({
    items: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', organization_id: recordOrgId, tenant_id: tenantId }],
    total: 1,
  })),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'em') return em
      if (key === 'queryEngine') return queryEngine
      if (key === 'rbacService') return rbacService
      if (key === 'accessLogService') return accessLogService
      throw new Error(`unexpected DI key: ${key}`)
    },
    registrations: { em: true, queryEngine: true, rbacService: true, accessLogService: true },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  __esModule: true,
  getAuthFromCookies: async () => currentAuth,
  getAuthFromRequest: async () => currentAuth,
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => currentScope,
}))

class Todo {}

function buildRoute() {
  return makeCrudRoute({
    metadata: { GET: { requireAuth: true } },
    orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
    indexer: { entityType: 'example.todo' },
    list: {
      schema: z.object({
        page: z.coerce.number().default(1),
        pageSize: z.coerce.number().default(50),
        sortField: z.string().default('id'),
        sortDir: z.enum(['asc', 'desc']).default('asc'),
      }),
      entityId: 'example.todo',
      fields: ['id', 'organization_id', 'tenant_id'],
      buildFilters: () => ({}) as never,
    },
    enrichers: { entityId: 'example.todo' },
  })
}

describe('CRUD factory enricher and interceptor context without an organization (#10188)', () => {
  const enricherContexts: EnricherContext[] = []
  const interceptorContexts: InterceptorContext[] = []

  beforeEach(() => {
    enricherContexts.length = 0
    interceptorContexts.length = 0
    jest.clearAllMocks()
    process.env.OM_CRUD_ACCESS_LOG_BLOCKING = '1'
    registerResponseEnrichers([
      {
        moduleId: 'probe',
        enrichers: [
          {
            id: 'probe.context-capture',
            targetEntity: 'example.todo',
            async enrichOne(record, context) {
              enricherContexts.push(context)
              return record
            },
            async enrichMany(records, context) {
              enricherContexts.push(context)
              return records
            },
          },
        ],
      },
    ])
    registerApiInterceptors([
      {
        moduleId: 'probe',
        interceptors: [
          {
            id: 'probe.context-capture',
            targetRoute: 'example/todos',
            methods: ['GET'],
            async before(_request, context) {
              interceptorContexts.push(context)
              return { ok: true }
            },
          },
        ],
      },
    ])
  })

  afterAll(() => {
    registerResponseEnrichers([])
    registerApiInterceptors([])
  })

  it('hands the documented empty sentinel, never another organization id, to an all-organizations API key', async () => {
    currentAuth = { sub: 'api_key:dddddddd-dddd-4ddd-8ddd-dddddddddddd', tenantId, orgId: null, isApiKey: true }
    currentScope = { selectedId: null, filterIds: null, allowedIds: null, tenantId }

    const res = await buildRoute().GET(new Request('http://x/api/example/todos?page=1&pageSize=10'))

    expect(res.status).toBe(200)
    expect(enricherContexts).toHaveLength(1)
    expect(interceptorContexts).toHaveLength(1)
    for (const context of [enricherContexts[0], interceptorContexts[0]]) {
      expect(context.organizationId).toBe('')
      expect(context.organizationId || null).toBeNull()
      expect(context.tenantId).toBe(tenantId)
      expect(context.userId).toBe(currentAuth.sub)
    }
  })

  it('hands the empty sentinel for a tenant-less caller', async () => {
    currentAuth = { sub: 'api_key:dddddddd-dddd-4ddd-8ddd-dddddddddddd', tenantId: null, orgId: null, isApiKey: true }
    currentScope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }

    const res = await buildRoute().GET(new Request('http://x/api/example/todos?page=1&pageSize=10'))

    expect(res.status).toBe(200)
    for (const context of [...enricherContexts, ...interceptorContexts]) {
      expect(context.organizationId).toBe('')
      expect(context.tenantId).toBe('')
    }
  })

  it('hands the selected organization when one is in scope', async () => {
    currentAuth = { sub: '00000000-0000-4000-8000-000000000001', tenantId, orgId: homeOrgId }
    currentScope = { selectedId: homeOrgId, filterIds: [homeOrgId], allowedIds: [homeOrgId], tenantId }

    const res = await buildRoute().GET(new Request('http://x/api/example/todos?page=1&pageSize=10'))

    expect(res.status).toBe(200)
    expect(enricherContexts[0]?.organizationId).toBe(homeOrgId)
    expect(interceptorContexts[0]?.organizationId).toBe(homeOrgId)
    expect(enricherContexts[0]?.tenantId).toBe(tenantId)
  })
})
