import {
  isInternalHost,
  resolveSafeHostAddress,
  type HostLookup,
} from '../host-pinning'

const publicLookup: HostLookup = async () => [{ address: '93.184.216.34', family: 4 }]

describe('isInternalHost', () => {
  it.each([
    'localhost',
    'mail.localhost',
    'metadata.google.internal',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2130706433',
    '0x7f.0.0.1',
    '0177.0.0.1',
    '127.1',
  ])('classifies %s as internal', (host) => {
    expect(isInternalHost(host)).toBe(true)
  })

  it.each([
    'smtp.example.com',
    'imap.fastmail.com',
    '93.184.216.34',
    '2606:2800:220:1:248:1893:25c8:1946',
    // First label merely looks like a private range; this is a hostname, not a quad.
    '0.mx.example.com',
    '10.example.com',
  ])('classifies %s as public', (host) => {
    expect(isInternalHost(host)).toBe(false)
  })

  it('treats an empty host as a missing field, not an SSRF attempt', () => {
    expect(isInternalHost('')).toBe(false)
    expect(isInternalHost('   ')).toBe(false)
  })
})

describe('resolveSafeHostAddress', () => {
  it('pins a hostname to its resolved IP and keeps the hostname for TLS SNI', async () => {
    expect(await resolveSafeHostAddress('smtp.example.com', { lookup: publicLookup })).toEqual({
      host: '93.184.216.34',
      servername: 'smtp.example.com',
    })
  })

  it('rejects a hostname that resolves to an internal address (DNS rebinding)', async () => {
    const lookup: HostLookup = async () => [{ address: '169.254.169.254', family: 4 }]
    await expect(resolveSafeHostAddress('rebind.attacker.test', { lookup })).rejects.toThrow(
      /private or loopback/i,
    )
  })

  it('rejects when only one of several resolved addresses is internal', async () => {
    const lookup: HostLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    await expect(resolveSafeHostAddress('mixed.attacker.test', { lookup })).rejects.toThrow(
      /private or loopback/i,
    )
  })

  it('returns a public literal IP unchanged, with no servername to verify against', async () => {
    expect(await resolveSafeHostAddress('93.184.216.34', { lookup: publicLookup })).toEqual({
      host: '93.184.216.34',
    })
  })

  it('rejects an internal literal IP without a lookup', async () => {
    await expect(resolveSafeHostAddress('169.254.169.254')).rejects.toThrow(/private or loopback/i)
  })

  it('rejects a host that resolves to nothing', async () => {
    await expect(
      resolveSafeHostAddress('nxdomain.attacker.test', { lookup: async () => [] }),
    ).rejects.toThrow(/did not resolve/i)
  })

  it('skips resolution entirely when the caller allows internal hosts', async () => {
    const lookup: HostLookup = async () => {
      throw new Error('should not resolve')
    }
    expect(await resolveSafeHostAddress('mail.internal.lan', { lookup, allowInternal: true })).toEqual({
      host: 'mail.internal.lan',
    })
  })

  it('uses the caller-supplied messages so operators see their own escape hatch', async () => {
    await expect(
      resolveSafeHostAddress('169.254.169.254', { internalMessage: 'set OM_CHANNEL_SMTP_ALLOW_INTERNAL_HOSTS=true' }),
    ).rejects.toThrow(/OM_CHANNEL_SMTP_ALLOW_INTERNAL_HOSTS/)
  })
})
