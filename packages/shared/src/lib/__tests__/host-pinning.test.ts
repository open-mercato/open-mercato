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

  it.each([
    ['0.0.0.0/8', '0.255.255.255'],
    ['10/8', '10.255.255.255'],
    ['100.64/10 lower bound', '100.64.0.0'],
    ['100.64/10 upper bound', '100.127.255.255'],
    ['127/8', '127.255.255.254'],
    ['169.254/16', '169.254.169.254'],
    ['172.16/12 lower bound', '172.16.0.1'],
    ['172.16/12 upper bound', '172.31.255.255'],
    ['192.0.0/24', '192.0.0.8'],
    ['192.0.2/24', '192.0.2.10'],
    ['192.168/16', '192.168.255.255'],
    ['198.18/15 lower bound', '198.18.0.1'],
    ['198.18/15 upper bound', '198.19.255.255'],
    ['198.51.100/24', '198.51.100.7'],
    ['203.0.113/24', '203.0.113.9'],
    ['224/4 multicast lower bound', '224.0.0.1'],
    ['224/4 multicast upper bound', '239.255.255.255'],
    ['240/4 reserved', '240.0.0.1'],
    ['limited broadcast', '255.255.255.255'],
    ['::/128', '::'],
    ['::1', '::1'],
    ['fe80::/10 lower bound', 'fe80::1'],
    ['fe80::/10 inside the range', 'fe90::1'],
    ['fe80::/10 upper bound', 'febf:ffff::1'],
    ['deprecated site-local fec0::/10', 'fec0::1'],
    ['fc00::/7 lower bound', 'fc00::1'],
    ['fc00::/7 upper bound', 'fdff:ffff::1'],
    ['ff00::/8 multicast', 'ff02::1'],
    ['documentation 2001:db8::/32', '2001:db8::1'],
    ['IPv4-mapped hex form', '::ffff:7f00:1'],
    ['IPv4-mapped dotted form', '::ffff:10.0.0.1'],
    ['IPv4-compatible', '::127.0.0.1'],
    ['NAT64 embedding loopback', '64:ff9b::7f00:1'],
    ['6to4 embedding a private IPv4', '2002:a00:1::1'],
    ['zone-scoped link-local', 'fe80::1%eth0'],
    ['malformed IPv6-looking host', 'fe80:::1'],
  ])('classifies %s (%s) as internal', (_range, host) => {
    expect(isInternalHost(host)).toBe(true)
  })

  it.each([
    ['just below 100.64/10', '100.63.255.255'],
    ['just above 100.64/10', '100.128.0.0'],
    ['just below 172.16/12', '172.15.255.255'],
    ['just above 172.16/12', '172.32.0.0'],
    ['just above 198.18/15', '198.20.0.1'],
    ['just below 224/4', '223.255.255.255'],
    ['global unicast IPv6', '2a00:1450:4001:80b::200e'],
    ['6to4 embedding a public IPv4', '2002:5db8:d822::1'],
  ])('classifies %s (%s) as public', (_range, host) => {
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
