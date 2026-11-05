// Light-weight contract test: the per-request RBAC memo MUST coalesce
// concurrent + sequential getGrantedFeatures calls for the same ctx into
// a single rbacService call. This is what saves the 5-15 ms / request the
// spec attributes to Phase 3.

import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { z } from 'zod'

const getGrantedFeatures = jest.fn(async () => ['example.view'])
const rbacService = { getGrantedFeatures }
const accessLogService = { log: jest.fn(async () => {}), logMany: jest.fn(async () => {}) }

const defaultOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const defaultTenantId = '123e4567-e89b-12d3-a456-426614174000'

const em = {
  getRepository: () => ({
    find: async () => [{ id: 'id-1', organizationId: defaultOrgId, tenantId: defaultTenantId }],
    findOne: async () => null,
  }),
}

const queryEngine = {
  query: jest.fn(async () => ({
    items: [{ id: 'id-1', organization_id: defaultOrgId, tenant_id: defaultTenantId }],
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
    registrations: {
      em: true,
      queryEngine: true,
      rbacService: true,
      accessLogService: true,
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  __esModule: true,
  getAuthFromCookies: async () => ({
    sub: '00000000-0000-4000-8000-000000000001',
    tenantId: defaultTenantId,
    orgId: defaultOrgId,
  }),
  getAuthFromRequest: async () => ({
    sub: '00000000-0000-4000-8000-000000000001',
    tenantId: defaultTenantId,
    orgId: defaultOrgId,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({
    selectedId: defaultOrgId,
    filterIds: [defaultOrgId],
    allowedIds: [defaultOrgId],
    tenantId: defaultTenantId,
  }),
}))

class Todo {}

describe('per-request userFeatures memo', () => {
  beforeEach(() => {
    getGrantedFeatures.mockClear()
    accessLogService.log.mockClear()
    accessLogService.logMany.mockClear()
    queryEngine.query.mockClear()
    registerApiInterceptors([])
    process.env.OM_CRUD_ACCESS_LOG_BLOCKING = '1'
  })

  it('calls rbacService.getGrantedFeatures at most once per GET when enrichers are configured', async () => {
    const route = makeCrudRoute({
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
        fields: ['id'],
        buildFilters: () => ({} as any),
      },
      enrichers: { entityId: 'example.todo' },
    })
    const res = await route.GET(new Request('http://x/api/example/todos?page=1&pageSize=10'))
    expect(res.status).toBe(200)
    expect(getGrantedFeatures).toHaveBeenCalledTimes(1)
  })
})
