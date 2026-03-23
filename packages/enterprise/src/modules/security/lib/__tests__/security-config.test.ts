import {
  defaultSecurityModuleConfig,
  readSecurityModuleConfig,
  readSecuritySetupTokenSecret,
  resolveSecurityModuleConfigForRequest,
} from '../security-config'

describe('security-config', () => {
  test('reads security env overrides and derives WebAuthn defaults from APP_URL', () => {
    const config = readSecurityModuleConfig({
      APP_URL: 'https://mercato.example.com/app',
      OM_SECURITY_TOTP_ISSUER: 'Acme Mercato',
      OM_SECURITY_TOTP_WINDOW: '2',
      OM_SECURITY_OTP_EXPIRY_SECONDS: '120',
      OM_SECURITY_OTP_MAX_ATTEMPTS: '7',
      OM_SECURITY_SUDO_DEFAULT_TTL: '900',
      OM_SECURITY_SUDO_MAX_TTL: '1200',
      OM_SECURITY_RECOVERY_CODE_COUNT: '12',
      OM_SECURITY_MFA_EMERGENCY_BYPASS: 'true',
    })

    expect(config.totp.issuer).toBe('Acme Mercato')
    expect(config.totp.window).toBe(2)
    expect(config.otpEmail.expirySeconds).toBe(120)
    expect(config.otpEmail.challengeTtlMs).toBe(120_000)
    expect(config.mfa.maxAttempts).toBe(7)
    expect(config.mfa.emergencyBypass).toBe(true)
    expect(config.sudo.defaultTtlSeconds).toBe(900)
    expect(config.sudo.maxTtlSeconds).toBe(1200)
    expect(config.recoveryCodes.count).toBe(12)
    expect(config.webauthn.rpId).toBe('mercato.example.com')
    expect(config.webauthn.expectedOrigins).toEqual(['https://mercato.example.com/app'])
  })

  test('supports the legacy recovery code env alias and clamps sudo default ttl to max', () => {
    const config = readSecurityModuleConfig({
      OM_SECURITY_RECOVERY_CODES_COUNT: '4',
      OM_SECURITY_SUDO_DEFAULT_TTL: '2400',
      OM_SECURITY_SUDO_MAX_TTL: '600',
    })

    expect(config.recoveryCodes.count).toBe(4)
    expect(config.sudo.defaultTtlSeconds).toBe(600)
  })

  test('uses the incoming request host for WebAuthn when no explicit RP ID override is configured', () => {
    const resolved = resolveSecurityModuleConfigForRequest(
      defaultSecurityModuleConfig,
      new Request('https://preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com/api/security/mfa/prepare'),
      {},
    )

    expect(resolved.webauthn.rpId).toBe('preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com')
    expect(resolved.webauthn.expectedOrigins).toEqual([
      'https://preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com',
    ])
  })

  test('keeps explicit WebAuthn RP ID and origin overrides ahead of request host', () => {
    const resolved = resolveSecurityModuleConfigForRequest(
      defaultSecurityModuleConfig,
      new Request('https://preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com/api/security/mfa/prepare'),
      {
        OM_SECURITY_WEBAUTHN_RP_ID: 'login.example.com',
        OM_SECURITY_WEBAUTHN_ORIGIN: 'https://login.example.com',
      },
    )

    expect(resolved.webauthn.rpId).toBe('login.example.com')
    expect(resolved.webauthn.expectedOrigins).toEqual(['https://login.example.com'])
  })

  test('falls back to defaults for invalid values', () => {
    const config = readSecurityModuleConfig({
      OM_SECURITY_TOTP_WINDOW: '-1',
      OM_SECURITY_OTP_EXPIRY_SECONDS: 'nope',
      OM_SECURITY_OTP_MAX_ATTEMPTS: '0',
      OM_SECURITY_MFA_EMERGENCY_BYPASS: 'maybe',
    })

    expect(config.totp.window).toBe(defaultSecurityModuleConfig.totp.window)
    expect(config.otpEmail.expirySeconds).toBe(defaultSecurityModuleConfig.otpEmail.expirySeconds)
    expect(config.mfa.maxAttempts).toBe(defaultSecurityModuleConfig.mfa.maxAttempts)
    expect(config.mfa.emergencyBypass).toBe(defaultSecurityModuleConfig.mfa.emergencyBypass)
  })

  test('reads the MFA setup token secret from the dedicated env or JWT fallbacks', () => {
    expect(readSecuritySetupTokenSecret({
      OM_SECURITY_MFA_SETUP_SECRET: 'security-secret',
      JWT_SECRET: 'jwt-secret',
    })).toBe('security-secret')

    expect(readSecuritySetupTokenSecret({
      AUTH_JWT_SECRET: 'auth-jwt-secret',
    })).toBe('auth-jwt-secret')

    expect(readSecuritySetupTokenSecret({
      AUTH_SECRET: 'auth-secret',
    })).toBe('auth-secret')

    expect(readSecuritySetupTokenSecret({
      JWT_SECRET: 'jwt-secret',
    })).toBe('jwt-secret')
  })

  test('throws when no MFA setup token signing secret is configured', () => {
    expect(() => readSecuritySetupTokenSecret({})).toThrow(
      'Security MFA setup tokens require OM_SECURITY_MFA_SETUP_SECRET, AUTH_JWT_SECRET, AUTH_SECRET, or JWT_SECRET.',
    )
  })
})
