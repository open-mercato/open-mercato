import { POST } from '@open-mercato/core/modules/auth/api/reset'

const mockRequestPasswordReset = jest.fn()
const mockSendEmail = jest.fn()
const mockCheckAuthRateLimit = jest.fn()
const mockResetPasswordEmail = jest.fn((props: { resetUrl: string }) => props)

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'authService') {
      return {
        requestPasswordReset: mockRequestPasswordReset,
      }
    }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn((args: unknown) => mockSendEmail(args)),
}))

jest.mock('@open-mercato/core/modules/auth/emails/ResetPasswordEmail', () => ({
  __esModule: true,
  default: jest.fn((props: { resetUrl: string }) => mockResetPasswordEmail(props)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(() => ({
    create: jest.fn(async () => undefined),
  })),
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

const originalEnv = process.env

function makeResetRequest(url: string) {
  const body = new URLSearchParams()
  body.set('email', 'staff@example.com')
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

describe('POST /api/auth/reset', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      APP_URL: 'https://app.example.com',
      NEXT_PUBLIC_APP_URL: undefined,
      APP_ALLOWED_ORIGINS: undefined,
    }
    mockCheckAuthRateLimit.mockResolvedValue({ error: null })
    mockRequestPasswordReset.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'staff@example.com',
        tenantId: null,
        organizationId: null,
      },
      token: 'reset-token-1',
    })
    mockSendEmail.mockResolvedValue(undefined)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('builds the reset link from APP_URL', async () => {
    const res = await POST(makeResetRequest('https://app.example.com/api/auth/reset'))

    expect(res.status).toBe(200)
    expect(mockRequestPasswordReset).toHaveBeenCalledWith('staff@example.com')
    expect(mockResetPasswordEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        resetUrl: 'https://app.example.com/reset/reset-token-1',
      }),
    )
  })

  test('rejects a poisoned host before issuing a reset token', async () => {
    const res = await POST(makeResetRequest('https://evil.example/api/auth/reset'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid request origin')
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  test('fails closed in production when APP_URL is missing', async () => {
    process.env = {
      ...process.env,
      APP_URL: undefined,
      NODE_ENV: 'production',
    }

    const res = await POST(makeResetRequest('https://app.example.com/api/auth/reset'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('Password reset is not configured')
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  test('returns success even when email delivery fails', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('RESEND_API_KEY is not set'))

    const res = await POST(makeResetRequest('https://app.example.com/api/auth/reset'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mockRequestPasswordReset).toHaveBeenCalledWith('staff@example.com')
  })
})
