/** @jest-environment node */

import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { PUT } from '../route'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const USER_ID = '123e4567-e89b-12d3-a456-426614174010'

const mockGetAuthFromRequest = jest.fn()
const mockCommandBusExecute = jest.fn()
const mockVerifyPassword = jest.fn()
const mockFindUser = jest.fn()

const mockEm = { find: jest.fn(), findOne: jest.fn() }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'commandBus') return { execute: (...args: unknown[]) => mockCommandBusExecute(...args) }
    if (token === 'authService') return { verifyPassword: mockVerifyPassword }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: () => mockFindUser(),
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

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  signJwt: jest.fn(() => 'signed-token'),
}))

function updateRequest(
  currentPassword: string | null = 'current-password',
  changes: { email?: string; password?: string } = { email: 'ada@example.com' },
): Request {
  return new Request('http://localhost/api/auth/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...changes, ...(currentPassword === null ? {} : { currentPassword }) }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    roles: ['admin'],
  })
  mockVerifyPassword.mockResolvedValue(true)
  mockFindUser.mockResolvedValue({ id: USER_ID, email: 'previous@example.com', passwordHash: 'existing-hash' })
  mockCommandBusExecute.mockResolvedValue({
    result: { id: USER_ID, email: 'ada@example.com', tenantId: TENANT_ID, organizationId: ORG_ID },
  })
})

describe('PUT /api/auth/profile command interceptor rejections', () => {
  it('does not exchange a restricted API key for the creator session or mutate credentials', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'api_key:key', isApiKey: true, userId: USER_ID,
      tenantId: TENANT_ID, orgId: ORG_ID, roles: ['restricted-key'],
    })
    const response = await PUT(updateRequest())
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
    expect(signJwt).not.toHaveBeenCalled()
  })
  it('ends the browser session after a successful email change', async () => {
    const response = await PUT(updateRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, email: 'ada@example.com' })
    expect(mockVerifyPassword).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), 'current-password')
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^auth_token=;.*Max-Age=0/),
      expect.stringMatching(/^session_token=;.*Max-Age=0/),
    ])
    expect(signJwt).not.toHaveBeenCalled()
  })

  it('ends the browser session after a successful password-only change', async () => {
    mockCommandBusExecute.mockResolvedValueOnce({
      result: { id: USER_ID, email: 'previous@example.com', tenantId: TENANT_ID, organizationId: ORG_ID },
    })
    const response = await PUT(updateRequest(' current-password ', { password: ' Changed2@Secure ' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, email: 'previous@example.com' })
    expect(mockVerifyPassword).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), ' current-password ')
    expect(mockCommandBusExecute).toHaveBeenCalledWith(
      'auth.users.update',
      expect.objectContaining({ input: { id: USER_ID, email: undefined, password: ' Changed2@Secure ' } }),
    )
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^auth_token=;.*Max-Age=0/),
      expect.stringMatching(/^session_token=;.*Max-Age=0/),
    ])
    expect(signJwt).not.toHaveBeenCalled()
  })

  it('requires the current password for an email-only change', async () => {
    const response = await PUT(updateRequest(null))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      issues: [{ path: ['currentPassword'], message: 'Current password is required.' }],
    })
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('rejects an email-only change with the wrong current password', async () => {
    mockVerifyPassword.mockResolvedValueOnce(false)
    const response = await PUT(updateRequest('wrong-password'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      issues: [{ path: ['currentPassword'], message: 'Current password is incorrect.' }],
    })
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('surfaces the status and body of an interceptor rejection that carries one', async () => {
    mockCommandBusExecute.mockRejectedValueOnce(
      new CommandInterceptorError('Email changes are frozen', {
        status: 422,
        body: { error: 'Email changes are frozen', policy: 'identity-freeze' },
      }),
    )

    const response = await PUT(updateRequest())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Email changes are frozen',
      policy: 'identity-freeze',
    })
  })

  it('keeps the generic 400 when an interceptor rejection carries no status', async () => {
    mockCommandBusExecute.mockRejectedValueOnce(new CommandInterceptorError('Blocked without a status'))

    const response = await PUT(updateRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update profile.' })
  })
})
