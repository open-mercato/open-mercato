/** @jest-environment node */
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { POST as login } from '../login'
import { POST as signup } from '../signup'
import { POST as requestMagicLink } from '../magic-link/request'
import { POST as verifyMagicLink } from '../magic-link/verify'
import { POST as requestPasswordReset } from '../password/reset-request'
import { POST as confirmPasswordReset } from '../password/reset-confirm'
import { POST as verifyEmail } from '../email/verify'
import { POST as acceptInvitation } from '../invitations/accept'
import { POST as refreshSession } from '../portal/sessions-refresh'
import { CustomerTokenService } from '../../services/customerTokenService'
import { CustomerInvitationService } from '../../services/customerInvitationService'
import { requireCustomerPortalEnabled } from '../../lib/portalAccess'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const mockGetBoolConfig = jest.fn()
const mockFindByEmail = jest.fn()
const mockCreateSession = jest.fn()
const mockSendEmail = jest.fn()
const mockEnqueue = jest.fn()
const mockEmit = jest.fn()
const mockEm = {
  findOne: jest.fn(),
  nativeUpdate: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  transactional: jest.fn(),
  getKysely: jest.fn(),
}
const mockResolve = jest.fn()
const mockContainer = { resolve: mockResolve } as unknown as AppContainer

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => mockContainer,
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/resolveTenantContext', () => ({
  resolveTenantContext: async () => ({ tenantId, organizationId }),
  TenantResolutionError: class TenantResolutionError extends Error {},
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/tenantEligibility', () => ({
  isCustomerTenantActive: async () => true,
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: async () => ({ error: null }),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/authLinkQueue', () => ({
  getMagicLinkDeliveryQueue: () => ({ enqueue: mockEnqueue }),
  getPasswordResetDeliveryQueue: () => ({ enqueue: mockEnqueue }),
}))
jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => ({
    id: 'invitation-id', tenantId, organizationId,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null, cancelledAt: null,
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.transactional.mockImplementation(async (operation: (tx: typeof mockEm) => Promise<unknown>) => operation(mockEm))
  mockGetBoolConfig.mockResolvedValue({ ok: true, value: false })
  const user = { id: 'user-id', tenantId, organizationId, isActive: true }
  mockEm.findOne.mockResolvedValue({
    id: 'token-id', user, usedAt: null, expiresAt: new Date(Date.now() + 60_000),
  })
  mockResolve.mockImplementation((name: string) => {
    if (name === 'featureTogglesService') return { getBoolConfig: mockGetBoolConfig }
    if (name === 'em') return mockEm
    if (name === 'customerUserService') return { findByEmail: mockFindByEmail }
    if (name === 'customerTokenService') return new CustomerTokenService(mockEm as never)
    if (name === 'customerInvitationService') return new CustomerInvitationService(mockEm as never)
    if (name === 'customerSessionService') return {
      findByToken: async () => ({ user }),
      createSession: mockCreateSession,
    }
    return null
  })
})

const credentials = { email: 'customer@example.test', password: 'Secret123!', tenantId, organizationId }
const cases = [
  { name: 'login', handler: login, data: credentials },
  { name: 'signup', handler: signup, data: { ...credentials, displayName: 'Customer' } },
  { name: 'magic-link/request', handler: requestMagicLink, data: { email: credentials.email, tenantId } },
  { name: 'password/reset-request', handler: requestPasswordReset, data: { email: credentials.email, tenantId } },
  { name: 'magic-link/verify', handler: verifyMagicLink, data: { token: 'raw-token' } },
  { name: 'email/verify', handler: verifyEmail, data: { token: 'raw-token' } },
  { name: 'password/reset-confirm', handler: confirmPasswordReset, data: { token: 'raw-token', password: credentials.password } },
  { name: 'invitations/accept', handler: acceptInvitation, data: { token: 'raw-token', password: credentials.password, displayName: 'Customer' } },
  { name: 'portal/sessions-refresh', handler: refreshSession, data: {} },
]

describe('disabled portal auth routes (#9162)', () => {
  it.each(cases)('blocks $name before account, token, email, event or session writes', async ({ name, handler, data }) => {
    const request = new Request(`http://localhost/api/customer_accounts/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'customer_session_token=session-token' },
      body: JSON.stringify(data),
    })

    await expect(handler(request)).rejects.toMatchObject({
      status: 403,
      body: { ok: false, error: 'portal.disabled.title' },
    })
    expect(mockGetBoolConfig).toHaveBeenCalledWith('portal_enabled', tenantId)
    expect(mockFindByEmail).not.toHaveBeenCalled()
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
    expect(mockEm.getKysely).not.toHaveBeenCalled()
    const tokenVerification = ['magic-link/verify', 'email/verify', 'password/reset-confirm'].includes(name)
    expect(mockEm.transactional).toHaveBeenCalledTimes(tokenVerification ? 1 : 0)
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})

describe('tenant portal setting resolution', () => {
  it('uses each tenant setting without sharing the disabled result', async () => {
    mockGetBoolConfig.mockImplementation(async (_identifier: string, targetTenantId: string) => ({
      ok: true, value: targetTenantId !== tenantId,
    }))
    await expect(requireCustomerPortalEnabled(mockContainer, tenantId)).rejects.toMatchObject({ status: 403 })
    await expect(requireCustomerPortalEnabled(mockContainer, 'other-tenant')).resolves.toBeUndefined()
  })

  it('preserves enabled-by-default behavior when the toggle is missing', async () => {
    mockGetBoolConfig.mockResolvedValue({ ok: false, error: { code: 'MISSING_TOGGLE' } })
    await expect(requireCustomerPortalEnabled(mockContainer, tenantId)).resolves.toBeUndefined()
  })

  it('supports installations without the optional feature toggles module', async () => {
    mockResolve.mockReturnValue(undefined)
    await expect(requireCustomerPortalEnabled(mockContainer, tenantId)).resolves.toBeUndefined()
    expect(mockResolve).toHaveBeenCalledWith('featureTogglesService', { allowUnregistered: true })
  })

  it('fails closed for an invalid toggle value', async () => {
    mockGetBoolConfig.mockResolvedValue({ ok: false, error: { code: 'INVALID_VALUE' } })
    await expect(requireCustomerPortalEnabled(mockContainer, tenantId)).rejects.toMatchObject({ status: 503 })
  })

  it('does not swallow a registered service failure', async () => {
    mockResolve.mockImplementation(() => { throw new Error('service initialization failed') })
    await expect(requireCustomerPortalEnabled(mockContainer, tenantId)).rejects.toThrow('service initialization failed')
  })
})
