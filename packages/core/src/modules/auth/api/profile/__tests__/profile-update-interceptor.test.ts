/** @jest-environment node */

import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const USER_ID = '123e4567-e89b-12d3-a456-426614174010'

const mockGetAuthFromRequest = jest.fn()
const mockCommandBusExecute = jest.fn()
const mockGetUserRoles = jest.fn()

const mockEm = { find: jest.fn(), findOne: jest.fn() }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'commandBus') return { execute: (...args: unknown[]) => mockCommandBusExecute(...args) }
    if (token === 'authService') return { getUserRoles: mockGetUserRoles, verifyPassword: jest.fn() }
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

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  signJwt: jest.fn(() => 'signed-token'),
}))

function updateRequest(): Request {
  return new Request('http://localhost/api/auth/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ada@example.com' }),
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
  mockGetUserRoles.mockResolvedValue(['admin'])
  mockCommandBusExecute.mockResolvedValue({
    result: { id: USER_ID, email: 'ada@example.com', tenantId: TENANT_ID, organizationId: ORG_ID },
  })
})

describe('PUT /api/auth/profile command interceptor rejections', () => {
  it('updates the profile when nothing blocks the command', async () => {
    const response = await PUT(updateRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, email: 'ada@example.com' })
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
