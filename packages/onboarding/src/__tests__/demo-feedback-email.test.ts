const sendEmailMock = jest.fn()
const checkAuthRateLimitMock = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn((args: unknown) => sendEmailMock(args)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: jest.fn((args: unknown) => checkAuthRateLimitMock(args)),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/config', () => ({
  readEndpointRateLimitConfig: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/emails/FeedbackEmail', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { POST } from '../modules/onboarding/api/demo-feedback/route'

const createRequestContainerMock = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>

function makeRequest(sendCopy?: boolean) {
  return new Request('http://localhost/api/onboarding/demo-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'unverified@example.com',
      message: 'Please contact me.',
      termsAccepted: true,
      marketingConsent: false,
      ...(sendCopy === undefined ? {} : { sendCopy }),
    }),
  })
}

describe('POST /api/onboarding/demo-feedback', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, ADMIN_EMAIL: 'admin@example.com' }
    checkAuthRateLimitMock.mockResolvedValue({ error: null })
    sendEmailMock.mockResolvedValue(undefined)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it.each([
    ['when sendCopy is omitted', undefined],
    ['when sendCopy is explicitly requested', true],
  ])('sends feedback only to the configured admin %s', async (_label, sendCopy) => {
    const response = await POST(makeRequest(sendCopy))

    expect(response.status).toBe(200)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.com' }))
    expect(sendEmailMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'unverified@example.com' }),
    )
  })

  it('builds the request container before sending, so the email transport is registered', async () => {
    // The route discards the container; its only purpose is running the DI registration that calls
    // `registerEmailTransport`. Deleting that line would otherwise leave this suite green while
    // every demo-feedback send failed with `EMAIL_TRANSPORT_NOT_CONFIGURED` in production.
    let containerBuiltBeforeSend = false
    createRequestContainerMock.mockImplementation(async () => ({}) as never)
    sendEmailMock.mockImplementation(async () => {
      containerBuiltBeforeSend = createRequestContainerMock.mock.calls.length > 0
    })

    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(createRequestContainerMock).toHaveBeenCalled()
    expect(containerBuiltBeforeSend).toBe(true)
  })
})
