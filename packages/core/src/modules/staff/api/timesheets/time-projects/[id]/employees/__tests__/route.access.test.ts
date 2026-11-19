/** @jest-environment node */
// #8885: this route only checked the global `staff.timesheets.projects.view`
// feature, so any staff member holding it could read another team's project
// membership by visiting an arbitrary project id in the URL, or by smuggling
// `?timeProjectId=` past a project they are legitimately a member of. These
// tests pin the project-level guard mirroring the project-list route
// (`../../../__tests__/route.access.test.ts`): a non-member gets the same
// membership-discriminator denial a genuinely unknown project id gets, and
// `?timeProjectId=` can never widen or redirect the URL's project.

import { StaffTeamMember, StaffTimeProjectMember } from '../../../../../../data/entities'
import { mergeAdvancedFilters } from '@open-mercato/shared/lib/crud/advanced-filter-integration'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const staffMemberId = '44444444-4444-4444-8444-444444444444'
const memberProjectId = '55555555-5555-4555-8555-555555555555'
const foreignProjectId = '66666666-6666-4666-8666-666666666666'

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

const employeesRequest = (projectId: string, params: Record<string, string> = {}) => {
  const url = new URL(`http://localhost/api/staff/timesheets/time-projects/${projectId}/employees`)
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

describe('time-project employees route project access scoping (#8885)', () => {
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

  describe('GET guard', () => {
    it('denies a non-member reading a foreign project it cannot otherwise access', async () => {
      const response = await GET(employeesRequest(foreignProjectId))

      expect(response.status).toBe(404)
      expect(crudGet).not.toHaveBeenCalled()
      const body = (await response.json()) as Record<string, unknown>
      expect(body.reason).toBe(NO_PROJECT_ACCESS_REASON)
    })

    it('never names the project in the denial body', async () => {
      const response = await GET(employeesRequest(foreignProjectId))
      const raw = await response.text()

      expect(raw).not.toContain(foreignProjectId)
    })

    it('answers the identical denial for an id that does not exist, so ids cannot be enumerated', async () => {
      const unknownId = '77777777-7777-4777-8777-777777777777'

      const denied = await GET(employeesRequest(foreignProjectId))
      const unknown = await GET(employeesRequest(unknownId))

      expect(unknown.status).toBe(denied.status)
      expect(await unknown.text()).toBe(await denied.text())
    })

    it('serves a member their own project', async () => {
      const response = await GET(employeesRequest(memberProjectId))

      expect(response.status).toBe(200)
      expect(crudGet).toHaveBeenCalledTimes(1)
    })

    it('serves any project to a canManageAll caller', async () => {
      grantedFeatures = ['staff.timesheets.projects.manage']

      const response = await GET(employeesRequest(foreignProjectId))

      expect(response.status).toBe(200)
      expect(crudGet).toHaveBeenCalledTimes(1)
    })

    it('cannot be widened to a foreign project via ?timeProjectId=', async () => {
      // The caller is a member of memberProjectId (URL), but tries to read
      // foreignProjectId's roster through the query param instead.
      const response = await GET(employeesRequest(memberProjectId, { timeProjectId: foreignProjectId }))

      expect(response.status).toBe(200)
      expect(crudGet).toHaveBeenCalledTimes(1)
      // The factory handler receives the real request; buildFilters (exercised
      // below) is what proves the query param never overrides the URL id.
    })

    it('denies a member of one project reading another project via the URL, even with a matching query param', async () => {
      const response = await GET(employeesRequest(foreignProjectId, { timeProjectId: foreignProjectId }))

      expect(response.status).toBe(404)
      expect(crudGet).not.toHaveBeenCalled()
    })

    it('gives a caller with no staff profile the same denial rather than an error', async () => {
      memberRows = []

      const response = await GET(employeesRequest(memberProjectId))

      expect(response.status).toBe(404)
      expect(((await response.json()) as { reason?: string }).reason).toBe(NO_PROJECT_ACCESS_REASON)
    })

    it('does not leak another tenant membership into the caller scope', async () => {
      authValue = { sub: userId, tenantId: tenantB, orgId: organizationId }

      const response = await GET(employeesRequest(memberProjectId))

      expect(response.status).toBe(404)
    })

    it('fails closed to denial when the access decision cannot be made at all', async () => {
      findOneWithDecryption.mockImplementationOnce(async () => {
        throw new Error('[internal] database unavailable')
      })

      const response = await GET(employeesRequest(memberProjectId))

      expect(response.status).toBe(404)
      expect(((await response.json()) as { reason?: string }).reason).toBe(NO_PROJECT_ACCESS_REASON)
      expect(crudGet).not.toHaveBeenCalled()
    })

    it('fails closed to membership scoping when the grant lookup throws', async () => {
      rbacThrows = true

      const response = await GET(employeesRequest(memberProjectId))

      expect(response.status).toBe(200)
      expect(crudGet).toHaveBeenCalledTimes(1)
    })

    it('leaves an unauthenticated request to the crud handler to reject', async () => {
      authValue = null

      const response = await GET(employeesRequest(foreignProjectId))

      expect(crudGet).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(200)
    })
  })

  describe('list filter narrowing', () => {
    it('filters by the URL project id, ignoring an attempted query override', async () => {
      const request = employeesRequest(memberProjectId, { timeProjectId: foreignProjectId })

      const filters = await buildFilters({ timeProjectId: foreignProjectId }, request)

      expect(filters.time_project_id).toBe(memberProjectId)
    })

    it('falls back to the query param only when the URL carries no project id', async () => {
      const request = new Request('http://localhost/api/staff/timesheets/time-projects/employees')

      const filters = await buildFilters({ timeProjectId: foreignProjectId }, request)

      expect(filters.time_project_id).toBe(foreignProjectId)
    })

    it('cannot be widened to a foreign project via an advanced-filter override on time_project_id (#8885 follow-up)', async () => {
      // A caller authorized for `memberProjectId` (via the URL) crafts
      // `?filter[conditions][0][field]=time_project_id&...[op]=is&...[value]=<foreignProjectId>`.
      // The CRUD factory's own merge step (`mergeAdvancedFilters` in
      // advanced-filter-integration.ts) is `{ ...existingFilters, ...advancedWhere }` —
      // a plain spread that never validates the client's field name, so an
      // unprotected `buildFilters` would have this condition silently overwrite
      // the route's own `time_project_id` key and leak the foreign project's
      // roster.
      const request = employeesRequest(memberProjectId)
      const query: Record<string, unknown> = {
        'filter[conditions][0][field]': 'time_project_id',
        'filter[conditions][0][op]': 'is',
        'filter[conditions][0][value]': foreignProjectId,
      }

      const filters = await buildFilters(query, request)

      // Every `filter[...]` key must be consumed here so the factory's own
      // merge step downstream (fed the same query object) has nothing left to
      // re-apply — it would otherwise run again on `validated` and undo this
      // route's protection.
      expect(Object.keys(query).some((key) => key.startsWith('filter['))).toBe(false)

      // The route's own project scope is AND-combined with the attacker's
      // condition, never overwritten by it: a row would have to match both
      // `memberProjectId` and `foreignProjectId` at once, which is impossible,
      // so the crafted request can only ever return zero rows — never another
      // project's roster.
      expect(filters).toEqual({
        $and: [{ time_project_id: memberProjectId }, { time_project_id: { $eq: foreignProjectId } }],
      })

      // Feeding the SAME (now-empty) query object through the real factory
      // merge step is provably a no-op, proving this is closed end-to-end and
      // not just at the `buildFilters` boundary.
      const merged = mergeAdvancedFilters(filters as Record<string, unknown>, query)
      expect(merged).toEqual(filters)
    })
  })
})
