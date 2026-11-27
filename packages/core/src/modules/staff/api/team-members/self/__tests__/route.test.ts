/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockParseScopedCommandInput = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockExecute = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'em') return {}
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
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key })),
}))

jest.mock('@open-mercato/shared/lib/api/scoped', () => ({
  parseScopedCommandInput: jest.fn((...args: unknown[]) => mockParseScopedCommandInput(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../../guards', () => ({
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) => mockRunStaffMutationGuardAfterSuccess(...args)),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const buildRequest = () =>
  new Request('http://localhost/api/staff/team-members/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Ada Lovelace' }),
  })

describe('staff team-members self route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['staff.leave_requests.send'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockParseScopedCommandInput.mockReturnValue({ displayName: 'Ada Lovelace' })
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockExecute.mockResolvedValue({ result: { memberId: 'member-1' }, logEntry: null })
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  })

  it('blocks self-profile creation when the mutation guard denies the request', async () => {
    mockRunStaffMutationGuards.mockResolvedValueOnce({
      ok: false,
      errorStatus: 423,
      errorBody: { error: 'Locked' },
      afterSuccessCallbacks: [],
    })

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ error: 'Locked' })
    expect(mockRunStaffMutationGuards).toHaveBeenCalledWith(
      mockContainer,
      expect.objectContaining({
        resourceKind: 'staff.team_member',
        operation: 'create',
        requestMethod: 'POST',
      }),
    )
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunStaffMutationGuardAfterSuccess).not.toHaveBeenCalled()
  })

  it('runs the after-success hook when the guard requests it', async () => {
    mockRunStaffMutationGuards.mockResolvedValueOnce({
      ok: true,
      afterSuccessCallbacks: [{ guard: {}, metadata: { lock: 'token' } }],
    })

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(201)
    expect(mockExecute).toHaveBeenCalledWith('staff.team-members.create', expect.anything())
    expect(mockRunStaffMutationGuardAfterSuccess).toHaveBeenCalledWith(
      [{ guard: {}, metadata: { lock: 'token' } }],
      expect.objectContaining({
        resourceKind: 'staff.team_member',
        resourceId: 'member-1',
        operation: 'create',
      }),
    )
  })

  it('does not run the after-success hook when the guard does not request it', async () => {
    const response = await postHandler(buildRequest())

    expect(response.status).toBe(201)
    expect(mockExecute).toHaveBeenCalled()
    expect(mockRunStaffMutationGuardAfterSuccess).not.toHaveBeenCalled()
  })
})

describe('staff team-members self route scoped read', () => {
  beforeEach(() => jest.clearAllMocks())

  it('loads the caller profile in the exact tenant and organization and returns its organization', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-2', filterIds: ['org-2'] })
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'member-2', displayName: 'Ada Lovelace', userId: 'user-1', organizationId: 'org-2',
    })
    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/staff/team-members/self'))
    expect(mockFindOneWithDecryption.mock.calls[0]?.[2]).toEqual({
      tenantId: 'tenant-1', organizationId: 'org-2', userId: 'user-1', deletedAt: null,
    })
    expect(await response.json()).toEqual({
      member: {
        id: 'member-2', displayName: 'Ada Lovelace', userId: 'user-1', organizationId: 'org-2',
        teamId: null, availabilityRuleSetId: null,
      },
    })
  })

  it('finds the linked profile in another authorized organization when the selection has no profile', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockResolveOrganizationScope.mockResolvedValue({
      tenantId: 'tenant-1', selectedId: 'org-2', filterIds: ['org-2'], allowedIds: ['org-1', 'org-2'],
    })
    mockFindOneWithDecryption.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'member-1', displayName: 'Ada Lovelace', userId: 'user-1', organizationId: 'org-1',
    })
    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/staff/team-members/self'))
    expect(mockFindOneWithDecryption.mock.calls.map((call) => call[2])).toEqual([
      { tenantId: 'tenant-1', organizationId: 'org-2', userId: 'user-1', deletedAt: null },
      { tenantId: 'tenant-1', organizationId: { $in: ['org-1'] }, userId: 'user-1', deletedAt: null },
    ])
    expect(await response.json()).toMatchObject({ member: { id: 'member-1', organizationId: 'org-1' } })
  })

  it('keeps unrestricted organization fallback scoped to the resolved tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-foreign', orgId: null })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: null, filterIds: null, allowedIds: null })
    mockFindOneWithDecryption.mockResolvedValue(null)
    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/staff/team-members/self'))
    expect(mockFindOneWithDecryption.mock.calls[0]?.[2]).toEqual({ tenantId: 'tenant-1', userId: 'user-1', deletedAt: null })
    expect(await response.json()).toEqual({ member: null })
  })

  it('denies a request with no authorized organizations', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: null, filterIds: [], allowedIds: [] })
    const { GET } = await import('../route')
    expect((await GET(new Request('http://localhost/api/staff/team-members/self'))).status).toBe(403)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('does not query a member without an authorized tenant scope', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: null, selectedId: null, filterIds: null, allowedIds: null })
    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/staff/team-members/self'))
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ member: null })
  })
})
