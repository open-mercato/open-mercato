/** @jest-environment node */
// T4.4 — `POST …/time-entries/[id]/duplicate`.
//
// The route is thin on purpose: the copy is the T4.2 command, so what is pinned
// here is what the route itself decides — that the overrides reach the command,
// that a locked source's shared `time_entry_locked` refusal reaches the client
// intact, that the mutation-guard registry is wired, and above all that an entry
// outside the caller's project access answers a 404 INDISTINGUISHABLE from the
// one a non-existent id gets. A 403 there would confirm the entry exists.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockGetGrantedFeatures = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockResolveProjectAccess = jest.fn()

const mockEm = {
  fork: jest.fn(() => mockEm),
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'rbacService') return { getGrantedFeatures: mockGetGrantedFeatures }
    if (token === 'em') return mockEm
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../../../../../lib/time-tracking/access', () => {
  const actual = jest.requireActual('../../../../../../lib/time-tracking/access')
  return {
    ...actual,
    resolveProjectAccess: jest.fn((...args: unknown[]) => mockResolveProjectAccess(...args)),
  }
})

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_STAFF_MEMBER_ID = '44444444-4444-4444-8444-4444444444ff'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const HIDDEN_PROJECT_ID = '55555555-5555-4555-8555-5555555555ff'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const COPY_ID = '77777777-7777-4777-8777-7777777777aa'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'
const TAG_ONE = '88888888-8888-4888-8888-000000000001'
const MANAGE_OWN = 'staff.timesheets.manage_own'

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

function buildRequest(body: unknown, entryId: string = ENTRY_ID) {
  return new Request(`http://localhost/api/staff/timesheets/time-entries/${entryId}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function sourceEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    timeProjectId: PROJECT_ID,
    lockedReportId: null,
    ...overrides,
  }
}

describe('staff timesheets duplicate route (T4.4 / US-D6)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      features: [MANAGE_OWN],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_OWN])
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockFindOneWithDecryption.mockResolvedValue(sourceEntry())
    mockResolveProjectAccess.mockResolvedValue({
      canManageAll: false,
      projectIds: [PROJECT_ID],
      staffMemberId: STAFF_MEMBER_ID,
    })
    mockExecute.mockResolvedValue({ result: { timeEntryId: COPY_ID }, logEntry: null })
  })

  it('copies an entry through the existing duplicate command', async () => {
    const response = await postHandler(buildRequest({}))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: COPY_ID, sourceId: ENTRY_ID })
    expect(mockExecute).toHaveBeenCalledWith(
      'staff.timesheets.time_entries.duplicate',
      expect.objectContaining({ input: expect.objectContaining({ id: ENTRY_ID }) }),
    )
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('passes the date, duration and tag overrides to the command in one call (US-D6)', async () => {
    const response = await postHandler(
      buildRequest({ date: '2026-07-08', durationMinutes: 45, tagIds: [TAG_ONE] }),
    )

    expect(response.status).toBe(201)
    const input = mockExecute.mock.calls[0][1].input as Record<string, unknown>
    expect(input.id).toBe(ENTRY_ID)
    expect(input.durationMinutes).toBe(45)
    expect(input.tagIds).toEqual([TAG_ONE])
    expect((input.date as Date).toISOString().slice(0, 10)).toBe('2026-07-08')
  })

  it('refuses a locked source with the shared time_entry_locked code', async () => {
    const { CrudHttpError } = await import('@open-mercato/shared/lib/crud/errors')
    const { TIME_ENTRY_LOCKED_CODE } = await import('../../../../../../commands/timesheets-entries')
    mockExecute.mockRejectedValueOnce(
      new CrudHttpError(409, {
        code: TIME_ENTRY_LOCKED_CODE,
        error: 'This time entry is locked in a closed report and cannot be changed.',
        lockedReportId: REPORT_ID,
        lockedEntryIds: [ENTRY_ID],
        lockedReportIds: [REPORT_ID],
      }),
    )

    const response = await postHandler(buildRequest({}))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'time_entry_locked',
      lockedReportId: REPORT_ID,
      lockedEntryIds: [ENTRY_ID],
    })
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })

  it('answers 404 — not 403 — for an entry on a project the caller cannot see, and never reaches the command', async () => {
    mockFindOneWithDecryption.mockResolvedValue(
      sourceEntry({ timeProjectId: HIDDEN_PROJECT_ID, staffMemberId: OTHER_STAFF_MEMBER_ID }),
    )

    const hidden = await postHandler(buildRequest({}))
    const hiddenBody = await hidden.json()

    // …and the same request against an id that does not exist at all.
    mockFindOneWithDecryption.mockResolvedValue(null)
    const missing = await postHandler(buildRequest({}))
    const missingBody = await missing.json()

    expect(hidden.status).toBe(404)
    expect(missing.status).toBe(404)
    // Byte-for-byte identical: the refusal cannot be used to probe for existence.
    expect(hiddenBody).toEqual(missingBody)
    expect(JSON.stringify(hiddenBody)).not.toContain(HIDDEN_PROJECT_ID)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
  })

  it("lets a caller duplicate their own project-less entry but not a colleague's", async () => {
    mockFindOneWithDecryption.mockResolvedValue(sourceEntry({ timeProjectId: null }))
    await expect(postHandler(buildRequest({})).then((res) => res.status)).resolves.toBe(201)

    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID, filterIds: [ORG_ID] })
    mockGetGrantedFeatures.mockResolvedValue([MANAGE_OWN])
    mockResolveProjectAccess.mockResolvedValue({
      canManageAll: false,
      projectIds: [PROJECT_ID],
      staffMemberId: STAFF_MEMBER_ID,
    })
    mockFindOneWithDecryption.mockResolvedValue(
      sourceEntry({ timeProjectId: null, staffMemberId: OTHER_STAFF_MEMBER_ID }),
    )

    const response = await postHandler(buildRequest({}))
    expect(response.status).toBe(404)
  })

  it('scopes the source lookup by tenant and organization', async () => {
    await postHandler(buildRequest({}))

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.anything(),
      expect.objectContaining({ id: ENTRY_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }),
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
  })

  it('wires the mutation guard registry and stops on a blocked mutation', async () => {
    const blocked = Response.json({ error: 'Blocked' }, { status: 423 })
    mockRunRouteMutationGuards.mockResolvedValueOnce({ ok: false, response: blocked })

    const response = await postHandler(buildRequest({}))

    expect(response.status).toBe(423)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(
      expect.objectContaining({
        container: mockContainer,
        auth: expect.objectContaining({
          userId: 'user-1',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          userFeatures: [MANAGE_OWN],
        }),
        input: expect.objectContaining({
          resourceKind: 'staff.timesheets.time_entry',
          resourceId: ENTRY_ID,
          operation: 'create',
        }),
      }),
    )
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects a caller without staff.timesheets.manage_own with 403', async () => {
    mockGetGrantedFeatures.mockResolvedValue(['staff.timesheets.view'])

    const response = await postHandler(buildRequest({}))

    expect(response.status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with 401', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await postHandler(buildRequest({}))

    expect(response.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range duration override with 400', async () => {
    const response = await postHandler(buildRequest({ durationMinutes: 5000 }))

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
