/** @jest-environment node */

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })

const resolveContainerValue = jest.fn()
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const otherTenantId = '33333333-3333-4333-8333-333333333333'
const otherOrganizationId = '44444444-4444-4444-8444-444444444444'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: resolveContainerValue }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
    roles: ['admin'],
  }),
  getAuthFromCookies: async () => null,
}))

// Mutable per-test override so the full-export regression below can grant a
// non-empty organization scope while the pre-existing "denies" test keeps its
// original empty-scope behavior.
let organizationScopeOverride: {
  tenantId: string
  selectedId: string | null
  filterIds: string[]
  allowedIds: string[]
} | null = null

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => organizationScopeOverride ?? ({
    tenantId,
    selectedId: organizationId,
    filterIds: [],
    allowedIds: [],
  }),
}))

import { GET } from '../route'

type MockQueryOptions = {
  filters?: Record<string, unknown>
  page?: {
    page?: number
    pageSize?: number
  }
}

// Minimal matcher for the `{ $or, $eq, $in }` filter shapes buildSchedulerJobsFilters
// produces, so the mocked query engine below genuinely enforces the filters the route
// passes it instead of always returning every row regardless of scope.
function matchesFilter(item: Record<string, unknown>, filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return true
  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$or') {
      const branches = condition as Record<string, unknown>[]
      if (!branches.some((branch) => matchesFilter(item, branch))) return false
      continue
    }
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      const ops = condition as Record<string, unknown>
      if ('$eq' in ops && item[key] !== ops.$eq) return false
      if ('$in' in ops && !(ops.$in as unknown[]).includes(item[key])) return false
    } else if (item[key] !== condition) {
      return false
    }
  }
  return true
}

describe('scheduler jobs route organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    organizationScopeOverride = null
  })

  it('denies the opt-out list before cache, query-engine, or entity-manager access', async () => {
    const response = await GET(new Request('http://localhost/api/scheduler/jobs?page=3&pageSize=20'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 3,
      pageSize: 20,
      totalPages: 0,
    })
    expect(resolveContainerValue).not.toHaveBeenCalled()
  })

  describe('full export (#7806)', () => {
    const baseJob = {
      description: null,
      schedule_type: 'cron',
      schedule_value: '* * * * *',
      timezone: 'UTC',
      target_type: 'queue',
      target_queue: 'default',
      target_command: null,
      target_payload: null,
      require_feature: null,
      is_enabled: true,
      last_run_at: null,
      next_run_at: null,
      source_type: 'user',
      source_module: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }

    const jobs = [
      {
        ...baseJob,
        id: 'job-own-org',
        name: 'Own org job',
        scope_type: 'organization',
        organization_id: organizationId,
        tenant_id: tenantId,
      },
      {
        ...baseJob,
        id: 'job-own-tenant-scope',
        name: 'Own tenant-scope job',
        scope_type: 'tenant',
        organization_id: null,
        tenant_id: tenantId,
      },
      {
        ...baseJob,
        id: 'job-other-tenant',
        name: 'Other tenant job',
        scope_type: 'organization',
        organization_id: otherOrganizationId,
        tenant_id: otherTenantId,
      },
    ]

    const makeQueryEngine = () => ({
      query: jest.fn(async (_entityId: unknown, opts: MockQueryOptions) => {
        const filtered = jobs.filter((job) => matchesFilter(job, opts.filters))
        const page = opts.page?.page ?? 1
        const pageSize = typeof opts.page?.pageSize === 'number' ? opts.page.pageSize : filtered.length
        const start = (page - 1) * pageSize
        return { items: filtered.slice(start, start + pageSize), total: filtered.length }
      }),
    })

    it('scopes a full export to the caller tenant/organization, dropping other tenants', async () => {
      organizationScopeOverride = {
        tenantId,
        selectedId: organizationId,
        filterIds: [organizationId],
        allowedIds: [organizationId],
      }
      const queryEngine = makeQueryEngine()
      resolveContainerValue.mockImplementation((name: string) => ({ queryEngine } as Record<string, unknown>)[name])

      const response = await GET(new Request('http://localhost/api/scheduler/jobs?format=json&exportScope=full'))
      expect(response.status).toBe(200)

      const text = await response.text()
      const parsed = JSON.parse(text)

      // Own-tenant rows (org-scoped and tenant-scoped) survive the export...
      expect(text).toContain('Own org job')
      expect(text).toContain('Own tenant-scope job')
      // ...but the other tenant's row — and any trace of its ids — must not (#7806:
      // before the fix, `exportFullRequested` dropped straight to `{}` as baseFilters,
      // skipping buildSchedulerJobsFilters' visibility predicate entirely).
      expect(text).not.toContain('Other tenant job')
      expect(text).not.toContain(otherTenantId)
      expect(text).not.toContain(otherOrganizationId)
      expect(parsed).toHaveLength(2)
    })
  })
})
