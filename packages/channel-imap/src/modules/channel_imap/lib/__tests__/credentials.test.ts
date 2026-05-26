import { imapCredentialsSchema, imapChannelStateSchema } from '../credentials'

describe('imapCredentialsSchema', () => {
  const valid = {
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: 'tls' as const,
    imapUser: 'alice@example.com',
    imapPassword: 'secret',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpTls: 'tls' as const,
    smtpUser: 'alice@example.com',
    smtpPassword: 'secret',
    fromAddress: 'alice@example.com',
  }

  it('accepts a fully populated payload', () => {
    expect(imapCredentialsSchema.parse(valid)).toMatchObject(valid)
  })

  it('coerces string ports into numbers', () => {
    const parsed = imapCredentialsSchema.parse({
      ...valid,
      imapPort: '993' as unknown as number,
      smtpPort: '587' as unknown as number,
      smtpTls: 'starttls' as const,
    })
    expect(parsed.imapPort).toBe(993)
    expect(parsed.smtpPort).toBe(587)
  })

  it('rejects out-of-range ports', () => {
    expect(() => imapCredentialsSchema.parse({ ...valid, imapPort: 0 })).toThrow(/IMAP port/i)
    expect(() => imapCredentialsSchema.parse({ ...valid, smtpPort: 70_000 })).toThrow(/SMTP port/i)
  })

  it('rejects missing required strings', () => {
    expect(() => imapCredentialsSchema.parse({ ...valid, imapHost: '' })).toThrow(/IMAP host/i)
    expect(() => imapCredentialsSchema.parse({ ...valid, imapPassword: '' })).toThrow(/IMAP password/i)
    expect(() => imapCredentialsSchema.parse({ ...valid, smtpPassword: '' })).toThrow(/SMTP password/i)
  })

  it('rejects invalid TLS modes', () => {
    expect(() => imapCredentialsSchema.parse({ ...valid, imapTls: 'plain' as never })).toThrow()
    expect(() => imapCredentialsSchema.parse({ ...valid, smtpTls: 'tls/1.3' as never })).toThrow()
  })

  it('rejects non-email From address', () => {
    expect(() => imapCredentialsSchema.parse({ ...valid, fromAddress: 'not-an-email' })).toThrow(
      /From address must be a valid email/i,
    )
  })
})

describe('imapChannelStateSchema', () => {
  it('accepts numeric uidValidity and uidNext', () => {
    expect(imapChannelStateSchema.parse({ uidValidity: 123, uidNext: 456 })).toMatchObject({
      uidValidity: 123,
      uidNext: 456,
    })
  })

  it('accepts string uidValidity (some servers ship 64-bit values as strings)', () => {
    expect(imapChannelStateSchema.parse({ uidValidity: '9007199254740993' })).toMatchObject({
      uidValidity: '9007199254740993',
    })
  })

  it('accepts empty state', () => {
    expect(imapChannelStateSchema.parse({})).toEqual({})
  })

  it('passes through additional provider fields without erroring', () => {
    const state = imapChannelStateSchema.parse({ uidValidity: 1, customMarker: 'hi' })
    expect(state).toMatchObject({ uidValidity: 1, customMarker: 'hi' })
  })
})
