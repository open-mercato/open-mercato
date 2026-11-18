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

    const confirmation = await provider.confirmSetup('user-1', setup.setupId, { code: setup.clientData.code })
    expect(confirmation.metadata.email).toBe('user@example.com')
    expect(confirmation.metadata.label).toBe('Work email')
  })

  test('prepares and verifies OTP code challenge', async () => {
    const provider = new OtpEmailProvider()
    const method = {
      id: 'method-1',
      userId: 'user-1',
      type: 'otp_email',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
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
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
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

describe('Email OTP enrollment possession proof', () => {
  beforeEach(() => { process.env.OM_TEST_MODE = 'true'; mockedSendEmail.mockClear() })
  afterEach(() => { delete process.env.OM_TEST_MODE; jest.restoreAllMocks() })

  test('sends a setup code and rejects missing or incorrect code', async () => {
    const provider = new OtpEmailProvider()
    const setup = await provider.setup('owner', { email: 'owner@example.com' })
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com' }))
    await expect(provider.confirmSetup('owner', setup.setupId, {})).rejects.toThrow()
    const wrongCode = setup.clientData.code === '000000' ? '111111' : '000000'
    await expect(provider.confirmSetup('owner', setup.setupId, { code: wrongCode })).rejects.toMatchObject({ issues: expect.any(Array) })
    await expect(provider.confirmSetup('owner', setup.setupId, { code: setup.clientData.code })).resolves.toMatchObject({ metadata: { email: 'owner@example.com' } })
  })

  test('ignores confirmation email replacement and rejects replay or different user', async () => {
    const provider = new OtpEmailProvider()
    const setup = await provider.setup('owner', { email: 'owner@example.com' })
    const payload = { code: setup.clientData.code, email: 'attacker@example.com' }
    await expect(provider.confirmSetup('attacker', setup.setupId, payload)).rejects.toThrow()
    await expect(provider.confirmSetup('owner', setup.setupId, payload)).resolves.toMatchObject({ metadata: { email: 'owner@example.com' } })
    await expect(provider.confirmSetup('owner', setup.setupId, payload)).rejects.toThrow()
  })

  test('expires setup and caps incorrect attempts', async () => {
    const provider = new OtpEmailProvider()
    const setup = await provider.setup('owner', { email: 'owner@example.com' })
    const wrongCode = setup.clientData.code === '000000' ? '111111' : '000000'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(provider.confirmSetup('owner', setup.setupId, { code: wrongCode })).rejects.toMatchObject({ issues: expect.any(Array) })
    }
    await expect(provider.confirmSetup('owner', setup.setupId, { code: setup.clientData.code })).rejects.toThrow()
    const next = await provider.setup('owner', { email: 'owner@example.com' })
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + defaultSecurityModuleConfig.otpEmail.setupTtlMs + 1)
    await expect(provider.confirmSetup('owner', next.setupId, { code: next.clientData.code })).rejects.toThrow('expired')
  })

  test('concurrent confirmation produces at most one successful result', async () => {
    const provider = new OtpEmailProvider()
    const setup = await provider.setup('owner', { email: 'owner@example.com' })
    const results = await Promise.allSettled([
      provider.confirmSetup('owner', setup.setupId, { code: setup.clientData.code }),
      provider.confirmSetup('owner', setup.setupId, { code: setup.clientData.code }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  test('never returns the code outside explicit test mode', async () => {
    delete process.env.OM_TEST_MODE
    const provider = new OtpEmailProvider()
    const setup = await provider.setup('owner', { email: 'owner@example.com' })
    expect(setup.clientData).not.toHaveProperty('code')
  })
})
