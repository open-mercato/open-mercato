/** @jest-environment node */
// Route-level coverage for D-3: the `acknowledged` literal is deliberate friction
// (a body without it is a 400), `staff.timesheets.projects.manage` is enforced,
// the mutation-guard registry is wired the same way every `makeCrudRoute` write
// wires it, and the command's `409 project_has_locked_entries` reaches the client
// with the blocking reports intact so the UI can name them.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockGetGrantedFeatures = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'rbacService') return {
      getGrantedFeatures: mockGetGrantedFeatures,
      // Answers from the same grants the fake already carries, so a test that
      // grants a feature still grants it once the code asks the service.
      userHasAllFeatures: async (_u: string, required: string[]) => {
        const granted = (await mockGetGrantedFeatures()) ?? []
        return required.every((feature: string) =>
          granted.some((grant: string) =>
            grant === '*' || grant === feature || (grant.endsWith('.*') && feature.startsWith(grant.slice(0, -1))),
          ),
        )
      },
    }
    return undefined
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

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn((args: unknown) => mockRunRouteMutationGuards(args)),
}))

const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const REPORT_ID = '55555555-5555-4555-8555-555555555555'
const MANAGE_FEATURE = 'staff.timesheets.projects.manage'

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

function buildRequest(body: unknown) {
  return new Request(`http://localhost/api/staff/timesheets/time-projects/${PROJECT_ID}/change-currency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('staff timesheets change-currency route (D-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: [MANAGE_FEATURE],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_FEATURE])
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockExecute.mockResolvedValue({
      result: { timeProjectId: PROJECT_ID, currencyCode: 'EUR', previousCurrencyCode: 'PLN' },
      logEntry: null,
    })
  })

  it('relabels the currency on an acknowledged request', async () => {
    const response = await postHandler(buildRequest({ currencyCode: 'EUR', acknowledged: true }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: PROJECT_ID,
      currencyCode: 'EUR',
      previousCurrencyCode: 'PLN',
      converted: false,
    })
    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.time_projects.change_currency',
      expect.objectContaining({
        input: { id: PROJECT_ID, currencyCode: 'EUR', acknowledged: true },
      }),
    )
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('rejects a body without the acknowledged literal with 400', async () => {
    const response = await postHandler(buildRequest({ currencyCode: 'EUR' }))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
  })

  it('rejects a caller without staff.timesheets.projects.manage with 403', async () => {
    mockGetGrantedFeatures.mockResolvedValue(['staff.timesheets.projects.view'])

    const response = await postHandler(buildRequest({ currencyCode: 'EUR', acknowledged: true }))

    expect(response.status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
  })

  it('wires the mutation guard registry and stops on a blocked mutation', async () => {
    const blockedResponse = Response.json({ error: 'Locked' }, { status: 423 })
    mockRunRouteMutationGuards.mockResolvedValueOnce({ ok: false, response: blockedResponse })

    const response = await postHandler(buildRequest({ currencyCode: 'EUR', acknowledged: true }))

    expect(response.status).toBe(423)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(
      expect.objectContaining({
        container: mockContainer,
        auth: expect.objectContaining({
          userId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          userFeatures: [MANAGE_FEATURE],
        }),
        input: expect.objectContaining({
          resourceKind: 'staff.timesheets.time_project',
          resourceId: PROJECT_ID,
          operation: 'update',
          mutationPayload: { currencyCode: 'EUR', acknowledged: true },
        }),
      }),
    )
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('surfaces the 409 project_has_locked_entries conflict with the blocking reports', async () => {
    const { CrudHttpError } = await import('@open-mercato/shared/lib/crud/errors')
    mockExecute.mockRejectedValueOnce(
      new CrudHttpError(409, {
        code: 'project_has_locked_entries',
        error: 'This project has time entries frozen in a closed report.',
        lockedEntryCount: 2,
        lockedReports: [{ id: REPORT_ID, reference: 'TR-2026-04', title: 'April retainer' }],
      }),
    )

    const response = await postHandler(buildRequest({ currencyCode: 'EUR', acknowledged: true }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'project_has_locked_entries',
      lockedEntryCount: 2,
      lockedReports: [{ id: REPORT_ID, reference: 'TR-2026-04', title: 'April retainer' }],
    })
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with 401', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await postHandler(buildRequest({ currencyCode: 'EUR', acknowledged: true }))

    expect(response.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
