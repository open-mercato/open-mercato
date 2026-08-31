import {
  AUDIT_REDACTED_VALUE,
  AUDIT_REDO_UNAVAILABLE_REASON,
  containsSensitiveAuditData,
  isAuditRedoUnavailable,
  isSensitiveAuditKey,
  markAuditRedoUnavailable,
  redactSensitiveAuditData,
} from '../audit-redaction'

describe('command audit redaction', () => {
  it('redacts nested secret key families without changing safe values', () => {
    const input = {
      email: 'person@example.com',
      currentPassword: 'CurrentPass1!',
      nested: {
        api_key: 'api-secret-value',
        credentials: {
          username: 'person@example.com',
          password: 'MailboxPass1!',
        },
      },
      recoveryCodes: ['one', 'two'],
    }

    const result = redactSensitiveAuditData(input)

    expect(result.redacted).toBe(true)
    expect(result.value).toEqual({
      email: 'person@example.com',
      currentPassword: AUDIT_REDACTED_VALUE,
      nested: {
        api_key: AUDIT_REDACTED_VALUE,
        credentials: AUDIT_REDACTED_VALUE,
      },
      recoveryCodes: AUDIT_REDACTED_VALUE,
    })
  })

  it('keeps one-way hashes, identifiers, expiry fields and counts', () => {
    const input = {
      passwordHash: '$2b$10$stored-verifier',
      tokenHash: 'sha256-value',
      tokenId: 'token-id',
      accessTokenExpiresAt: '2026-08-20T12:00:00.000Z',
      tokenCount: 12,
    }

    expect(redactSensitiveAuditData(input)).toEqual({ value: input, redacted: false })
    expect(isSensitiveAuditKey('password_hash')).toBe(false)
    expect(isSensitiveAuditKey('refresh_token')).toBe(true)
  })

  it('redacts secrets whose key carries a qualifier after the sensitive noun', () => {
    const input = {
      secretKey: 'abc',
      privateKeyPem: 'x',
      passwordConfirmation: 'y',
      clientSecret: 'z',
      apiKey: 'k',
      mfaSecretValue: 'm',
      tokenValue: 't',
      'x-apikey': 'q',
      oauth2Token: 'o',
      OTPCode: 'c',
    }

    const result = redactSensitiveAuditData(input)

    expect(result.redacted).toBe(true)
    expect(result.value).toEqual(Object.fromEntries(Object.keys(input).map((key) => [key, AUDIT_REDACTED_VALUE])))
  })

  it('does not treat words that merely contain a sensitive noun or derived attributes as secrets', () => {
    for (const key of ['footprint', 'secretary', 'tokenizer', 'cookieless', 'secretName', 'tokenType', 'passwordLength', 'otpEnabled', 'apiKeyIds']) {
      expect(isSensitiveAuditKey(key)).toBe(false)
    }
  })

  it('handles arrays, dotted change keys and circular values', () => {
    const circular: Record<string, unknown> = {
      changes: {
        'credentials.apiKey': { from: 'old', to: 'new' },
      },
    }
    circular.self = circular

    const result = redactSensitiveAuditData([circular])

    expect(result.redacted).toBe(true)
    const first = result.value[0] as Record<string, unknown>
    expect(first.changes).toEqual({ 'credentials.apiKey': AUDIT_REDACTED_VALUE })
    expect(first.self).toBe(first)
  })

  it('marks redo unavailable and removes the replay input', () => {
    const payload = markAuditRedoUnavailable({
      __redoInput: { password: 'Secret1!' },
      undo: { before: { id: 'user-1' } },
    })

    expect(payload).toEqual({
      undo: { before: { id: 'user-1' } },
      __redoUnavailable: AUDIT_REDO_UNAVAILABLE_REASON,
    })
    expect(isAuditRedoUnavailable(payload)).toBe(true)
    expect(containsSensitiveAuditData({ newPassword: 'Secret2!' })).toBe(true)
  })

  it('is idempotent', () => {
    const first = redactSensitiveAuditData({ password: 'Secret1!', safe: true })
    const second = redactSensitiveAuditData(first.value)

    expect(second.value).toEqual(first.value)
    expect(second.redacted).toBe(false)
  })
})
