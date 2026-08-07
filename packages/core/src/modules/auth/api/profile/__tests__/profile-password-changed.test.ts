/** @jest-environment node */

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const USER_ID = '123e4567-e89b-12d3-a456-426614174010'

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockVerifyPassword = jest.fn()
const mockGetUserRoles = jest.fn()
const mockCommandExecute = jest.fn()
const mockEmitAuthEvent = jest.fn(async (_eventId: string, _payload: Record<string, unknown>) => undefined)

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return { find: jest.fn(), findOne: jest.fn() }
    if (token === 'authService') {
      return { verifyPassword: mockVerifyPassword, getUserRoles: mockGetUserRoles }
    }
    if (token === 'commandBus') return { execute: mockCommandExecute }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  signJwt: jest.fn(() => 'signed-jwt'),
}))

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: (eventId: string, payload: Record<string, unknown>) => mockEmitAuthEvent(eventId, payload),
}))

import { PUT } from '../route'

function profileUpdateRequest(body: Record<string, string>): Request {
  return new Request('http://localhost/api/auth/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    sid: 'session-1',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    roles: ['admin'],
  })
  mockFindOneWithDecryption.mockResolvedValue({ id: USER_ID, email: 'ada@example.com' })
  mockVerifyPassword.mockResolvedValue(true)
  mockGetUserRoles.mockResolvedValue(['admin'])
  mockCommandExecute.mockResolvedValue({
    result: {
      id: USER_ID,
      email: 'ada@example.com',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    },
  })
})

describe('PUT /api/auth/profile — auth.password.changed event', () => {
  it('emits after a self-service password change', async () => {
    const res = await PUT(profileUpdateRequest({
      currentPassword: 'Old-Passw0rd!',
      password: 'New-Passw0rd!',
    }))

    expect(res.status).toBe(200)
    expect(mockEmitAuthEvent).toHaveBeenCalledWith('auth.password.changed', {
      id: USER_ID,
      email: 'ada@example.com',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      changedBy: 'self',
    })
  })

  it('does not emit when only the email changes', async () => {
    await PUT(profileUpdateRequest({ email: 'ada.new@example.com' }))

    expect(mockEmitAuthEvent).not.toHaveBeenCalled()
  })

  it('does not emit when the current password is wrong', async () => {
    mockVerifyPassword.mockResolvedValueOnce(false)

    const res = await PUT(profileUpdateRequest({
      currentPassword: 'wrong',
      password: 'New-Passw0rd!',
    }))

    expect(res.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
    expect(mockEmitAuthEvent).not.toHaveBeenCalled()
  })

  it('still saves the new password when the event bus rejects', async () => {
    mockEmitAuthEvent.mockRejectedValueOnce(new Error('event bus down'))

    const res = await PUT(profileUpdateRequest({
      currentPassword: 'Old-Passw0rd!',
      password: 'New-Passw0rd!',
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, email: 'ada@example.com' })
  })
})
