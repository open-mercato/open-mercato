import { OnboardingRequest } from '../modules/onboarding/data/entities'

const sendEmailMock = jest.fn().mockResolvedValue(undefined)
const findByIdMock = jest.fn()
const markReadyEmailSentMock = jest.fn().mockResolvedValue(undefined)
const workspaceReadyEmailMock = jest.fn().mockReturnValue(null)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn().mockResolvedValue({
    resolve: () => ({}),
  }),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createFallbackTranslator: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    findById: (...args: unknown[]) => findByIdMock(...args),
    markReadyEmailSent: (...args: unknown[]) => markReadyEmailSentMock(...args),
  })),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/emails/WorkspaceReadyEmail', () => ({
  __esModule: true,
  default: (props: { loginUrl: string }) => workspaceReadyEmailMock(props),
}))

import { sendWorkspaceReadyEmail } from '../modules/onboarding/lib/ready-email'

function makeReadyRequest(overrides: Record<string, unknown> = {}) {
  return Object.assign(new OnboardingRequest(), {
    id: 'req-1',
    email: 'owner@example.com',
    status: 'completed',
    firstName: 'Jane',
    lastName: 'Doe',
    organizationName: 'Acme Corp',
    locale: 'en',
    tenantId: 'tenant-uuid',
    readyEmailSentAt: null,
    ...overrides,
  })
}

describe('sendWorkspaceReadyEmail', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_URL
    delete process.env.APP_ALLOWED_ORIGINS
    process.env.NODE_ENV = 'test'
    findByIdMock.mockResolvedValue(makeReadyRequest())
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('builds the login link from the configured APP_URL, not a request header', async () => {
    process.env.APP_URL = 'https://app.openmercato.com'

    const sent = await sendWorkspaceReadyEmail({ requestId: 'req-1', tenantId: 'tenant-uuid' })

    expect(sent).toBe(true)
    expect(workspaceReadyEmailMock).toHaveBeenCalledTimes(1)
    const props = workspaceReadyEmailMock.mock.calls[0][0]
    expect(props.loginUrl).toBe('https://app.openmercato.com/login?tenant=tenant-uuid')
    expect(props.loginUrl).not.toContain('evil.com')
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(markReadyEmailSentMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the dev origin outside production when APP_URL is unset', async () => {
    const sent = await sendWorkspaceReadyEmail({ requestId: 'req-1', tenantId: 'tenant-uuid' })

    expect(sent).toBe(true)
    const props = workspaceReadyEmailMock.mock.calls[0][0]
    expect(props.loginUrl).toBe('http://localhost:3000/login?tenant=tenant-uuid')
  })

  it('throws in production when APP_URL is not configured instead of trusting a host', async () => {
    process.env.NODE_ENV = 'production'

    await expect(
      sendWorkspaceReadyEmail({ requestId: 'req-1', tenantId: 'tenant-uuid' }),
    ).rejects.toThrow(/APP_URL/)

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(markReadyEmailSentMock).not.toHaveBeenCalled()
  })

  it('skips when the request is missing or already notified', async () => {
    findByIdMock.mockResolvedValueOnce(null)
    expect(await sendWorkspaceReadyEmail({ requestId: 'req-1', tenantId: 'tenant-uuid' })).toBe(false)

    findByIdMock.mockResolvedValueOnce(makeReadyRequest({ readyEmailSentAt: new Date() }))
    expect(await sendWorkspaceReadyEmail({ requestId: 'req-1', tenantId: 'tenant-uuid' })).toBe(false)

    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
