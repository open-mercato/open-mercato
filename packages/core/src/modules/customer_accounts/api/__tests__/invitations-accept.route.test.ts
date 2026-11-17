/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/customer_accounts/api/invitations/accept'
import {
  CustomerInvitationEmailConflictError,
} from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'

const mockAcceptInvitation = jest.fn()
const mockGetEffectiveFeatures = jest.fn()
const mockCreateSession = jest.fn()
const mockEmitCustomerAccountsEvent = jest.fn()
const mockResolveTranslations = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerInvitationService') return { acceptInvitation: mockAcceptInvitation }
    if (token === 'customerSessionService') return { createSession: mockCreateSession }
    if (token === 'customerRbacService') return { getEffectiveFeatures: mockGetEffectiveFeatures }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => mockResolveTranslations()),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn((...args: unknown[]) => {
    mockEmitCustomerAccountsEvent(...args)
    return Promise.resolve()
  }),
}))

function acceptRequest(): Request {
  return new Request('http://localhost/api/customer_accounts/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'raw-token', password: 'Secret123!', displayName: 'New User' }),
  })
}

describe('POST /api/customer_accounts/invitations/accept', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetEffectiveFeatures.mockResolvedValue(['portal.dashboard.view'])
    mockCreateSession.mockResolvedValue({ rawToken: 'session-token', jwt: 'jwt-token' })
    mockResolveTranslations.mockReturnValue({
      translate: (_key: string, fallback: string) => fallback,
    })
  })

  it('answers 409 with the translated conflict message when the invited email already has a portal account (#5899)', async () => {
    mockAcceptInvitation.mockRejectedValue(new CustomerInvitationEmailConflictError('taken@example.com'))

    const res = await POST(acceptRequest())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'An account with this email address already exists',
    })
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockEmitCustomerAccountsEvent).not.toHaveBeenCalled()
  })

  it('recognises the conflict across a bundle boundary via the marker, not instanceof', async () => {
    // The accept route resolves the service through DI and can be bundled into a
    // different chunk than the service module, so `instanceof` between the two
    // copies of the error class is unreliable — only the Symbol.for marker survives.
    const duplicateModuleError = Object.assign(new Error('[internal] An account with this email address already exists'), {
      name: 'CustomerInvitationEmailConflictError',
      email: 'taken@example.com',
      [Symbol.for('@open-mercato/CustomerInvitationEmailConflictError')]: true,
    })
    mockAcceptInvitation.mockRejectedValue(duplicateModuleError)

    const res = await POST(acceptRequest())
    expect(res.status).toBe(409)
  })

  it('lets unrelated service failures propagate instead of masking them as a conflict', async () => {
    mockAcceptInvitation.mockRejectedValue(new Error('connection lost'))

    await expect(POST(acceptRequest())).rejects.toThrow('connection lost')
  })

  it('answers 400 when the invitation token is invalid or expired', async () => {
    mockAcceptInvitation.mockResolvedValue(null)

    const res = await POST(acceptRequest())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ ok: false })
  })

  it('still creates the account and signs the invitee in on the happy path', async () => {
    mockAcceptInvitation.mockResolvedValue({
      user: {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'new@example.com',
        displayName: 'New User',
        tenantId: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
      },
      invitation: { id: 'inv-1' },
    })

    const res = await POST(acceptRequest())
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ ok: true, user: { email: 'new@example.com' } })
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })
})
