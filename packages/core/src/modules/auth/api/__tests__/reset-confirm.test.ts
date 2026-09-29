/** @jest-environment node */
const mockConfirmPasswordReset = jest.fn()
const mockCheckAuthRateLimit = jest.fn()
const mockEmitAuthEvent = jest.fn(async (_eventId: string, _payload: Record<string, unknown>, _options?: Record<string, unknown>) => undefined)
const mockNotificationCreate = jest.fn(async () => undefined)

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'authService') {
      return { confirmPasswordReset: mockConfirmPasswordReset }
    }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(() => ({ create: mockNotificationCreate })),
}))

jest.mock('@open-mercato/core/modules/auth/notifications', () => ({
  __esModule: true,
  default: [],
}))

jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: jest.fn((args: unknown) => mockCheckAuthRateLimit(args)),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/config', () => ({
  readEndpointRateLimitConfig: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  rateLimitErrorSchema: {},
}))

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: (eventId: string, payload: Record<string, unknown>, options?: Record<string, unknown>) =>
    mockEmitAuthEvent(eventId, payload, options),
}))

import { POST } from '@open-mercato/core/modules/auth/api/reset/confirm'

function makeConfirmRequest(extraFields: Record<string, string> = {}): Request {
  const body = new URLSearchParams()
  body.set('token', 'reset-token-1')
  body.set('password', 'Str0ng-Passw0rd!')
  for (const [key, value] of Object.entries(extraFields)) body.set(key, value)
  return new Request('https://app.example.com/api/auth/reset/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

describe('POST /api/auth/reset/confirm — auth.password.reset.completed event', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null })
    mockConfirmPasswordReset.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  test('emits the event after the password has been replaced', async () => {
    const res = await POST(makeConfirmRequest())

    expect(res.status).toBe(200)
    expect(mockEmitAuthEvent).toHaveBeenCalledWith('auth.password.reset.completed', {
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      at: expect.any(String),
    }, { persistent: true })
  })

  test('identifies the user by id only, keeping the email out of the durable payload', async () => {
    await POST(makeConfirmRequest())

    expect(mockEmitAuthEvent).toHaveBeenCalledTimes(1)
    const payload = mockEmitAuthEvent.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('email')
    expect(JSON.stringify(payload)).not.toContain('staff@example.com')
  })

  test('does not emit when the token is invalid or expired', async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce(null)

    const res = await POST(makeConfirmRequest())

    expect(res.status).toBe(400)
    expect(mockEmitAuthEvent).not.toHaveBeenCalled()
  })

  test('completes the reset even when the event bus rejects', async () => {
    mockEmitAuthEvent.mockRejectedValueOnce(new Error('event bus down'))

    const res = await POST(makeConfirmRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, redirect: '/login?tenant=tenant-1' })
  })
})

describe('POST /api/auth/reset/confirm — tenant continuity in the success redirect', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null })
    mockConfirmPasswordReset.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  test('sends a tenant-bound user back to the tenant login entry', async () => {
    const res = await POST(makeConfirmRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, redirect: '/login?tenant=tenant-1' })
  })

  test('leaves a tenantless user on the generic login page', async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce({
      id: 'user-1',
      email: 'staff@example.com',
      tenantId: null,
      organizationId: null,
    })

    const res = await POST(makeConfirmRequest())

    expect(await res.json()).toEqual({ ok: true, redirect: '/login' })
  })

  test('encodes a tenant id that would otherwise alter the redirect', async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce({
      id: 'user-1',
      email: 'staff@example.com',
      tenantId: 'a&b=c',
      organizationId: 'org-1',
    })

    const res = await POST(makeConfirmRequest())
    const { redirect } = await res.json() as { redirect: string }

    const parsed = new URL(redirect, 'https://app.example.com')
    expect(parsed.pathname).toBe('/login')
    expect([...parsed.searchParams.keys()]).toEqual(['tenant'])
    expect(parsed.searchParams.get('tenant')).toBe('a&b=c')
  })

  test('ignores a tenant supplied by the caller and uses the resolved user instead', async () => {
    const res = await POST(makeConfirmRequest({ tenant: 'forged-tenant' }))
    const body = await res.json() as { redirect: string }

    expect(body.redirect).toBe('/login?tenant=tenant-1')
    expect(body.redirect).not.toContain('forged-tenant')
  })

  test('returns no redirect at all for an invalid or expired token', async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce(null)

    const res = await POST(makeConfirmRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({ ok: false, error: 'Invalid or expired token' })
  })
})
