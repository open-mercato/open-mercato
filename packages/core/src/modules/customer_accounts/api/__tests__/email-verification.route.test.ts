/** @jest-environment node */

import { CustomerUser } from '../../data/entities'
import { POST as verifyEmail } from '../email/verify'
import { POST as verifyMagicLink } from '../magic-link/verify'

const mockVerifyToken = jest.fn()
const mockUpdatePassword = jest.fn()
const mockRevoke = jest.fn()
const mockCreateSession = jest.fn()
const mockEmit = jest.fn()
const mockFindUser = jest.fn()
const mockTx = { nativeUpdate: jest.fn() }
const mockTransactional = jest.fn(async (operation: (tx: typeof mockTx) => unknown) => operation(mockTx))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => (({
      em: { transactional: mockTransactional },
      customerTokenService: { verifyEmailToken: mockVerifyToken },
      customerUserService: {
        updatePassword: mockUpdatePassword,
        resetFailedAttempts: jest.fn(),
        updateLastLoginAt: jest.fn(),
      },
      customerSessionService: { revokeAllUserSessions: mockRevoke, createSession: mockCreateSession },
      customerRbacService: { getEffectiveFeatures: jest.fn(async () => []) },
    }) as Record<string, unknown>)[key],
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindUser(...args),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

const identity = { userId: 'customer-id', tenantId: 'tenant-id' }
const organizationId = 'organization-id'
const signup = {
  id: identity.userId,
  tenantId: identity.tenantId,
  organizationId,
  createdAt: new Date(),
  email: 'fixture@example.test',
  emailVerifiedAt: null,
  passwordHash: 'legacy-pending-digest',
  isActive: true,
}
const scope = { id: identity.userId, tenantId: identity.tenantId, organizationId }

function request(path: string, password?: string) {
  return new Request(`http://localhost/api/customer_accounts/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'verification-fixture', password }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyToken.mockResolvedValue({ ...identity, organizationId })
  mockFindUser.mockResolvedValue({ ...signup })
  mockCreateSession.mockResolvedValue({ jwt: 'jwt-fixture', rawToken: 'session-fixture' })
  mockEmit.mockResolvedValue(undefined)
})

test('email verification without a new password clears the prior digest and sessions transactionally', async () => {
  const response = await verifyEmail(request('email/verify'))

  expect(response.status).toBe(200)
  expect(mockVerifyToken).toHaveBeenCalledWith('verification-fixture', 'email_verification', undefined, mockTx)
  expect(mockFindUser).toHaveBeenCalledWith(
    mockTx,
    CustomerUser,
    { ...scope, deletedAt: null },
    expect.anything(),
    { tenantId: identity.tenantId, organizationId },
  )
  expect(mockTx.nativeUpdate).toHaveBeenCalledWith(CustomerUser, scope, {
    emailVerifiedAt: expect.any(Date),
    passwordHash: null,
  })
  expect(mockRevoke).toHaveBeenCalledWith(identity.userId, mockTx)
  expect(mockEmit).toHaveBeenCalledWith('customer_accounts.email.verified', expect.objectContaining({
    userId: identity.userId, tenantId: identity.tenantId, organizationId,
  }), { tenantId: identity.tenantId, organizationId })
})

test('email verification installs the credential chosen by the token holder', async () => {
  const response = await verifyEmail(request('email/verify', 'password-chosen-after-proof'))

  expect(response.status).toBe(200)
  expect(mockUpdatePassword).toHaveBeenCalledWith(expect.objectContaining(scope), 'password-chosen-after-proof', mockTx)
  expect(mockRevoke).toHaveBeenCalledWith(identity.userId, mockTx)
})

test('an older verification link cannot replace an established password', async () => {
  mockFindUser.mockResolvedValueOnce({ ...signup, emailVerifiedAt: new Date() })

  expect((await verifyEmail(request('email/verify', 'password-fixture'))).status).toBe(400)
  expect(mockUpdatePassword).not.toHaveBeenCalled()
  expect(mockRevoke).not.toHaveBeenCalled()
})

test('first magic-link sign-in clears credentials and old sessions before creating a new session', async () => {
  const response = await verifyMagicLink(request('magic-link/verify'))

  expect(response.status).toBe(200)
  expect(mockRevoke).toHaveBeenCalledWith(identity.userId, mockTx)
  expect(mockRevoke.mock.invocationCallOrder[0]).toBeLessThan(mockCreateSession.mock.invocationCallOrder[0])
  expect(mockTx.nativeUpdate).toHaveBeenCalledWith(CustomerUser, scope, {
    emailVerifiedAt: expect.any(Date),
    passwordHash: null,
  })
})

test('expired pending registrations cannot be activated', async () => {
  mockFindUser.mockResolvedValueOnce({ ...signup, createdAt: new Date(0) })

  expect((await verifyEmail(request('email/verify', 'password-fixture'))).status).toBe(400)
  expect(mockUpdatePassword).not.toHaveBeenCalled()
  expect(mockEmit).not.toHaveBeenCalled()
})
