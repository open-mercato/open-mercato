/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const USER_ID = '123e4567-e89b-12d3-a456-426614174010'
const LOADED_AT = new Date('2026-07-01T10:00:00.000Z')
const SAVED_AT = new Date('2026-07-01T10:05:00.000Z')

const mockGetAuthFromRequest = jest.fn()
const mockCommandBusExecute = jest.fn()
let mockStoredUser: Record<string, unknown> | null = null

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return { find: jest.fn(), findOne: jest.fn(async () => mockStoredUser) }
    if (token === 'commandBus') return { execute: (...args: unknown[]) => mockCommandBusExecute(...args) }
    if (token === 'authService') return { getUserRoles: jest.fn(async () => ['employee']), verifyPassword: jest.fn() }
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
    translate: (key: string, fallback: string) => (key === 'auth.profile.errors.timeZone' ? 'Choose a time zone from the list.' : fallback),
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  signJwt: jest.fn(() => 'signed-token'),
}))

function put(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredUser = { id: USER_ID, email: 'ada@example.com', tenantId: TENANT_ID, organizationId: ORG_ID, timezone: null, updatedAt: LOADED_AT }
  mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, roles: ['employee'] })
  mockCommandBusExecute.mockImplementation(async (_id: string, { input }: { input: Record<string, unknown> }) => ({
    result: { id: USER_ID, email: 'ada@example.com', tenantId: TENANT_ID, organizationId: ORG_ID, timezone: input.timezone ?? null, updatedAt: SAVED_AT },
  }))
})

describe('PUT /api/auth/profile time zone', () => {
  it('accepts a time zone on its own and canonicalizes it', async () => {
    const response = await PUT(put({ timezone: 'europe/warsaw' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      email: 'ada@example.com',
      timezone: 'Europe/Warsaw',
      updatedAt: SAVED_AT.toISOString(),
    })
    expect(mockCommandBusExecute).toHaveBeenCalledWith(
      'auth.users.update',
      expect.objectContaining({ input: { id: USER_ID, email: undefined, password: undefined, timezone: 'Europe/Warsaw' } }),
    )
  })

  it('clears the time zone back to the organization default with null', async () => {
    const response = await PUT(put({ timezone: null }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ timezone: null })
    expect(mockCommandBusExecute.mock.calls[0][1].input).toHaveProperty('timezone', null)
  })

  it('rejects an unknown time zone without running the command', async () => {
    const response = await PUT(put({ timezone: 'Mars/Olympus' }))

    expect(response.status).toBe(400)
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.issues).toEqual([expect.objectContaining({ path: ['timezone'], message: 'Choose a time zone from the list.' })])
  })

  it('saves a time zone without renewing the session cookie', async () => {
    const response = await PUT(put({ timezone: 'Asia/Tokyo' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('still renews the session cookie when the email changes', async () => {
    const response = await PUT(put({ email: 'ada@example.com', timezone: 'Asia/Tokyo' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('auth_token=signed-token')
  })

  it('does not send a time zone to the command when the request omits it', async () => {
    await PUT(put({ email: 'ada@example.com' }))

    expect(mockCommandBusExecute.mock.calls[0][1].input).not.toHaveProperty('timezone')
  })

  it('still requires at least one field', async () => {
    const response = await PUT(put({}))
    expect(response.status).toBe(400)
  })

  it('saves when the expected version matches the stored one', async () => {
    const response = await PUT(put({ timezone: 'Asia/Tokyo' }, { [OPTIMISTIC_LOCK_HEADER_NAME]: LOADED_AT.toISOString() }))

    expect(response.status).toBe(200)
    expect(mockCommandBusExecute).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale save from another tab with 409 without running the command', async () => {
    mockStoredUser = { ...mockStoredUser, timezone: 'Europe/Warsaw', updatedAt: SAVED_AT }

    const response = await PUT(put({ timezone: 'Asia/Tokyo' }, { [OPTIMISTIC_LOCK_HEADER_NAME]: LOADED_AT.toISOString() }))

    expect(response.status).toBe(409)
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })
})
