/** @jest-environment node */
import { AsyncLocalStorage } from 'node:async_hooks'
import { POST as verifyMagicLink } from '../magic-link/verify'
import { POST as verifyEmail } from '../email/verify'
import { POST as resetPassword } from '../password/reset-confirm'
import type { DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

const mockScopes = new AsyncLocalStorage<DatabaseExecutionContext>()
const mockRunContext = jest.fn((context: DatabaseExecutionContext, callback: () => unknown) => mockScopes.run(context, callback))
const mockVerifyToken = jest.fn()
const mockFindUser = jest.fn()
const mockWrite = jest.fn()
const mockEvent = jest.fn()
const mockContainers = jest.fn()
const mockDispose = jest.fn()
const tenantId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  runWithDatabaseExecutionContext: (context: DatabaseExecutionContext, callback: () => unknown) => mockRunContext(context, callback),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockContainers(),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEvent(...args),
}))

const endpoints = [
  { handler: verifyMagicLink, operation: 'customer-magic-link' },
  { handler: verifyEmail, operation: 'customer-email-verification' },
  { handler: resetPassword, operation: 'customer-password-reset' },
]

function request() {
  return new Request('http://localhost/api/customer_accounts/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'untrusted' },
    body: JSON.stringify({ token: 'opaque-token', password: 'Secret123!' }),
  })
}

describe.each(endpoints)('$operation verified tenant continuation', ({ handler, operation }) => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDispose.mockImplementation(async () => { expect(mockScopes.getStore()).toMatchObject({ kind: 'tenant', tenantId }) })
    mockVerifyToken.mockImplementation(async () => {
      expect(mockScopes.getStore()).toBeUndefined()
      return { tenantId, userId }
    })
    mockFindUser.mockResolvedValue({ id: userId, tenantId, email: 'user@example.test', isActive: true, emailVerifiedAt: null })
    mockWrite.mockImplementation(async () => { expect(mockScopes.getStore()).toMatchObject({ kind: 'tenant', tenantId }) })
    mockEvent.mockImplementation(async () => { expect(mockScopes.getStore()).toMatchObject({ kind: 'tenant', tenantId }) })
    const manager = { nativeUpdate: mockWrite }
    mockContainers.mockImplementation(async () => ({
      dispose: mockDispose,
      resolve: (name: string) => {
        if (name === 'customerTokenService') return { verifyEmailToken: mockVerifyToken, verifyPasswordResetToken: mockVerifyToken }
        if (name === 'customerUserService') return {
          findById: mockFindUser, resetFailedAttempts: mockWrite, updateLastLoginAt: mockWrite, updatePassword: mockWrite,
        }
        if (name === 'customerRbacService') return { getEffectiveFeatures: async () => { await mockWrite(); return [] } }
        if (name === 'customerSessionService') return {
          createSession: async () => { await mockWrite(); return { rawToken: 'test-session', jwt: 'test-jwt' } },
          revokeAllUserSessions: mockWrite,
        }
        if (name === 'em') return { ...manager, transactional: async (callback: (transaction: typeof manager) => Promise<void>) => callback(manager) }
        throw new Error('Unexpected test service: ' + name)
      },
    }))
  })

  it('uses persisted token authority before resolving tenant services and writing', async () => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(mockRunContext).toHaveBeenCalledWith({ kind: 'tenant', tenantId, source: 'public-token', operation }, expect.any(Function))
    expect(mockContainers).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenCalled()
    expect(mockEvent).toHaveBeenCalledTimes(1)
    expect(mockDispose).toHaveBeenCalledTimes(1)
    expect(mockScopes.getStore()).toBeUndefined()
  })

  it('does not promote an invalid token or request tenant hint', async () => {
    mockVerifyToken.mockResolvedValue(null)
    expect((await handler(request())).status).toBe(400)
    expect(mockRunContext).not.toHaveBeenCalled()
    expect(mockWrite).not.toHaveBeenCalled()
    expect(mockEvent).not.toHaveBeenCalled()
  })

  it('keeps the response pending until subscriber dispatch finishes', async () => {
    let finish: (() => void) | undefined
    let started: (() => void) | undefined
    const eventStarted = new Promise<void>((resolve) => { started = resolve })
    const eventFinished = new Promise<void>((resolve) => { finish = resolve })
    mockEvent.mockImplementation(async () => {
      started?.()
      await eventFinished
      expect(mockScopes.getStore()).toMatchObject({ kind: 'tenant', tenantId })
    })
    let responded = false
    const response = handler(request()).then((result) => { responded = true; return result })
    await eventStarted
    expect(responded).toBe(false)
    finish?.()
    expect((await response).status).toBe(200)
  })
})
