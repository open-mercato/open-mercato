import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'
const ORG_A1 = 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ORG_A2 = 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ORG_B1 = 'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_A = 'user-a'

type OrgRow = { id: string; tenantId: string; descendantIds: string[] }

const ORG_TABLE: OrgRow[] = [
  { id: ORG_A1, tenantId: TENANT_A, descendantIds: [] },
  { id: ORG_A2, tenantId: TENANT_A, descendantIds: [] },
  { id: ORG_B1, tenantId: TENANT_B, descendantIds: [] },
]

const getAuthFromRequest = jest.fn()
const loadAcl = jest.fn()
const em = {
  find: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) => {
    const tenantId = filter.tenant as string
    const idFilter = filter.id as { $in?: string[] } | undefined
    const wanted = new Set(idFilter?.$in ?? [])
    return ORG_TABLE.filter((row) => row.tenantId === tenantId && wanted.has(row.id))
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'rbacService') return { loadAcl }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  }),
}))

import { resolveWidgetScope } from '../widgetScope'

const translate = (_key: string, fallback?: string) => fallback ?? _key

function request(): Request {
  return new Request('http://localhost/api/customers/dashboard/widgets/new-deals?limit=5')
}

async function expectCrudError(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise
  } catch (err) {
    if (!isCrudHttpError(err)) throw err
    return { status: err.status, body: err.body }
  }
  throw new Error('Expected resolveWidgetScope to reject, but it resolved')
}

describe('resolveWidgetScope scope authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequest.mockResolvedValue({
      sub: USER_A,
      tenantId: TENANT_A,
      orgId: ORG_A1,
      isSuperAdmin: false,
    })
    loadAcl.mockResolvedValue({ isSuperAdmin: false, organizations: [ORG_A1] })
  })

  it('rejects a non-superadmin selecting another tenant', async () => {
    const { status } = await expectCrudError(
      resolveWidgetScope(request(), translate, { tenantId: TENANT_B, organizationId: null }),
    )

    expect(status).toBe(403)
  })

  it('rejects a non-superadmin selecting another tenant together with that tenant\'s organization', async () => {
    const { status } = await expectCrudError(
      resolveWidgetScope(request(), translate, { tenantId: TENANT_B, organizationId: ORG_B1 }),
    )

    expect(status).toBe(403)
  })

  it('rejects a forbidden organization inside the caller\'s own tenant', async () => {
    const { status } = await expectCrudError(
      resolveWidgetScope(request(), translate, { tenantId: null, organizationId: ORG_A2 }),
    )

    expect(status).toBe(403)
  })

  it('honors an organization the caller is allowed to see', async () => {
    const scope = await resolveWidgetScope(request(), translate, { tenantId: null, organizationId: ORG_A1 })

    expect(scope.tenantId).toBe(TENANT_A)
    expect(scope.organizationIds).toEqual([ORG_A1])
  })

  it('accepts the caller restating their own tenant', async () => {
    const scope = await resolveWidgetScope(request(), translate, { tenantId: TENANT_A, organizationId: ORG_A1 })

    expect(scope.tenantId).toBe(TENANT_A)
    expect(scope.organizationIds).toEqual([ORG_A1])
  })

  it('falls back to the caller\'s allowed organizations when no override is supplied', async () => {
    loadAcl.mockResolvedValue({ isSuperAdmin: false, organizations: [ORG_A1, ORG_A2] })

    const scope = await resolveWidgetScope(request(), translate, { tenantId: null, organizationId: null })

    expect(scope.tenantId).toBe(TENANT_A)
    expect(scope.organizationIds).toEqual([ORG_A1])
  })

  it('keeps a multi-organization allowed scope when the caller has no account organization', async () => {
    getAuthFromRequest.mockResolvedValue({
      sub: USER_A,
      tenantId: TENANT_A,
      orgId: null,
      isSuperAdmin: false,
    })
    loadAcl.mockResolvedValue({ isSuperAdmin: false, organizations: [ORG_A1, ORG_A2] })

    const scope = await resolveWidgetScope(request(), translate, { tenantId: null, organizationId: null })

    expect(scope.tenantId).toBe(TENANT_A)
    expect(new Set(scope.organizationIds ?? [])).toEqual(new Set([ORG_A1, ORG_A2]))
  })

  it('lets a superadmin inspect another tenant explicitly', async () => {
    getAuthFromRequest.mockResolvedValue({
      sub: 'root',
      tenantId: TENANT_A,
      orgId: ORG_A1,
      isSuperAdmin: true,
    })
    loadAcl.mockResolvedValue({ isSuperAdmin: true, organizations: null })

    const scope = await resolveWidgetScope(request(), translate, { tenantId: TENANT_B, organizationId: ORG_B1 })

    expect(scope.tenantId).toBe(TENANT_B)
    expect(scope.organizationIds).toEqual([ORG_B1])
  })

  it('fails closed when the caller has no tenant and forges one', async () => {
    getAuthFromRequest.mockResolvedValue({
      sub: USER_A,
      tenantId: null,
      orgId: null,
      isSuperAdmin: false,
    })
    loadAcl.mockResolvedValue({ isSuperAdmin: false, organizations: [] })

    const { status } = await expectCrudError(
      resolveWidgetScope(request(), translate, { tenantId: TENANT_B, organizationId: ORG_B1 }),
    )

    expect(status).toBe(403)
  })

  it('fails closed when no tenant context can be resolved at all', async () => {
    getAuthFromRequest.mockResolvedValue({
      sub: USER_A,
      tenantId: null,
      orgId: null,
      isSuperAdmin: false,
    })
    loadAcl.mockResolvedValue({ isSuperAdmin: false, organizations: [] })

    const { status } = await expectCrudError(
      resolveWidgetScope(request(), translate, { tenantId: null, organizationId: null }),
    )

    expect(status).toBe(400)
  })

  it('rejects an unauthenticated caller before touching the container', async () => {
    getAuthFromRequest.mockResolvedValue(null)

    const { status } = await expectCrudError(
      resolveWidgetScope(request(), translate, { tenantId: TENANT_A, organizationId: ORG_A1 }),
    )

    expect(status).toBe(401)
    expect(em.find).not.toHaveBeenCalled()
  })
})
