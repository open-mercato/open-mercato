import { OtpEmailProvider } from '../providers/OtpEmailProvider'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { defaultSecurityModuleConfig } from '../security-config'

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}))

const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>

describe('OtpEmailProvider', () => {
  const originalTestMode = process.env.OM_TEST_MODE

  beforeEach(() => {
    process.env.OM_TEST_MODE = 'true'
    mockedSendEmail.mockClear()
  })

  afterEach(() => {
    if (originalTestMode === undefined) {
      delete process.env.OM_TEST_MODE
      return
    }
    process.env.OM_TEST_MODE = originalTestMode
  })

  test('creates setup and confirms metadata', async () => {
    const provider = new OtpEmailProvider()
    const setup = await provider.setup('user-1', { email: 'user@example.com', label: 'Work email' })

    const confirmation = await provider.confirmSetup('user-1', setup.setupId, {})
    expect(confirmation.metadata.email).toBe('user@example.com')
    expect(confirmation.metadata.label).toBe('Work email')
  })

  test('prepares and verifies OTP code challenge', async () => {
    const provider = new OtpEmailProvider()
    const method = {
      id: 'method-1',
      userId: 'user-1',
      type: 'otp_email',
      providerMetadata: {
        email: 'user@example.com',
      },
    }

    const prepared = await provider.prepareChallenge('user-1', method)
    const code = prepared.clientData?.code
    expect(typeof code).toBe('string')
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Your Open Mercato verification code',
    }))

    const valid = await provider.verify('user-1', method, { code })
    const invalid = await provider.verify('user-1', method, { code: '000000' })

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })

  test('verifies OTP code using persisted verify context across provider instances', async () => {
    const preparingProvider = new OtpEmailProvider()
    const verifyingProvider = new OtpEmailProvider()
    const method = {
      id: 'method-1',
      userId: 'user-1',
      type: 'otp_email',
      providerMetadata: {
        email: 'user@example.com',
      },
    }

    const prepared = await preparingProvider.prepareChallenge('user-1', method)
    const code = prepared.clientData?.code
    expect(typeof code).toBe('string')

    const valid = await verifyingProvider.verify(
      'user-1',
      method,
      { code },
      prepared.verifyContext,
    )
    expect(valid).toBe(true)
  })

  test('fails challenge preparation when destination email is missing', async () => {
    const provider = new OtpEmailProvider()
    const method = {
      id: 'method-1',
      userId: 'user-1',
      type: 'otp_email',
      providerMetadata: {},
    }

    await expect(provider.prepareChallenge('user-1', method)).rejects.toThrow(
      'Email OTP method is missing a destination email address',
    )
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  test('uses the configured subject for OTP emails', async () => {
    const provider = new OtpEmailProvider({
      ...defaultSecurityModuleConfig,
      otpEmail: {
        ...defaultSecurityModuleConfig.otpEmail,
        subject: 'Acme verification code',
      },
    })
    const method = {
      id: 'method-1',
      userId: 'user-1',
      type: 'otp_email',
      providerMetadata: {
        email: 'user@example.com',
      },
    }

    await provider.prepareChallenge('user-1', method)

    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Acme verification code',
    }))
  })
})
