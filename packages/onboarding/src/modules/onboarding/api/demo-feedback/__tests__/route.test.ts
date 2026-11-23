const mockSendEmail = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockCheckAuthRateLimit = jest.fn()
const mockFeedbackEmail = jest.fn()
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
mockLogger.child.mockReturnValue(mockLogger)

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => mockLogger),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))
jest.mock('@open-mercato/onboarding/modules/onboarding/emails/FeedbackEmail', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFeedbackEmail(...args),
}))

const feedbackRequest = () => new Request('http://localhost/api/onboarding/demo-feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'qa@example.test',
    message: 'QA feedback',
    termsAccepted: true,
    marketingConsent: false,
  }),
})

describe('POST /api/onboarding/demo-feedback', () => {
  const originalDemoMode = process.env.DEMO_MODE
  const originalAdminEmail = process.env.ADMIN_EMAIL

  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null })
    mockCreateRequestContainer.mockResolvedValue({})
    process.env.DEMO_MODE = 'true'
    delete process.env.ADMIN_EMAIL
  })

  afterAll(() => {
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE
    else process.env.DEMO_MODE = originalDemoMode
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = originalAdminEmail
  })

  it('returns 404 before rate limiting when demo mode is disabled', async () => {
    process.env.DEMO_MODE = 'false'
    const { POST } = await import('../route')

    const response = await POST(feedbackRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Feedback is unavailable because demo mode is disabled.',
    })
    expect(mockCheckAuthRateLimit).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('skips the operator email and warns once when ADMIN_EMAIL is unset', async () => {
    const { POST } = await import('../route')

    const response = await POST(feedbackRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('sends the notification to the configured ADMIN_EMAIL', async () => {
    process.env.ADMIN_EMAIL = 'qa-operator@example.test'
    const { POST } = await import('../route')

    const response = await POST(feedbackRequest())

    expect(response.status).toBe(200)
    expect(mockCreateRequestContainer).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'qa-operator@example.test' }))
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
