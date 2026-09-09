/** @jest-environment node */
/**
 * Regression coverage for the tag-suggestion route's tenant scope.
 *
 * The `CustomFieldValue` lookup previously filtered on `organizationId` only. Its
 * `organizationId: null` branch therefore matched globally-scoped rows belonging to
 * *any* tenant, so one tenant's label values surfaced as another tenant's tag
 * suggestions. The sibling `CustomFieldDef` lookup already carried the tenant
 * predicate, which is why the leak was easy to miss.
 *
 * The canonical example module is the standalone reference implementation, so this
 * file is also the reference for "every scoped read carries both predicates".
 */
const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A = '00000000-0000-4000-8000-0000000000a1'

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
}

const mockAuth: { value: { orgId?: string | null; tenantId?: string | null } | null } = { value: null }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(async () => mockAuth.value),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'em' ? mockEm : null),
  })),
}))

import { GET } from '../tags/route'

type MongoLikeFilter = Record<string, unknown> & { $and?: Array<Record<string, unknown>> }

function orBranchesFor(filter: MongoLikeFilter, field: string): unknown[] | undefined {
  for (const clause of filter.$and ?? []) {
    const or = (clause as { $or?: Array<Record<string, unknown>> }).$or
    if (or && or.some((branch) => field in branch)) return or.map((branch) => branch[field])
  }
  return undefined
}

describe('example tag suggestions route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.value = { orgId: ORG_A, tenantId: TENANT_A }
    mockEm.find.mockResolvedValue([])
    mockEm.findOne.mockResolvedValue(null)
  })

  it('scopes the custom field value lookup by tenant as well as organization', async () => {
    await GET(new Request('http://localhost/api/example/tags'))

    expect(mockEm.find).toHaveBeenCalledTimes(1)
    const filter = mockEm.find.mock.calls[0][1] as MongoLikeFilter

    expect(orBranchesFor(filter, 'tenantId')).toEqual([TENANT_A, null])
    expect(orBranchesFor(filter, 'organizationId')).toEqual([ORG_A, null])
  })

  it('does not surface another tenant global-scope values', async () => {
    mockEm.find.mockImplementation(async (_entity: unknown, filter: MongoLikeFilter) => {
      const tenantBranches = orBranchesFor(filter, 'tenantId')
      // Emulate a store holding one row for this tenant and one unscoped row owned by another
      // tenant. Without a tenant predicate the second row is indistinguishable and leaks.
      const rows = [
        { valueText: 'mine', tenantId: TENANT_A },
        { valueText: 'other-tenant-global', tenantId: '00000000-0000-4000-8000-00000000000b' },
      ]
      if (!tenantBranches) return rows
      return rows.filter((row) => tenantBranches.includes(row.tenantId) || tenantBranches.includes(null) && row.tenantId === null)
    })

    const response = await GET(new Request('http://localhost/api/example/tags'))
    const body = (await response.json()) as { items: Array<{ value: string }> }

    expect(body.items.map((item) => item.value)).toEqual(['mine'])
  })

  it('returns an empty option list when the caller has no organization scope', async () => {
    mockAuth.value = { orgId: null, tenantId: TENANT_A }

    const response = await GET(new Request('http://localhost/api/example/tags'))
    const body = (await response.json()) as { items: unknown[] }

    expect(body.items).toEqual([])
    expect(mockEm.find).not.toHaveBeenCalled()
  })
})
