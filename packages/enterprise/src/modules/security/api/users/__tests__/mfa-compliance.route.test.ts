import { NextResponse } from 'next/server'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { GET } from '../mfa/compliance/route'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { assertActorOwnsTenantScope, resolveSecurityUsersContext } from '../_shared'

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: jest.fn(),
}))

jest.mock('../../i18n', () => ({
  securityApiError: jest.fn((status: number, message: string) => NextResponse.json({ error: message }, { status })),
}))

jest.mock('../_shared', () => ({
  resolveSecurityUsersContext: jest.fn(),
  assertActorOwnsTenantScope: jest.fn(),
  mapSecurityUsersError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'status' in error && 'body' in error) {
      const status = (error as Error & { status: number }).status
      const body = (error as Error & { body?: unknown }).body
      return NextResponse.json(body, { status })
    }
    if (error instanceof Error && 'statusCode' in error) {
      const statusCode = (error as Error & { statusCode: number }).statusCode
      const body = 'body' in error ? (error as Error & { body?: unknown }).body : { error: error.message }
      return NextResponse.json(body, { status: statusCode })
    }
    return NextResponse.json({ error: 'Failed to process user security request.' }, { status: 500 })
  }),
}))

const mockedResolveSecurityUsersContext = resolveSecurityUsersContext as jest.MockedFunction<typeof resolveSecurityUsersContext>
const mockedAssertActorOwnsTenantScope = assertActorOwnsTenantScope as jest.MockedFunction<typeof assertActorOwnsTenantScope>
const mockedResolveIsSuperAdmin = resolveIsSuperAdmin as jest.MockedFunction<typeof resolveIsSuperAdmin>

const tenantA = '33333333-3333-4333-8333-333333333333'
const tenantB = '44444444-4444-4444-8444-444444444444'

function buildContext(bulkComplianceCheck: jest.Mock) {
  return {
    auth: { sub: 'admin-1', tenantId: tenantA, orgId: 'org-1' },
    container: { resolve: jest.fn() },
    commandContext: {} as never,
    mfaAdminService: { bulkComplianceCheck } as never,
  } as never
}

describe('security users mfa compliance route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedResolveIsSuperAdmin.mockResolvedValue(false)
  })

  test('returns 200 for own-tenant compliance and forwards full scope (tenantId + organizationId + isSuperAdmin)', async () => {
    const bulkComplianceCheck = jest.fn(async () => [])
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(bulkComplianceCheck))
    mockedAssertActorOwnsTenantScope.mockResolvedValue(tenantA)

    const req = new Request('https://example.test/api/security/users/mfa/compliance', { method: 'GET' })
    const response = await GET(req)

    expect(response.status).toBe(200)
    expect(bulkComplianceCheck).toHaveBeenCalledWith(tenantA, {
      tenantId: tenantA,
      organizationId: 'org-1',
      isSuperAdmin: false,
    })
  })

  test('returns 403 when requesting a foreign tenant as a non-superadmin (assertActorOwnsTenantScope rejects)', async () => {
    const bulkComplianceCheck = jest.fn()
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(bulkComplianceCheck))
    mockedAssertActorOwnsTenantScope.mockRejectedValueOnce(forbidden('Not authorized to target this tenant.'))

    const req = new Request(`https://example.test/api/security/users/mfa/compliance?tenantId=${tenantB}`, { method: 'GET' })
    const response = await GET(req)

    expect(response.status).toBe(403)
    expect(bulkComplianceCheck).not.toHaveBeenCalled()
  })

  test('allows a superadmin to query a foreign tenant', async () => {
    const bulkComplianceCheck = jest.fn(async () => [])
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(bulkComplianceCheck))
    mockedAssertActorOwnsTenantScope.mockResolvedValue(tenantB)
    mockedResolveIsSuperAdmin.mockResolvedValue(true)

    const req = new Request(`https://example.test/api/security/users/mfa/compliance?tenantId=${tenantB}`, { method: 'GET' })
    const response = await GET(req)

    expect(response.status).toBe(200)
    expect(bulkComplianceCheck).toHaveBeenCalledWith(tenantB, {
      tenantId: tenantA,
      organizationId: 'org-1',
      isSuperAdmin: true,
    })
  })

  test('returns 400 when no tenant context resolves', async () => {
    const bulkComplianceCheck = jest.fn()
    mockedResolveSecurityUsersContext.mockResolvedValue(buildContext(bulkComplianceCheck))
    mockedAssertActorOwnsTenantScope.mockResolvedValue(null)

    const req = new Request('https://example.test/api/security/users/mfa/compliance', { method: 'GET' })
    const response = await GET(req)

    expect(response.status).toBe(400)
    expect(bulkComplianceCheck).not.toHaveBeenCalled()
  })
})
