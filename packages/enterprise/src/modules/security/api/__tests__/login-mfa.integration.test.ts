import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { POST } from '@open-mercato/core/modules/auth/api/login'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { MfaProviderRegistry } from '../../lib/mfa-provider-registry'
import { defaultSecurityModuleConfig } from '../../lib/security-config'
import { MfaVerificationService } from '../../services/MfaVerificationService'
import type { MfaService } from '../../services/MfaService'
import type { MfaEnforcementService } from '../../services/MfaEnforcementService'
import { interceptors } from '../interceptors'

const tenantId = '3e4d3851-12af-4e72-a514-c07232805215'
const organizationId = '058fda92-9934-4e2f-b733-83584214e3f2'
const userId = '3074be34-5dd8-44ca-acb3-3cb30e9086c1'
const sessionId = '5185a109-c950-414d-a889-5d2f3c3fb619'
const mockReportError = jest.fn()
const methods = [{ userId, tenantId, type: 'totp' }]
const mockEm = {
  find: jest.fn(async () => methods),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'challenge-1', ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}
const mockAuthService = {
  findUsersByEmail: jest.fn(async () => [{
    id: userId, tenantId, organizationId, email: 'mfa-test@example.com', passwordHash: 'hash',
  }]),
  verifyPassword: jest.fn(async () => true),
  getUserRoles: jest.fn(async () => ['employee']),
  updateLastLoginAt: jest.fn(async () => undefined),
  createSession: jest.fn(async () => ({ session: { id: sessionId }, token: 'provisional-refresh' })),
  deleteSessionById: jest.fn(async () => undefined),
}
let mfaService: MfaVerificationService
let serviceUnavailable = false
const mockContainer = {
  resolve(name: string) {
    if (name === 'authService') return mockAuthService
    if (name === 'em') return mockEm
    if (name === 'eventBus') return { emitEvent: async () => undefined }
    if (name === 'mfaVerificationService' && !serviceUnavailable) return mfaService
    throw new Error('[internal] Service unavailable')
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => mockContainer,
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => ({ id: tenantId }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))
jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: async () => ({ error: null, compoundKey: null }),
  resetAuthRateLimit: async () => undefined,
}))
jest.mock('@open-mercato/core/modules/auth/events', () => ({ emitAuthEvent: async () => undefined }))
jest.mock('../../events', () => ({ emitSecurityEvent: async () => undefined }))

function login(remember: boolean) {
  return POST(new Request('http://localhost/api/auth/login', {
    method: 'POST',
    body: new URLSearchParams({
      email: 'mfa-test@example.com', password: 'Test1!Password', remember: remember ? '1' : '0',
    }),
  }))
}

async function expectDenied(response: Response, status = 500) {
  expect(response.status).toBe(status)
  const body = await response.json()
  expect(body.token).toBeUndefined()
  expect(body.refreshToken).toBeUndefined()
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(mockAuthService.deleteSessionById).toHaveBeenCalledTimes(1)
  expect(mockAuthService.deleteSessionById).toHaveBeenCalledWith(sessionId)
}

