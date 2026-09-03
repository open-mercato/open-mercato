/** @jest-environment node */
// R3 — US-A1/US-A2, screen 17. The project list route is also the detail read,
// so it is the one place a Team Member could learn about a customer or project
// they were never assigned to. These tests pin the narrowing, the denial shape
// and the fact that the denial says nothing about what it refuses to show.

import { StaffTeamMember, StaffTimeProjectMember } from '../../../../data/entities'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const staffMemberId = '44444444-4444-4444-8444-444444444444'
const memberProjectId = '55555555-5555-4555-8555-555555555555'
const foreignProjectId = '66666666-6666-4666-8666-666666666666'

const IMPOSSIBLE_PROJECT_ID = '00000000-0000-0000-0000-000000000000'

const PROJECT_NAME = 'Fintechly portal'
const CUSTOMER_NAME = 'Fintechly AS'

type MemberRow = {
  id: string
  userId: string
  tenantId: string
  organizationId: string
  deletedAt: Date | null
}

type ProjectMemberRow = {
  timeProjectId: string
  staffMemberId: string
  tenantId: string
  organizationId: string
  assignedStartDate: string | null
  assignedEndDate: string | null
}

let memberRows: MemberRow[] = []
let projectMemberRows: ProjectMemberRow[] = []
let grantedFeatures: string[] = ['staff.timesheets.projects.view']
let rbacThrows = false
let authValue: Record<string, unknown> | null = null

const findWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === StaffTimeProjectMember) {
    return projectMemberRows.filter(
      (row) =>
        row.staffMemberId === where.staffMemberId &&
        row.tenantId === where.tenantId &&
        row.organizationId === where.organizationId,
    )
  }
  return []
})

const findOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === StaffTeamMember) {
    return (
      memberRows.find(
        (row) =>
          row.userId === where.userId &&
          row.tenantId === where.tenantId &&
          row.organizationId === where.organizationId &&
          row.deletedAt === null,
      ) ?? null
    )
  }
  return null
})

const em = {
  fork: () => em,
  find: jest.fn(async () => projectMemberRows),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') {
      if (rbacThrows) throw new Error('[internal] rbacService unavailable')
      return {
      getGrantedFeatures: async () => grantedFeatures,
      // Same grants, asked the way the code now asks — a test that grants a
      // feature must still grant it once the check goes through the service.
      userHasAllFeatures: async (_u: string, required: string[]) =>
        required.every((feature: string) =>
          (grantedFeatures ?? []).some((grant: string) =>
            grant === '*' || grant === feature || (grant.endsWith('.*') && feature.startsWith(grant.slice(0, -1))),
          ),
        ),
    }
    }
    if (name === 'moduleConfigService') throw new Error('[internal] moduleConfigService not registered')
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

type CapturedCrudOptions = {
  list: {
    buildFilters: (query: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
}

let capturedCrudOptions: CapturedCrudOptions | null = null
const crudGet = jest.fn(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: CapturedCrudOptions) => {
    capturedCrudOptions = options
    return { GET: crudGet, POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  },
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) =>
    (findWithDecryption as unknown as (...a: unknown[]) => unknown)(...args),
  findOneWithDecryption: (...args: unknown[]) =>
    (findOneWithDecryption as unknown as (...a: unknown[]) => unknown)(...args),
}))

import { GET, NO_PROJECT_ACCESS_REASON } from '../route'

const listRequest = (params: Record<string, string> = {}) => {
  const url = new URL('http://localhost/api/staff/timesheets/time-projects')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url)
}

const ctxFor = (request: Request, overrides: Record<string, unknown> = {}) => ({
  container,
  auth: { sub: userId, tenantId: tenantA, orgId: organizationId },
  organizationScope: null,
  selectedOrganizationId: organizationId,
  organizationIds: [organizationId],
  request,
  ...overrides,
})

const buildFilters = async (query: Record<string, unknown>, request: Request, ctxOverrides: Record<string, unknown> = {}) => {
  if (!capturedCrudOptions) throw new Error('[internal] crud options were not captured')
  return capturedCrudOptions.list.buildFilters(query, ctxFor(request, ctxOverrides))
}

