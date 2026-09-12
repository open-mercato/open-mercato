/** @jest-environment node */
/**
 * Screen 13's preview is a read that requires only `staff.timesheets.reports.view`,
 * so the two things standing between a plain viewer and somebody else's numbers are
 * the project-access narrowing and the money gate. Both used to be re-derived here
 * from a hand-rolled `string[] | null` grant read, where a null nobody could explain
 * was matched as if it were an answer. They now come from `resolveFeatureAccess`, and
 * what this file pins down is that an RBAC that cannot answer narrows access rather
 * than widening it.
 */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockResolveProjectAccess = jest.fn()
const mockLoadReportData = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetGrantedFeatures = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') {
      return { userHasAllFeatures: mockUserHasAllFeatures, getGrantedFeatures: mockGetGrantedFeatures }
    }
    if (token === 'em') return { fork: () => ({}) }
    throw new Error(`[internal] unexpected container resolve: ${token}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('../../../../../lib/time-tracking/access', () => ({
  ...jest.requireActual('../../../../../lib/time-tracking/access'),
  resolveProjectAccess: jest.fn((args: unknown) => mockResolveProjectAccess(args)),
}))

jest.mock('../../../../../lib/timesheets-reports/loadReportData', () => ({
  loadReportData: jest.fn((args: unknown) => mockLoadReportData(args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const MANAGE_PROJECTS_FEATURE = 'staff.timesheets.projects.manage'

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

const previewRequest = () =>
  new Request('http://localhost/api/staff/timesheets/reports/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      periodFrom: '2026-01-01',
      periodTo: '2026-01-31',
      timeProjectIds: [PROJECT_ID],
    }),
  })

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })
  mockResolveProjectAccess.mockResolvedValue({ canManageAll: false, projectIds: [], staffMemberId: null })
  mockUserHasAllFeatures.mockResolvedValue(false)
  mockGetGrantedFeatures.mockResolvedValue([])
})

describe('POST /api/staff/timesheets/reports/preview access resolution', () => {
  it('takes the manage-all decision from the authority and hands it to the resolver', async () => {
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_PROJECTS_FEATURE])
    mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: 'member-1' })
    mockLoadReportData.mockResolvedValue({ projects: [], entries: [], directory: {} })

    await postHandler(previewRequest())

    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(USER_ID, [MANAGE_PROJECTS_FEATURE], {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(mockResolveProjectAccess).toHaveBeenCalledWith(
      expect.objectContaining({ canManageAll: true, userFeatures: [MANAGE_PROJECTS_FEATURE] }),
    )
  })

  it('fails closed when the feature check throws, however generous the grant list looks', async () => {
    mockUserHasAllFeatures.mockRejectedValue(new Error('[internal] rbac unavailable'))
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_PROJECTS_FEATURE, 'staff.*'])

    const response = await postHandler(previewRequest())

    expect(mockResolveProjectAccess).toHaveBeenCalledWith(expect.objectContaining({ canManageAll: false }))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      code: 'report_project_not_found',
      missingProjectIds: [PROJECT_ID],
    })
    expect(mockLoadReportData).not.toHaveBeenCalled()
  })

  it('hands the resolver an empty grant array, never null, when the grant list is unreadable', async () => {
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetGrantedFeatures.mockRejectedValue(new Error('[internal] grant list unavailable'))
    mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: 'member-1' })
    mockLoadReportData.mockResolvedValue({ projects: [], entries: [], directory: {} })

    await postHandler(previewRequest())

    const passed = mockResolveProjectAccess.mock.calls[0][0] as { userFeatures: unknown }
    expect(passed.userFeatures).toEqual([])
    expect(passed.userFeatures).not.toBeNull()
  })

  it('hides money when the rates authority cannot be consulted', async () => {
    mockUserHasAllFeatures.mockImplementation(async (_userId: string, required: string[]) =>
      required.includes(MANAGE_PROJECTS_FEATURE),
    )
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_PROJECTS_FEATURE])
    mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: 'member-1' })
    mockLoadReportData.mockResolvedValue({
      projects: [{ id: PROJECT_ID, name: 'Alpha', hourlyRate: 120, currencyCode: 'EUR' }],
      entries: [],
      directory: {},
    })

    const response = await postHandler(previewRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.showRates).toBe(false)
    expect(body.projects[0].hourlyRate).toBeNull()
    expect(body.totals.totalAmount).toBeNull()
  })
})
