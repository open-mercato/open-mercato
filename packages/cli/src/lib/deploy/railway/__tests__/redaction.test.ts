import {
  assertSafeVariables,
  collectSensitiveStructuredValues,
  detectCredentialValue,
  formatVariableValue,
  redactStructuredValue,
  redactText,
} from '../redaction'

describe('Railway secret redaction', () => {
  it.each([
    ['sk-testcredential0123456789'],
    ['xoxb-1234567890-abcdefghij'],
    ['ghp_abcdefghijklmnopqrstuvwxyz'],
    ['-----BEGIN PRIVATE KEY-----\nsecret'],
  ])('detects credential-like values', (value) => {
    expect(detectCredentialValue(value)).toBe(true)
  })

  it('requires an exact per-key passthrough', () => {
    expect(() => assertSafeVariables({ OPENAI_API_KEY: 'sk-testcredential0123456789' }))
      .toThrow('--allow-secret-passthrough OPENAI_API_KEY')
    expect(() => assertSafeVariables(
      { OPENAI_API_KEY: 'sk-testcredential0123456789' },
      { allowedKeys: ['OPENAI_API_KEY'] },
    )).not.toThrow()
  })

  it('redacts authorization headers and known secrets', () => {
    expect(redactText('Authorization: Bearer token-value secret-value', ['secret-value']))
      .toBe('Authorization: Bearer **** ****')
  })

  it('prints only a fingerprint for sensitive variables', () => {
    const formatted = formatVariableValue('AUTH_SECRET', 'top-secret')
    expect(formatted).toMatch(/^<redacted> \(sha256:[a-f0-9]{8}\)$/)
    expect(formatted).not.toContain('top-secret')
  })

  it('redacts structured values by sensitive field name', () => {
    expect(redactStructuredValue({
      variables: {
        AUTH_SECRET: 'random-hex-without-a-credential-prefix',
        SAFE_VALUE: 'visible',
      },
    })).toEqual({
      variables: {
        AUTH_SECRET: '<redacted>',
        SAFE_VALUE: 'visible',
      },
    })
  })

  it('collects sensitive values for downstream log redaction', () => {
    expect(collectSensitiveStructuredValues({
      variables: {
        AUTH_SECRET: 'auth-secret',
        nested: { API_KEY: 'api-key', SAFE_VALUE: 'visible' },
      },
    })).toEqual(expect.arrayContaining(['auth-secret', 'api-key']))
  })
})
