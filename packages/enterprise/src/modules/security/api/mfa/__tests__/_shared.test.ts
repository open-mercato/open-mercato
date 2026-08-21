import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveCanonicalStaffAuthContext } from '@open-mercato/core/modules/auth/lib/sessionIntegrity'
import { signPendingMfaToken } from '../../../lib/mfa-pending-token'
import { resolveMfaRequestContext } from '../_shared'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/auth/lib/sessionIntegrity', () => ({
  resolveCanonicalStaffAuthContext: jest.fn(),
}))

const mockedCreateRequestContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const mockedGetAuthFromRequest = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const mockedResolveCanonicalStaffAuthContext = resolveCanonicalStaffAuthContext as jest.MockedFunction<typeof resolveCanonicalStaffAuthContext>

function buildContainer() {
  const services: Record<string, unknown> = {
    em: {},
    mfaService: {},
    mfaVerificationService: {},
  }
  return {
    resolve(name: string) {
      if (!(name in services)) throw new Error(`Unknown service: ${name}`)
      return services[name]
    },
  }
}

describe('pending MFA request authentication', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.clearAllMocks()
    mockedGetAuthFromRequest.mockResolvedValue(null)
    mockedCreateRequestContainer.mockResolvedValue(buildContainer() as never)
  })

  test('verifies the pending audience and revalidates the live session scope', async () => {
    const token = signPendingMfaToken({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'organization-1',
      email: 'user@example.com',
      roles: ['admin'],
    })
    mockedResolveCanonicalStaffAuthContext.mockImplementation(async (_em, auth) => auth)

    const result = await resolveMfaRequestContext(new Request('https://example.test/api/security/mfa/verify', {
      headers: { authorization: `Bearer ${token}` },
    }), { allowPending: true })

    expect(result).not.toBeInstanceOf(Response)
    if (result instanceof Response) throw new Error('Expected authenticated MFA context')
    expect(result.auth).toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'organization-1',
      mfa_pending: true,
      mfa_verified: false,
    })
    expect(mockedResolveCanonicalStaffAuthContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sub: 'user-1', sid: 'session-1', mfa_pending: true }),
    )
  })

  test('rejects an invalid pending credential', async () => {
    const result = await resolveMfaRequestContext(new Request('https://example.test/api/security/mfa/verify', {
      headers: { authorization: 'Bearer invalid-token' },
    }), { allowPending: true })

    expect(result).toBeInstanceOf(Response)
    if (!(result instanceof Response)) throw new Error('Expected unauthorized response')
    expect(result.status).toBe(401)
    expect(mockedResolveCanonicalStaffAuthContext).not.toHaveBeenCalled()
  })

  test('rejects a pending credential whose session is no longer canonical', async () => {
    const token = signPendingMfaToken({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'organization-1',
      email: null,
      roles: [],
    })
    mockedResolveCanonicalStaffAuthContext.mockResolvedValue(null)

    const result = await resolveMfaRequestContext(new Request('https://example.test/api/security/mfa/verify', {
      headers: { cookie: `auth_token=${encodeURIComponent(token)}` },
    }), { allowPending: true })

    expect(result).toBeInstanceOf(Response)
    if (!(result instanceof Response)) throw new Error('Expected unauthorized response')
    expect(result.status).toBe(401)
  })
})
