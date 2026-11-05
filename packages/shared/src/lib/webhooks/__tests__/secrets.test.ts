import { generateWebhookSecret, parseWebhookSecret, isValidWebhookSecret } from '../secrets'

describe('generateWebhookSecret', () => {
  it('generates whsec_ prefixed secrets', () => {
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^whsec_.+$/)
  })

  it('generates unique secrets', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateWebhookSecret()))
    expect(secrets.size).toBe(100)
  })
})

describe('parseWebhookSecret', () => {
  it('strips whsec_ prefix and decodes base64', () => {
    const secret = generateWebhookSecret()
    const parsed = parseWebhookSecret(secret)
    expect(parsed).toBeInstanceOf(Buffer)
    expect(parsed.length).toBeGreaterThanOrEqual(24)
  })

  it('handles raw base64 without prefix', () => {
    const raw = Buffer.from('test-secret-key-1234567').toString('base64')
    const parsed = parseWebhookSecret(raw)
    expect(parsed.toString()).toBe('test-secret-key-1234567')
  })
})

describe('isValidWebhookSecret', () => {
  it('validates correct secrets', () => {
    const secret = generateWebhookSecret()
    expect(isValidWebhookSecret(secret)).toBe(true)
  })

  it('rejects secrets without prefix', () => {
    expect(isValidWebhookSecret('not_a_secret')).toBe(false)
  })

  it('rejects empty base64 part', () => {
    expect(isValidWebhookSecret('whsec_')).toBe(false)
  })
})
