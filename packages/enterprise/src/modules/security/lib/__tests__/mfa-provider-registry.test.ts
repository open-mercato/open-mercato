import { MfaProviderRegistry } from '../mfa-provider-registry'
import { TotpProvider } from '../providers/TotpProvider'
import { PasskeyProvider } from '../providers/PasskeyProvider'
import { OtpEmailProvider } from '../providers/OtpEmailProvider'

describe('MfaProviderRegistry', () => {
  test('registers built-in providers and resolves them by type', () => {
    const registry = new MfaProviderRegistry()
    registry.register(new TotpProvider())
    registry.register(new PasskeyProvider())
    registry.register(new OtpEmailProvider())

    expect(registry.get('totp')?.label).toBe('Authenticator App')
    expect(registry.get('passkey')?.label).toBe('Passkey')
    expect(registry.get('otp_email')?.label).toBe('Email OTP')
  })

  test('prevents duplicate provider types', () => {
    const registry = new MfaProviderRegistry()
    registry.register(new TotpProvider())

    expect(() => registry.register(new TotpProvider())).toThrow("MFA provider 'totp' is already registered")
  })

  test('filters providers by allowed method list', () => {
    const registry = new MfaProviderRegistry()
    registry.register(new TotpProvider())
    registry.register(new PasskeyProvider())
    registry.register(new OtpEmailProvider())

    const available = registry.listAvailable(['passkey', 'otp_email'])
    expect(available.map((provider) => provider.type).sort()).toEqual(['otp_email', 'passkey'])
  })
})