describe('time-projects list route project access scoping', () => {
  beforeEach(() => {
    container.resolve.mockClear()
    crudGet.mockClear()
    findWithDecryption.mockClear()
    findOneWithDecryption.mockClear()
    rbacThrows = false
    grantedFeatures = ['staff.timesheets.projects.view']
    authValue = { sub: userId, tenantId: tenantA, orgId: organizationId }
    memberRows = [{ id: staffMemberId, userId, tenantId: tenantA, organizationId, deletedAt: null }]
    projectMemberRows = [
      {
        timeProjectId: memberProjectId,
        staffMemberId,
        tenantId: tenantA,
        organizationId,
        assignedStartDate: null,
        assignedEndDate: null,
      },
    ]
  })

  describe('list narrowing', () => {
    it('leaves a canManageAll caller unrestricted', async () => {
      grantedFeatures = ['staff.timesheets.projects.manage']

      const filters = await buildFilters({}, listRequest())

      expect(filters.id).toBeUndefined()
    })

    it('narrows a member to the projects they are assigned to', async () => {
      const filters = await buildFilters({}, listRequest())

      expect(filters.id).toEqual({ $in: [memberProjectId] })
    })

    it('returns zero rows for a foreign project id on the list', async () => {
      const filters = await buildFilters({ ids: foreignProjectId }, listRequest({ ids: foreignProjectId }))

      expect(filters.id).toEqual({ $in: [IMPOSSIBLE_PROJECT_ID] })
    })

    it('keeps only the accessible ids when a mixed id list is requested', async () => {
      const requested = `${memberProjectId},${foreignProjectId}`

      const filters = await buildFilters({ ids: requested }, listRequest({ ids: requested }))

      expect(filters.id).toEqual({ $in: [memberProjectId] })
    })

    it('gives a caller with no staff profile an empty list rather than an error', async () => {
      memberRows = []

      const filters = await buildFilters({}, listRequest())

      expect(filters.id).toEqual({ $in: [IMPOSSIBLE_PROJECT_ID] })
    })

    it('does not leak another tenant projects into the caller scope', async () => {
      // The caller authenticates into tenant B; their tenant A membership must
      // not follow them across the boundary.
      const filters = await buildFilters({}, listRequest(), {
        auth: { sub: userId, tenantId: tenantB, orgId: organizationId },
      })

      expect(filters.id).toEqual({ $in: [IMPOSSIBLE_PROJECT_ID] })
    })

    it('fails closed to membership scoping when the grant lookup throws', async () => {
      rbacThrows = true

      const filters = await buildFilters({}, listRequest())

      expect(filters.id).toEqual({ $in: [memberProjectId] })
    })

    it('still applies the search filter alongside the access narrowing', async () => {
      const filters = await buildFilters({ q: 'portal' }, listRequest({ q: 'portal' }))

      expect(filters.id).toEqual({ $in: [memberProjectId] })
      expect(filters.name).toEqual({ $ilike: '%portal%' })
    })
  })

  describe('detail fetch', () => {
    it('answers 404 with only the membership discriminator for a foreign id', async () => {
      const response = await GET(listRequest({ ids: foreignProjectId, pageSize: '1' }))

      expect(response.status).toBe(404)
      expect(crudGet).not.toHaveBeenCalled()

      const body = (await response.json()) as Record<string, unknown>
      expect(body.reason).toBe(NO_PROJECT_ACCESS_REASON)
      expect(Object.keys(body).sort()).toEqual(['error', 'reason'])
    })

    it('never names the project or the customer in the denial body', async () => {
      const response = await GET(listRequest({ ids: foreignProjectId }))
      const raw = await response.text()

      expect(raw).not.toContain(PROJECT_NAME)
      expect(raw).not.toContain(CUSTOMER_NAME)
      expect(raw).not.toContain(foreignProjectId)
    })

    it('applies the same denial to the ?id= spelling', async () => {
      const response = await GET(listRequest({ id: foreignProjectId }))

      expect(response.status).toBe(404)
      expect(((await response.json()) as { reason?: string }).reason).toBe(NO_PROJECT_ACCESS_REASON)
    })

    it('answers the identical 404 for an id that does not exist, so ids cannot be enumerated', async () => {
      const unknownId = '77777777-7777-4777-8777-777777777777'

      const denied = await GET(listRequest({ ids: foreignProjectId }))
      const unknown = await GET(listRequest({ ids: unknownId }))

      expect(unknown.status).toBe(denied.status)
      expect(await unknown.text()).toBe(await denied.text())
    })

    it('serves a member their own project', async () => {
      const response = await GET(listRequest({ ids: memberProjectId, pageSize: '1' }))

      expect(response.status).toBe(200)
      expect(crudGet).toHaveBeenCalledTimes(1)
    })

    it('serves any project to a canManageAll caller', async () => {
      grantedFeatures = ['staff.timesheets.projects.manage']

      const response = await GET(listRequest({ ids: foreignProjectId, pageSize: '1' }))

      expect(response.status).toBe(200)
      expect(crudGet).toHaveBeenCalledTimes(1)
    })

    it('leaves an unfiltered list request to the crud handler', async () => {
      memberRows = []

      const response = await GET(listRequest())

      expect(response.status).toBe(200)
      expect(crudGet).toHaveBeenCalledTimes(1)
    })

    it('leaves an unauthenticated request to the crud handler to reject', async () => {
      authValue = null

      await GET(listRequest({ ids: foreignProjectId }))

      expect(crudGet).toHaveBeenCalledTimes(1)
    })

    it('fails closed when the access decision cannot be made at all', async () => {
      container.resolve.mockImplementationOnce(() => {
        throw new Error('[internal] container unavailable')
      })
      // `createRequestContainer` is mocked, so force the failure inside the probe.
      authValue = { sub: userId, tenantId: tenantA, orgId: organizationId }
      findOneWithDecryption.mockImplementationOnce(async () => {
        throw new Error('[internal] database unavailable')
      })

      const response = await GET(listRequest({ ids: memberProjectId }))

      expect(response.status).toBe(404)
      expect(((await response.json()) as { reason?: string }).reason).toBe(NO_PROJECT_ACCESS_REASON)
      expect(crudGet).not.toHaveBeenCalled()
    })

    it('resolves access once per request and reuses it for the list filters', async () => {
      const request = listRequest({ ids: memberProjectId })

      await GET(request)
      await buildFilters({ ids: memberProjectId }, request)

      expect(findOneWithDecryption).toHaveBeenCalledTimes(1)
    })
  })
})
