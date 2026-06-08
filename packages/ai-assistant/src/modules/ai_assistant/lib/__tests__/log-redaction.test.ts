import { createHash } from 'node:crypto'
import { redactSecretForLog, deriveApiKeySessionId } from '../log-redaction'

describe('redactSecretForLog', () => {
  it('never emits the full session token', () => {
    const token = `sess_${'a'.repeat(32)}`
    const redacted = redactSecretForLog(token)
    expect(redacted).not.toBe(token)
    expect(redacted).not.toContain(token)
    expect(token.startsWith(redacted.replace(/\.\.\.$/, ''))).toBe(true)
  })

  it('reveals at most a short leading fingerprint and never more than half', () => {
    const token = `sess_${'b'.repeat(32)}`
    const redacted = redactSecretForLog(token)
    const visible = redacted.replace(/\.\.\.$/, '')
    expect(redacted.endsWith('...')).toBe(true)
    expect(visible.length).toBeLessThanOrEqual(12)
    expect(visible.length).toBeLessThanOrEqual(Math.floor(token.length / 2))
    expect(token.startsWith(visible)).toBe(true)
  })

  it('does not leak short values', () => {
    expect(redactSecretForLog('abcd')).toBe('ab...')
  })

  it('returns a placeholder for empty or non-string input', () => {
    expect(redactSecretForLog('')).toBe('<redacted>')
    expect(redactSecretForLog(undefined)).toBe('<redacted>')
    expect(redactSecretForLog(null)).toBe('<redacted>')
    expect(redactSecretForLog(12345)).toBe('<redacted>')
  })
})

describe('deriveApiKeySessionId', () => {
  it('does not embed any slice of the secret', () => {
    const secret = 'omk_publicprefix_secretbodythatmustnotleak'
    const sessionId = deriveApiKeySessionId(secret)
    expect(sessionId.startsWith('apikey_')).toBe(true)
    expect(sessionId).not.toContain(secret.slice(0, 16))
    expect(sessionId).not.toContain('secretbody')
    const digestPart = sessionId.slice('apikey_'.length)
    expect(secret).not.toContain(digestPart)
  })

  it('is a stable truncated sha-256 digest of the secret', () => {
    const secret = 'omk_test_secret_value'
    const expected = `apikey_${createHash('sha256').update(secret).digest('hex').slice(0, 16)}`
    expect(deriveApiKeySessionId(secret)).toBe(expected)
    expect(deriveApiKeySessionId(secret)).toBe(deriveApiKeySessionId(secret))
  })

  it('maps distinct secrets to distinct ids', () => {
    expect(deriveApiKeySessionId('secret-one')).not.toBe(deriveApiKeySessionId('secret-two'))
  })
})
