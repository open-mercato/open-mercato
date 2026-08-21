import { NextResponse } from 'next/server'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { EnforcementScope } from '../../../data/entities'
import { GET } from '../compliance/route'
import {
  assertActorOwnsEnforcementScope,
  resolveActorContext,
  resolveEnforcementContext,
} from '../_shared'

jest.mock('../../i18n', () => ({
  securityApiError: jest.fn((status: number, message: string) => NextResponse.json({ error: message }, { status })),
}))

jest.mock('../_shared', () => ({
  resolveEnforcementContext: jest.fn(),
  assertActorOwnsEnforcementScope: jest.fn(),
  resolveActorContext: jest.fn(),
  mapEnforcementError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'status' in error && 'body' in error) {
      const status = (error as Error & { status: number }).status
      const body = (error as Error & { body?: unknown }).body
      return NextResponse.json(body, { status })
    }
    return NextResponse.json({ error: 'Failed to process enforcement request.' }, { status: 500 })
  }),
}))

const mockedResolveEnforcementContext = resolveEnforcementContext as jest.MockedFunction<typeof resolveEnforcementContext>
const mockedAssertActorOwnsEnforcementScope = assertActorOwnsEnforcementScope as jest.MockedFunction<typeof assertActorOwnsEnforcementScope>
const mockedResolveActorContext = resolveActorContext as jest.MockedFunction<typeof resolveActorContext>

const tenantA = '33333333-3333-4333-8333-333333333333'
const tenantB = '44444444-4444-4444-8444-444444444444'

function buildContext(getComplianceReport: jest.Mock) {
  return {
    auth: { sub: 'admin-1', tenantId: tenantA, orgId: 'org-1' },
    container: { resolve: jest.fn() },
    commandContext: {} as never,
    enforcementService: { getComplianceReport } as never,
  } as never
}

describe('security enforcement compliance route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedResolveActorContext.mockResolvedValue({ tenantId: tenantA, isSuperAdmin: false })
    mockedAssertActorOwnsEnforcementScope.mockResolvedValue(undefined)
  })

  test('returns 403 for a non-superadmin requesting platform scope', async () => {
    const getComplianceReport = jest.fn()
    mockedResolveEnforcementContext.mockResolvedValue(buildContext(getComplianceReport))
    mockedAssertActorOwnsEnforcementScope.mockRejectedValueOnce(
      forbidden('Platform scope requires platform administrator privileges.'),
    )

    const req = new Request('https://example.test/api/security/enforcement/compliance?scope=platform', { method: 'GET' })
    const response = await GET(req)

    expect(response.status).toBe(403)
    expect(getComplianceReport).not.toHaveBeenCalled()
  })

  test('returns 403 for a foreign tenant scope', async () => {
    const getComplianceReport = jest.fn()
    mockedResolveEnforcementContext.mockResolvedValue(buildContext(getComplianceReport))
    mockedAssertActorOwnsEnforcementScope.mockRejectedValueOnce(forbidden('Not authorized to target this tenant.'))

    const req = new Request(
      `https://example.test/api/security/enforcement/compliance?scope=tenant&scopeId=${tenantB}`,
      { method: 'GET' },
    )
    const response = await GET(req)

    expect(response.status).toBe(403)
    expect(getComplianceReport).not.toHaveBeenCalled()
  })

  test('returns 200 for an owned tenant scope', async () => {
    const getComplianceReport = jest.fn(async () => ({ total: 1, enrolled: 1, pending: 0, overdue: 0 }))
    mockedResolveEnforcementContext.mockResolvedValue(buildContext(getComplianceReport))

    const req = new Request(
      `https://example.test/api/security/enforcement/compliance?scope=tenant&scopeId=${tenantA}`,
      { method: 'GET' },
    )
    const response = await GET(req)

    expect(response.status).toBe(200)
    expect(getComplianceReport).toHaveBeenCalledWith(EnforcementScope.TENANT, tenantA, {
      tenantId: tenantA,
      isSuperAdmin: false,
    })
  })

  test('returns 200 for a superadmin requesting platform scope', async () => {
    const getComplianceReport = jest.fn(async () => ({ total: 5, enrolled: 5, pending: 0, overdue: 0 }))
    mockedResolveEnforcementContext.mockResolvedValue(buildContext(getComplianceReport))
    mockedResolveActorContext.mockResolvedValue({ tenantId: tenantA, isSuperAdmin: true })

    const req = new Request('https://example.test/api/security/enforcement/compliance?scope=platform', { method: 'GET' })
    const response = await GET(req)

    expect(response.status).toBe(200)
    expect(getComplianceReport).toHaveBeenCalledWith(EnforcementScope.PLATFORM, undefined, {
      tenantId: tenantA,
      isSuperAdmin: true,
    })
  })
})
