/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import {
  CustomerUser,
  CustomerUserEmailVerification,
  CustomerUserInvitation,
  CustomerUserSession,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerSessionService } from '../services/customerSessionService'
import { CustomerTokenService } from '../services/customerTokenService'
import { CustomerInvitationService } from '../services/customerInvitationService'
import { isCustomerTenantActive } from '../lib/tenantEligibility'
import { getCustomerAuthFromRequest } from '../lib/customerAuth'
import { getCustomerAuthFromCookies } from '../lib/customerAuthServer'
import { POST as login } from '../api/login'
import { POST as verifyMagicLink } from '../api/magic-link/verify'
import { signAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

const mockFindOneWithDecryption = jest.fn()
const mockCookies = jest.fn()
const mockResolve = jest.fn()
const mockBcryptCompare = jest.fn(async (..._args: unknown[]) => false)
const mockEmit = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (name: string) => mockResolve(name) }),
}))
jest.mock('next/headers', () => ({ cookies: () => mockCookies() }))
jest.mock('bcryptjs', () => ({
  compare: (...args: unknown[]) => mockBcryptCompare(...args),
  hash: jest.fn(async () => 'password-hash'),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: async () => ({ error: null, compoundKey: null }),
  resetAuthRateLimit: jest.fn(),
  customerLoginRateLimitConfig: {},
  customerLoginIpRateLimitConfig: {},
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/resolveTenantContext', () => ({
  resolveTenantContext: async (_request: Request, tenantId: string) => ({ tenantId }),
  TenantResolutionError: class TenantResolutionError extends Error {},
}))
jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const sessionId = '44444444-4444-4444-8444-444444444444'

type TenantState = { id: string; isActive: boolean; deletedAt: Date | null } | null
const unavailableTenants: [string, TenantState][] = [
  ['inactive', { id: tenantId, isActive: false, deletedAt: null }],
  ['soft-deleted', { id: tenantId, isActive: true, deletedAt: new Date() }],
  ['missing', null],
]
let currentTenant: TenantState
const user = {
  id: userId,
  tenantId,
  organizationId,
  email: 'customer@example.test',
  displayName: 'Customer',
  passwordHash: 'password-hash',
  emailVerifiedAt: new Date(),
  sessionsRevokedAt: null,
  isActive: true,
  deletedAt: null,
} as unknown as CustomerUser
const invitation = {
  id: 'invitation-id',
  tenantId,
  organizationId,
  acceptedAt: null,
  cancelledAt: null,
  expiresAt: new Date(Date.now() + 60_000),
} as unknown as CustomerUserInvitation
const session = {
  id: sessionId,
  user,
  deletedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
} as unknown as CustomerUserSession
const tokenRecord = {
  id: 'verification-id',
  user,
  usedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
}
const tokenUpdate = {
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  executeTakeFirst: jest.fn(async () => ({ numUpdatedRows: 1n })),
}
const database = { updateTable: jest.fn(() => tokenUpdate) }
const emMock = {
  findOne: jest.fn(),
  nativeUpdate: jest.fn(),
  create: jest.fn(),
  flush: jest.fn(),
  getKysely: jest.fn(() => database),
}
const em = emMock as unknown as EntityManager
const mockCreateSession = jest.fn()
const mockUpdateLastLoginAt = jest.fn()
const mockGetEffectiveFeatures = jest.fn(async () => ['portal.account.view'])

function customerToken(): string {
  return signAudienceJwt('customer', {
    sub: userId,
    sid: sessionId,
    tenantId,
    orgId: organizationId,
    type: 'customer',
  })
}

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests'
})

beforeEach(() => {
  jest.clearAllMocks()
  currentTenant = { id: tenantId, isActive: true, deletedAt: null }
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === Tenant) {
      return currentTenant
        && currentTenant.id === where.id
        && currentTenant.isActive === where.isActive
        && currentTenant.deletedAt === where.deletedAt
        ? currentTenant
        : null
    }
    if (entity === CustomerUser) return user
    if (entity === CustomerUserInvitation) return invitation
    return null
  })
  emMock.findOne.mockImplementation(async (entity: unknown) => {
    if (entity === CustomerUserSession) return session
    if (entity === CustomerUserEmailVerification) return tokenRecord
    return null
  })
  mockCreateSession.mockResolvedValue({ rawToken: 'raw-token', jwt: 'jwt', session })
  mockResolve.mockImplementation((name: string) => {
    if (name === 'em') return em
    if (name === 'customerUserService') return {
      findByEmail: async () => user,
      checkLockout: () => false,
      verifyPassword: async () => true,
      resetFailedAttemptsUnlessLocked: async () => true,
      updateLastLoginAt: mockUpdateLastLoginAt,
    }
    if (name === 'customerSessionService') return {
      createSession: mockCreateSession,
      findActiveSessionForClaims: async () => session,
    }
    if (name === 'customerTokenService') return new CustomerTokenService(em)
    if (name === 'customerRbacService') return {
      loadAcl: async () => ({ isPortalAdmin: false }),
      getEffectiveFeatures: mockGetEffectiveFeatures,
    }
    return null
  })
})

