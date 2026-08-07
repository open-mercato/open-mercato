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

function makeConfirmRequest(): Request {
  const body = new URLSearchParams()
  body.set('token', 'reset-token-1')
  body.set('password', 'Str0ng-Passw0rd!')
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
      email: 'staff@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      at: expect.any(String),
    }, { persistent: true })
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
    expect(body).toEqual({ ok: true, redirect: '/login' })
  })
})