describe('login route with the registered MFA interceptor and verification service', () => {
  const originalJwtSecret = process.env.JWT_SECRET
  const originalBypass = process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    process.env.JWT_SECRET = 'login-mfa-integration-test-secret'
    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    serviceUnavailable = false
    mockEm.find.mockResolvedValue(methods)
    mockEm.flush.mockResolvedValue(undefined)
    mockAuthService.verifyPassword.mockResolvedValue(true)
    const registry = new MfaProviderRegistry()
    registry.register({
      type: 'totp', label: 'Authenticator', icon: 'Smartphone', allowMultiple: true,
      setupSchema: z.unknown(), verifySchema: z.unknown(),
      setup: async () => ({ setupId: 'setup-1', clientData: {} }),
      confirmSetup: async () => ({ metadata: {} }),
      prepareChallenge: async () => ({}),
      verify: async () => true,
    })
    mfaService = new MfaVerificationService(
      mockEm as unknown as EntityManager,
      registry,
      {} as MfaService,
      { getEffectivePolicyForUser: async () => null } as unknown as MfaEnforcementService,
      defaultSecurityModuleConfig,
    )
    registerApiInterceptors([{ moduleId: 'security', interceptors }])
  })

  afterEach(() => {
    registerApiInterceptors([])
    jest.clearAllTimers()
    jest.useRealTimers()
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = originalJwtSecret
    if (originalBypass === undefined) delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    else process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = originalBypass
  })

  test.each([false, true])('denies a method lookup failure with remember=%s', async (remember) => {
    mockEm.find.mockRejectedValueOnce(new Error('[internal] Method store unavailable'))
    await expectDenied(await login(remember))
    expect(mockEm.persist).not.toHaveBeenCalled()
  })

  test.each([false, true])('denies challenge persistence failure with remember=%s', async (remember) => {
    mockEm.flush.mockRejectedValueOnce(new Error('[internal] Challenge store unavailable'))
    await expectDenied(await login(remember))
    expect(mockEm.persist).toHaveBeenCalledTimes(1)
  })

  test('does not mistake an untyped no-methods error for a verified no-MFA account', async () => {
    mockEm.find.mockRejectedValueOnce(new Error('No MFA methods configured'))
    await expectDenied(await login(true))
  })

  test('denies login when the MFA service cannot be resolved', async () => {
    serviceUnavailable = true
    await expectDenied(await login(true))
  })

  test('revokes the provisional session when challenge persistence times out', async () => {
    mockEm.flush.mockImplementationOnce(() => new Promise<void>(() => undefined))
    const pendingResponse = login(true)
    await jest.advanceTimersByTimeAsync(5000)
    await expectDenied(await pendingResponse, 504)
  })

  test('preserves the emergency bypass when the MFA service cannot be resolved', async () => {
    serviceUnavailable = true
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const response = await login(true)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(verifyJwt(body.token)).toMatchObject({ sub: userId, sid: sessionId })
    expect(body.mfa_required).toBeUndefined()
    expect(body.refreshToken).toBe('provisional-refresh')
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(mockAuthService.deleteSessionById).not.toHaveBeenCalled()
  })

  test('reports revocation failure and still returns no credentials', async () => {
    const revocationError = new Error('[internal] Session store unavailable')
    mockEm.flush.mockRejectedValueOnce(new Error('[internal] Challenge store unavailable'))
    mockAuthService.deleteSessionById.mockRejectedValueOnce(revocationError)
    await expectDenied(await login(true))
    expect(mockReportError).toHaveBeenCalledWith(revocationError, {
      module: 'auth', code: 'auth.login_revoke_failed',
    })
  })

  test.each([false, true])('preserves non-MFA login with remember=%s', async (remember) => {
    mockEm.find.mockResolvedValueOnce([])
    const response = await login(remember)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(verifyJwt(body.token)).toMatchObject({ sub: userId, sid: sessionId, tenantId, orgId: organizationId })
    expect(body.mfa_required).toBeUndefined()
    expect(body.refreshToken).toBe(remember ? 'provisional-refresh' : undefined)
    expect(response.headers.get('set-cookie')).toContain('auth_token=')
    expect(response.headers.get('set-cookie')).toContain('session_token=provisional-refresh')
    expect(mockAuthService.deleteSessionById).not.toHaveBeenCalled()
  })

  test.each([false, true])('issues only pending credentials for an MFA account with remember=%s', async (remember) => {
    const response = await login(remember)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ mfa_required: true, challenge_id: 'challenge-1' })
    expect(verifyJwt(body.token)).toMatchObject({
      sub: userId, sid: sessionId, tenantId, orgId: organizationId, mfa_pending: true, mfa_verified: false,
    })
    expect(body.refreshToken).toBeUndefined()
    expect(response.headers.get('set-cookie')).toContain(`auth_token=${body.token}`)
    expect(response.headers.get('set-cookie')).toMatch(/session_token=;[^,]*Max-Age=0/i)
    expect(mockEm.find).toHaveBeenCalledWith(expect.anything(), {
      userId, isActive: true, deletedAt: null,
    }, expect.anything())
    expect(mockAuthService.deleteSessionById).not.toHaveBeenCalled()
  })

  test('rejects invalid credentials before invoking MFA or creating a session', async () => {
    mockAuthService.verifyPassword.mockResolvedValueOnce(false)
    const response = await login(true)
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(mockAuthService.createSession).not.toHaveBeenCalled()
  })
})