describe('portal tenant suspension authentication (#7813)', () => {
  it('rechecks live tenant state and accepts reactivation', async () => {
    await expect(isCustomerTenantActive(em, tenantId)).resolves.toBe(true)
    currentTenant = { id: tenantId, isActive: false, deletedAt: null }
    await expect(isCustomerTenantActive(em, tenantId)).resolves.toBe(false)
    currentTenant.isActive = true
    await expect(isCustomerTenantActive(em, tenantId)).resolves.toBe(true)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em, Tenant, { id: tenantId, isActive: true, deletedAt: null }, { refresh: true },
    )
  })

  it.each(unavailableTenants)('rejects API and SSR JWTs for a %s tenant', async (_state, tenant) => {
    currentTenant = tenant
    const token = customerToken()
    const request = new Request('http://localhost/api/customer_accounts/portal/profile', {
      headers: { cookie: `customer_auth_token=${token}` },
    })
    mockCookies.mockResolvedValue({ get: () => ({ value: token }) })

    await expect(getCustomerAuthFromRequest(request)).resolves.toBeNull()
    await expect(getCustomerAuthFromCookies()).resolves.toBeNull()
    expect(mockGetEffectiveFeatures).not.toHaveBeenCalled()
  })

  it('accepts API and SSR JWTs for an active tenant', async () => {
    const token = customerToken()
    mockCookies.mockResolvedValue({ get: () => ({ value: token }) })
    const request = new Request('http://localhost/api/customer_accounts/portal/profile', {
      headers: { authorization: `Bearer ${token}` },
    })

    await expect(getCustomerAuthFromRequest(request)).resolves.toMatchObject({ sub: userId, tenantId })
    await expect(getCustomerAuthFromCookies()).resolves.toMatchObject({ sub: userId, tenantId })
  })

  it.each(unavailableTenants)('rejects password login for a %s tenant without authentication side effects', async (_state, tenant) => {
    currentTenant = tenant
    const request = new Request('http://localhost/api/customer_accounts/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'Secret123!', tenantId }),
    })

    const response = await login(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Invalid email or password' })
    expect(mockBcryptCompare).toHaveBeenCalledTimes(1)
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockUpdateLastLoginAt).not.toHaveBeenCalled()
  })

  it.each(unavailableTenants)('leaves a magic-link token unused for a %s tenant', async (_state, tenant) => {
    currentTenant = tenant
    const request = new Request('http://localhost/api/customer_accounts/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'raw-magic-link' }),
    })

    const response = await verifyMagicLink(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Invalid or expired token' })
    expect(database.updateTable).not.toHaveBeenCalled()
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(emMock.nativeUpdate).not.toHaveBeenCalled()
  })

  it('consumes a magic-link token for an active tenant', async () => {
    const service = new CustomerTokenService(em)

    await expect(service.verifyEmailToken('raw-magic-link', 'magic_link')).resolves.toEqual({ userId, tenantId })
    expect(tokenUpdate.set).toHaveBeenCalledWith({ used_at: expect.any(Date) })
  })

  it.each(unavailableTenants)('leaves an invitation unaccepted for a %s tenant', async (_state, tenant) => {
    currentTenant = tenant
    const service = new CustomerInvitationService(em)

    await expect(service.acceptInvitation('raw-invitation', 'Secret123!', 'Invitee')).resolves.toBeNull()

    expect(invitation.acceptedAt).toBeNull()
    expect(emMock.create).not.toHaveBeenCalled()
    expect(emMock.flush).not.toHaveBeenCalled()
  })

  it.each(unavailableTenants)('does not refresh a session for a %s tenant', async (_state, tenant) => {
    currentTenant = tenant
    const service = new CustomerSessionService(em)

    await expect(service.refreshSession('raw-session', [])).resolves.toBeNull()

    expect(emMock.nativeUpdate).not.toHaveBeenCalled()
  })

  it('refreshes a session for an active tenant', async () => {
    const service = new CustomerSessionService(em)

    await expect(service.refreshSession('raw-session', [])).resolves.toMatchObject({ user: { id: userId } })
    expect(emMock.nativeUpdate).toHaveBeenCalledWith(CustomerUserSession, { id: sessionId }, { lastUsedAt: expect.any(Date) })
  })
})
