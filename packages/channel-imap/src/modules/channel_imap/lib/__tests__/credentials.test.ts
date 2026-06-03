import { imapCredentialsSchema, imapChannelStateSchema, isInternalHost } from '../credentials'

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

  it('rejects an internal IMAP host (SSRF guard wired into the schema)', () => {
    expect(() => imapCredentialsSchema.parse({ ...valid, imapHost: '169.254.169.254' })).toThrow(
      /private or loopback/i,
    )
    expect(() => imapCredentialsSchema.parse({ ...valid, smtpHost: 'localhost' })).toThrow(/private or loopback/i)
  })

  it('honors the OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS escape hatch', () => {
    const previous = process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS
    process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS = 'true'
    try {
      expect(() =>
        imapCredentialsSchema.parse({ ...valid, imapHost: '127.0.0.1', smtpHost: '127.0.0.1' }),
      ).not.toThrow()
    } finally {
      if (previous === undefined) delete process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS
      else process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS = previous
    }
  })
})

describe('isInternalHost (SSRF guard)', () => {
  const blocked = [
    'localhost',
    'LOCALHOST',
    'foo.localhost',
    'localhost6',
    'ip6-localhost',
    'metadata.google.internal',
    '127.0.0.1',
    '127.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '2130706433',
    '0x7f.0.0.1',
    '0177.0.0.1',
    '::1',
    '[::1]',
    '::',
    '[::]',
    '0000:0000:0000:0000:0000:0000:0000:0001',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ]

  const allowed = [
    'imap.example.com',
    'smtp.fastmail.com',
    'mail.proton.me',
    '8.8.8.8',
    '1.1.1.1',
    '203.0.113.10',
    '2001:4860:4860::8888',
  ]

  it.each(blocked)('blocks internal/obfuscated host %s', (host) => {
    expect(isInternalHost(host)).toBe(true)
  })

  it.each(allowed)('allows public host %s', (host) => {
    expect(isInternalHost(host)).toBe(false)
  })

  it('treats an empty host as not-internal (length validation handles it)', () => {
    expect(isInternalHost('')).toBe(false)
    expect(isInternalHost('   ')).toBe(false)
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
