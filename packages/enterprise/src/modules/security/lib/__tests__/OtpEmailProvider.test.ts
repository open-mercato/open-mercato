import { OtpEmailProvider } from '../providers/OtpEmailProvider'

describe('OtpEmailProvider', () => {
  const originalTestMode = process.env.OM_TEST_MODE

  beforeEach(() => {
    process.env.OM_TEST_MODE = 'true'
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

    const valid = await provider.verify('user-1', method, { code })
    const invalid = await provider.verify('user-1', method, { code: '000000' })

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })
})
