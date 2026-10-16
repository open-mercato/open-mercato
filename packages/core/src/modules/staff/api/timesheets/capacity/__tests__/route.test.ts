import { StaffTeamMember } from '../../../../data/entities'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const ownMemberId = '44444444-4444-4444-8444-444444444444'
const colleagueId = '55555555-5555-4555-8555-555555555555'

type MemberRow = { id: string; userId: string | null; tenantId: string; organizationId: string; deletedAt: Date | null }

let memberRows: MemberRow[] = []

const findOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity !== StaffTeamMember) return null
  return (
    memberRows.find(
      (row) =>
        (where.id === undefined || row.id === where.id) &&
        (where.userId === undefined || row.userId === where.userId) &&
        row.tenantId === where.tenantId &&
        row.organizationId === where.organizationId &&
        row.deletedAt === null,
    ) ?? null
  )
})

let grantedFeatures: string[] = ['staff.timesheets.view']
const resolveCapacityAsync = jest.fn(async (staffMemberId: string | null, dateRange: { workingDays: string[] }) => ({
  targetMinutesByDate: Object.fromEntries(dateRange.workingDays.map((date) => [date, 240])),
  totalTargetMinutes: dateRange.workingDays.length * 240,
  label: `contract:${staffMemberId}`,
  providerId: 'app.contract_hours',
  isBuiltIn: false,
}))

const em = { fork: () => em }

const container = {
  hasRegistration: (name: string) => ['em', 'rbacService', 'moduleConfigService', 'timeCapacityResolver'].includes(name),
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') {
      return {
        getGrantedFeatures: async () => grantedFeatures,
        userHasAllFeatures: async (_u: string, required: string[]) =>
          required.every((feature) => grantedFeatures.some((grant) => grant === '*' || grant === feature)),
      }
    }
    if (name === 'moduleConfigService') return { getRecord: async () => null }
    if (name === 'timeCapacityResolver') return { resolveCapacityAsync }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId: tenantA, sub: userId, orgId: organizationId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) =>
    (findOneWithDecryption as unknown as (...a: unknown[]) => unknown)(...args),
  findWithDecryption: jest.fn(async () => []),
}))

import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { GET, metadata } from '../route'

const getRequest = (query: string) => new Request(`http://localhost/api/staff/timesheets/capacity?${query}`)

describe('GET /api/staff/timesheets/capacity (#6934)', () => {
  beforeEach(() => {
    grantedFeatures = ['staff.timesheets.view']
    authValue = { tenantId: tenantA, sub: userId, orgId: organizationId }
    memberRows = [
      { id: ownMemberId, userId, tenantId: tenantA, organizationId, deletedAt: null },
      { id: colleagueId, userId: null, tenantId: tenantA, organizationId, deletedAt: null },
    ]
    resolveCapacityAsync.mockClear()
  })

  it('requires the timesheet view feature', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['staff.timesheets.view'] })
  })

  it("resolves the caller's own target through the timeCapacityResolver", async () => {
    const response = await GET(getRequest('from=2026-08-21&to=2026-08-24'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      staffMemberId: ownMemberId,
      from: '2026-08-21',
      to: '2026-08-24',
      workingDays: 2,
      providerId: 'app.contract_hours',
      isBuiltIn: false,
      label: `contract:${ownMemberId}`,
      totalTargetMinutes: 480,
      targetMinutesByDate: { '2026-08-21': 240, '2026-08-24': 240 },
    })
    expect(resolveCapacityAsync).toHaveBeenCalledWith(
      ownMemberId,
      { from: '2026-08-21', to: '2026-08-24', workingDays: ['2026-08-21', '2026-08-24'] },
      expect.objectContaining({ tenantId: tenantA, organizationId }),
    )
  })

  it("refuses another person's target without the manage-projects feature", async () => {
    const response = await GET(getRequest(`from=2026-08-24&to=2026-08-24&staffMemberId=${colleagueId}`))
    expect(response.status).toBe(403)
    expect(resolveCapacityAsync).not.toHaveBeenCalled()
  })

  it("answers another person's target for a project manager", async () => {
    grantedFeatures = ['staff.timesheets.view', 'staff.timesheets.projects.manage']
    const response = await GET(getRequest(`from=2026-08-24&to=2026-08-24&staffMemberId=${colleagueId}`))
    expect(response.status).toBe(200)
    expect((await response.json()).staffMemberId).toBe(colleagueId)
  })

  it('never resolves a staff member from another tenant', async () => {
    grantedFeatures = ['staff.timesheets.view', 'staff.timesheets.projects.manage']
    memberRows = memberRows.map((row) => (row.id === colleagueId ? { ...row, tenantId: tenantB } : row))
    const response = await GET(getRequest(`from=2026-08-24&to=2026-08-24&staffMemberId=${colleagueId}`))
    expect(response.status).toBe(404)
    expect(resolveCapacityAsync).not.toHaveBeenCalled()
  })

  it('rejects a malformed or reversed period', async () => {
    expect((await GET(getRequest('from=2026-08-24&to=2026-08-01'))).status).toBe(400)
    expect((await GET(getRequest('from=yesterday&to=2026-08-01'))).status).toBe(400)
    expect((await GET(getRequest('from=2025-01-01&to=2026-08-01'))).status).toBe(400)
  })

  it('accepts a full leap year, the longest period the timesheet offers', async () => {
    const response = await GET(getRequest('from=2028-01-01&to=2028-12-31'))
    expect(response.status).toBe(200)
    expect((await response.json()).workingDays).toBe(260)
  })

  it('lets a non-manager pass their own staff member id', async () => {
    const response = await GET(getRequest(`from=2026-08-24&to=2026-08-24&staffMemberId=${ownMemberId}`))
    expect(response.status).toBe(200)
    expect((await response.json()).staffMemberId).toBe(ownMemberId)
  })

  it('falls back to the built-in target when the resolver override throws', async () => {
    resolveCapacityAsync.mockImplementationOnce(async () => {
      throw new Error('[internal] boom')
    })
    const response = await GET(getRequest('from=2026-08-24&to=2026-08-24'))
    expect(response.status).toBe(200)
    expect((await response.json()).isBuiltIn).toBe(true)
  })

  it('answers 500, not 400, on an unexpected failure', async () => {
    findOneWithDecryption.mockImplementationOnce(async () => {
      throw new Error('[internal] database down')
    })
    expect((await GET(getRequest('from=2026-08-24&to=2026-08-24'))).status).toBe(500)
  })

  it('answers 403 when the caller has no staff profile', async () => {
    memberRows = []
    expect((await GET(getRequest('from=2026-08-24&to=2026-08-24'))).status).toBe(403)
  })

  it('answers 401 without a session', async () => {
    authValue = null
    expect((await GET(getRequest('from=2026-08-24&to=2026-08-24'))).status).toBe(401)
  })

  it('answers 403 when the organization scope is explicitly empty', async () => {
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValueOnce({
      tenantId: tenantA,
      selectedId: null,
      filterIds: [],
      allowedIds: [],
    })
    expect((await GET(getRequest('from=2026-08-24&to=2026-08-24'))).status).toBe(403)
    expect(resolveCapacityAsync).not.toHaveBeenCalled()
  })
})
