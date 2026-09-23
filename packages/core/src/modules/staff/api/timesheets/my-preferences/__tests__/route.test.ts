/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockLoadTimesheetPreference = jest.fn()
const mockSaveTimesheetPreference = jest.fn()
const mockIsProjectAssignedToMember = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()
const mockEnforceCommandOptimisticLock = jest.fn()
const mockLoggerError = jest.fn()

const mockEm = { fork: jest.fn(() => mockEm) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: jest.fn((...args: unknown[]) => mockEnforceCommandOptimisticLock(...args)),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { createLogger: jest.fn(() => makeLogger()) }
})

jest.mock('../../../../lib/timesheets/timesheetPreferenceService', () => ({
  loadTimesheetPreference: jest.fn((...args: unknown[]) => mockLoadTimesheetPreference(...args)),
  saveTimesheetPreference: jest.fn((...args: unknown[]) => mockSaveTimesheetPreference(...args)),
  isProjectAssignedToMember: jest.fn((...args: unknown[]) => mockIsProjectAssignedToMember(...args)),
}))

jest.mock('../../../guards', () => ({
  resolveUserFeatures: jest.fn(() => ['staff.timesheets.manage_own']),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) => mockRunStaffMutationGuardAfterSuccess(...args)),
}))

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type RouteModule = typeof import('../route')
let getHandler: RouteModule['GET']
let putHandler: RouteModule['PUT']

beforeAll(async () => {
  const mod = await import('../route')
  getHandler = mod.GET
  putHandler = mod.PUT
})

const CLIENT_PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const GUARD_PROJECT_ID = '22222222-2222-4222-8222-222222222222'

