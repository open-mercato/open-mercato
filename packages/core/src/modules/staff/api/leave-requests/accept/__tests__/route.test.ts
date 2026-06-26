/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockParseScopedCommandInput = jest.fn()
const mockExecute = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
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

jest.mock('../../../guards', () => ({
  resolveUserFeatures: jest.fn(() => ['staff.leave_requests.manage']),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) => mockRunStaffMutationGuardAfterSuccess(...args)),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const buildRequest = () =>
  new Request('http://localhost/api/staff/leave-requests/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'leave-1' }),
  })

describe('staff leave-requests accept route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['staff.leave_requests.manage'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockParseScopedCommandInput.mockReturnValue({ id: 'leave-1', decisionComment: null })
    mockExecute.mockResolvedValue({ result: { requestId: 'leave-1' }, logEntry: null })
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  })

  it('blocks the decision when the mutation guard denies the request', async () => {
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
        resourceKind: 'staff.leave_request',
        resourceId: 'leave-1',
        operation: 'update',
        requestMethod: 'POST',
      }),
      expect.any(Array),
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

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith('staff.leave-requests.accept', expect.anything())
    expect(mockRunStaffMutationGuardAfterSuccess).toHaveBeenCalledWith(
      [{ guard: {}, metadata: { lock: 'token' } }],
      expect.objectContaining({
        resourceKind: 'staff.leave_request',
        resourceId: 'leave-1',
        operation: 'update',
      }),
    )
  })

  it('does not run the after-success hook when the guard does not request it', async () => {
    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalled()
    expect(mockRunStaffMutationGuardAfterSuccess).not.toHaveBeenCalled()
  })
})
