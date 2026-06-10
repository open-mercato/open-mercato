import { NextResponse } from 'next/server'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { GET } from '../[id]/mfa/status/route'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { assertActorCanAccessSecurityUserTarget, resolveSecurityUsersContext } from '../_shared'

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: jest.fn(),
}))

jest.mock('../_shared', () => ({
  resolveSecurityUsersContext: jest.fn(),
  assertActorCanAccessSecurityUserTarget: jest.fn().mockResolvedValue(undefined),
  mapSecurityUsersError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'status' in error && 'body' in error) {
      const status = (error as Error & { status: number }).status
      const body = (error as Error & { body?: unknown }).body
      return NextResponse.json(body, { status })
    }
    return NextResponse.json({ error: 'Failed to process user security request.' }, { status: 500 })
  }),
}))

const mockedResolveSecurityUsersContext = resolveSecurityUsersContext as jest.MockedFunction<typeof resolveSecurityUsersContext>
const mockedAssertActorCanAccessSecurityUserTarget = assertActorCanAccessSecurityUserTarget as jest.MockedFunction<typeof assertActorCanAccessSecurityUserTarget>
const mockedResolveIsSuperAdmin = resolveIsSuperAdmin as jest.MockedFunction<typeof resolveIsSuperAdmin>

const tenantBUserId = '22222222-2222-4222-8222-222222222222'

function buildContext(getUserMfaStatus: jest.Mock) {
  return {
    auth: { sub: 'admin-1', tenantId: 'tenant-a', orgId: 'org-1' },
    container: { resolve: jest.fn() },
    commandContext: {} as never,
    mfaAdminService: { getUserMfaStatus } as never,
  } as never
}

describe('security user mfa status route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAssertActorCanAccessSecurityUserTarget.mockResolvedValue(undefined)
    mockedResolveIsSuperAdmin.mockResolvedValue(false)
  })

  test('returns 200 with status for an in-tenant target', async () => {
    const getUserMfaStatus = jest.fn(async () => ({
      enrolled: true,
      methods: [],
      recoveryCodesRemaining: 2,
      compliant: true,
    }))
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(getUserMfaStatus))

    const req = new Request(`https://example.test/api/security/users/${tenantBUserId}/mfa/status`, { method: 'GET' })
    const response = await GET(req, { params: Promise.resolve({ id: tenantBUserId }) })

    expect(response.status).toBe(200)
    expect(getUserMfaStatus).toHaveBeenCalledWith(tenantBUserId, { tenantId: 'tenant-a', isSuperAdmin: false })
  })

  test('returns 404 for a cross-tenant target', async () => {
    const getUserMfaStatus = jest.fn()
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(getUserMfaStatus))
    mockedAssertActorCanAccessSecurityUserTarget.mockRejectedValueOnce(new CrudHttpError(404, { error: 'User not found' }))

    const req = new Request(`https://example.test/api/security/users/${tenantBUserId}/mfa/status`, { method: 'GET' })
    const response = await GET(req, { params: Promise.resolve({ id: tenantBUserId }) })

    expect(response.status).toBe(404)
    expect(getUserMfaStatus).not.toHaveBeenCalled()
  })

  test('returns 403 for an out-of-org in-tenant target', async () => {
    const getUserMfaStatus = jest.fn()
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(getUserMfaStatus))
    mockedAssertActorCanAccessSecurityUserTarget.mockRejectedValueOnce(forbidden('Not authorized to access this user.'))

    const req = new Request(`https://example.test/api/security/users/${tenantBUserId}/mfa/status`, { method: 'GET' })
    const response = await GET(req, { params: Promise.resolve({ id: tenantBUserId }) })

    expect(response.status).toBe(403)
    expect(getUserMfaStatus).not.toHaveBeenCalled()
  })

  test('passes superadmin flag through to the service', async () => {
    const getUserMfaStatus = jest.fn(async () => ({
      enrolled: false,
      methods: [],
      recoveryCodesRemaining: 0,
      compliant: true,
    }))
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(getUserMfaStatus))
    mockedResolveIsSuperAdmin.mockResolvedValue(true)

    const req = new Request(`https://example.test/api/security/users/${tenantBUserId}/mfa/status`, { method: 'GET' })
    const response = await GET(req, { params: Promise.resolve({ id: tenantBUserId }) })

    expect(response.status).toBe(200)
    expect(getUserMfaStatus).toHaveBeenCalledWith(tenantBUserId, { tenantId: 'tenant-a', isSuperAdmin: true })
  })
})