const buildPutRequest = (body: unknown = { lastProjectId: CLIENT_PROJECT_ID }) =>
  new Request('http://localhost/api/staff/timesheets/my-preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const buildGetRequest = () =>
  new Request('http://localhost/api/staff/timesheets/my-preferences', { method: 'GET' })

describe('staff timesheets my-preferences route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['staff.timesheets.manage_own'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockFindOneWithDecryption.mockResolvedValue({ id: 'member-1' })
    mockLoadTimesheetPreference.mockResolvedValue({ lastProjectId: null, updatedAt: null })
    mockSaveTimesheetPreference.mockImplementation(
      async (_em: unknown, _scope: unknown, _memberId: string, lastProjectId: string | null) => ({
        lastProjectId,
        updatedAt: '2026-08-09T10:00:00.000Z',
      }),
    )
    mockIsProjectAssignedToMember.mockResolvedValue(true)
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockEnforceCommandOptimisticLock.mockResolvedValue(undefined)
  })

  describe('GET', () => {
    it('returns the self-scoped preference without accepting a member parameter', async () => {
      mockLoadTimesheetPreference.mockResolvedValueOnce({
        lastProjectId: CLIENT_PROJECT_ID,
        updatedAt: '2026-08-09T10:00:00.000Z',
      })

      const response = await getHandler(buildGetRequest())

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        lastProjectId: CLIENT_PROJECT_ID,
        updatedAt: '2026-08-09T10:00:00.000Z',
      })
      // The member is resolved from the session, never from the request.
      expect(mockLoadTimesheetPreference).toHaveBeenCalledWith(
        mockEm,
        { tenantId: 'tenant-1', organizationId: 'org-1' },
        'member-1',
      )
    })

    it('rejects an unauthenticated caller', async () => {
      mockGetAuthFromRequest.mockResolvedValueOnce(null)

      const response = await getHandler(buildGetRequest())

      expect(response.status).toBe(401)
      expect(mockLoadTimesheetPreference).not.toHaveBeenCalled()
    })

    it('resolves the staff member inside the requested organization scope', async () => {
      await getHandler(buildGetRequest())

      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        mockEm,
        expect.anything(),
        expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null }),
        {},
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )
    })
  })

  describe('PUT mutation guards', () => {
    it('blocks the write and persists nothing when a guard denies the request', async () => {
      mockRunStaffMutationGuards.mockResolvedValueOnce({
        ok: false,
        errorStatus: 423,
        errorBody: { error: 'Locked' },
        afterSuccessCallbacks: [],
      })

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(423)
      await expect(response.json()).resolves.toEqual({ error: 'Locked' })
      expect(mockRunStaffMutationGuards).toHaveBeenCalledWith(
        mockContainer,
        expect.objectContaining({
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'staff.timesheets.preference',
          resourceId: 'member-1',
          operation: 'update',
          requestMethod: 'PUT',
          mutationPayload: { lastProjectId: CLIENT_PROJECT_ID },
        }),
      )
      expect(mockSaveTimesheetPreference).not.toHaveBeenCalled()
      expect(mockRunStaffMutationGuardAfterSuccess).not.toHaveBeenCalled()
    })

    it('defaults a guard denial without an explicit status to 422', async () => {
      mockRunStaffMutationGuards.mockResolvedValueOnce({ ok: false, afterSuccessCallbacks: [] })

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(422)
      expect(mockSaveTimesheetPreference).not.toHaveBeenCalled()
    })

    it('persists the payload a guard rewrote, not the one the client sent', async () => {
      mockRunStaffMutationGuards.mockResolvedValueOnce({
        ok: true,
        modifiedPayload: { lastProjectId: GUARD_PROJECT_ID },
        afterSuccessCallbacks: [],
      })

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(200)
      expect(mockSaveTimesheetPreference).toHaveBeenCalledWith(
        mockEm,
        { tenantId: 'tenant-1', organizationId: 'org-1' },
        'member-1',
        GUARD_PROJECT_ID,
      )
      // The rewritten id is validated too — a guard cannot smuggle in an
      // unassigned project.
      expect(mockIsProjectAssignedToMember).toHaveBeenCalledWith(
        mockEm,
        { tenantId: 'tenant-1', organizationId: 'org-1' },
        'member-1',
        GUARD_PROJECT_ID,
      )
      await expect(response.json()).resolves.toEqual({
        lastProjectId: GUARD_PROJECT_ID,
        updatedAt: '2026-08-09T10:00:00.000Z',
      })
    })

    it('rejects a guard-rewritten project id that is not a uuid', async () => {
      mockRunStaffMutationGuards.mockResolvedValueOnce({
        ok: true,
        modifiedPayload: { lastProjectId: 'not-a-uuid' },
        afterSuccessCallbacks: [],
      })

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(400)
      expect(mockSaveTimesheetPreference).not.toHaveBeenCalled()
    })

    it('runs after-success callbacks once the row is committed', async () => {
      const callbacks = [{ guard: {}, metadata: { lock: 'token' } }]
      mockRunStaffMutationGuards.mockResolvedValueOnce({ ok: true, afterSuccessCallbacks: callbacks })

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(200)
      expect(mockSaveTimesheetPreference).toHaveBeenCalledTimes(1)
      expect(mockRunStaffMutationGuardAfterSuccess).toHaveBeenCalledWith(
        callbacks,
        expect.objectContaining({
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'staff.timesheets.preference',
          resourceId: 'member-1',
          operation: 'update',
          requestMethod: 'PUT',
        }),
      )
      expect(mockSaveTimesheetPreference.mock.invocationCallOrder[0]).toBeLessThan(
        mockRunStaffMutationGuardAfterSuccess.mock.invocationCallOrder[0],
      )
    })

    it('does not invoke the after-success hook when no guard requested one', async () => {
      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(200)
      expect(mockRunStaffMutationGuardAfterSuccess).not.toHaveBeenCalled()
    })

    it('logs and swallows a throwing after-success callback instead of failing the committed write', async () => {
      mockRunStaffMutationGuards.mockResolvedValueOnce({
        ok: true,
        afterSuccessCallbacks: [{ guard: {}, metadata: null }],
      })
      mockRunStaffMutationGuardAfterSuccess.mockRejectedValueOnce(new Error('callback exploded'))

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        lastProjectId: CLIENT_PROJECT_ID,
        updatedAt: '2026-08-09T10:00:00.000Z',
      })
      expect(mockLoggerError).toHaveBeenCalledWith(
        'staff.timesheets.my-preferences.afterSuccess failed',
        expect.objectContaining({ err: expect.any(Error) }),
      )
    })
  })

  describe('PUT validation and scoping', () => {
    it('rejects a project the caller is not actively assigned to', async () => {
      mockIsProjectAssignedToMember.mockResolvedValueOnce(false)

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(400)
      expect(mockSaveTimesheetPreference).not.toHaveBeenCalled()
    })

    it('accepts a null clear without an assignment lookup', async () => {
      const response = await putHandler(buildPutRequest({ lastProjectId: null }))

      expect(response.status).toBe(200)
      expect(mockIsProjectAssignedToMember).not.toHaveBeenCalled()
      expect(mockSaveTimesheetPreference).toHaveBeenCalledWith(
        mockEm,
        { tenantId: 'tenant-1', organizationId: 'org-1' },
        'member-1',
        null,
      )
    })

    it('rejects a body that fails the zod schema', async () => {
      const response = await putHandler(buildPutRequest({ lastProjectId: 42 }))

      expect(response.status).toBe(400)
      expect(mockRunStaffMutationGuards).not.toHaveBeenCalled()
      expect(mockSaveTimesheetPreference).not.toHaveBeenCalled()
    })

    it('returns 403 when the caller has no staff member in this organization', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(403)
      expect(mockSaveTimesheetPreference).not.toHaveBeenCalled()
    })

    it('surfaces an optimistic-lock conflict as 409 before running guards or persisting', async () => {
      // The real helper throws `CrudHttpError(409, buildOptimisticLockConflictBody(...))`.
      // Rejecting with a plain Error here would fall through to the generic
      // handler and pass on a 400, leaving the 409 documented in `openApi`
      // unguarded — the route's promise that a future form-based editor of this
      // preference gets locking for free.
      mockEnforceCommandOptimisticLock.mockRejectedValueOnce(
        new CrudHttpError(409, { error: 'Conflict', code: 'optimistic_lock_conflict' }),
      )

      const response = await putHandler(buildPutRequest())

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ code: 'optimistic_lock_conflict' }),
      )
      expect(mockRunStaffMutationGuards).not.toHaveBeenCalled()
      expect(mockSaveTimesheetPreference).not.toHaveBeenCalled()
    })
  })
})
