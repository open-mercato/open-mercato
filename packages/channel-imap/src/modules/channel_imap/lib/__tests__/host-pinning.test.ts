import { resolveSafeHostAddress, type HostLookup } from '../host-pinning'

function fakeLookup(records: Array<{ address: string; family: number }>): HostLookup {
  return jest.fn(async () => records)
}

describe('resolveSafeHostAddress — connect-time SSRF pinning', () => {
  afterEach(() => {
    delete process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS
  })

  it('resolves a public hostname to its IP and pins the original hostname as TLS servername', async () => {
    const lookup = fakeLookup([{ address: '93.184.216.34', family: 4 }])
    const result = await resolveSafeHostAddress('imap.example.com', { lookup })
    expect(result).toEqual({ host: '93.184.216.34', servername: 'imap.example.com' })
    expect(lookup).toHaveBeenCalledWith('imap.example.com')
  })

  it('rejects a hostname that resolves to a private address (DNS rebinding)', async () => {
    const lookup = fakeLookup([{ address: '10.0.0.5', family: 4 }])
    await expect(resolveSafeHostAddress('rebind.attacker.test', { lookup })).rejects.toThrow(
      /private or loopback/i,
    )
  })

  it('rejects when ANY resolved address is internal (cloud metadata in a mixed record set)', async () => {
    const lookup = fakeLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    await expect(resolveSafeHostAddress('mixed.attacker.test', { lookup })).rejects.toThrow(
      /private or loopback/i,
    )
  })

  it('rejects a hostname that resolves to IPv6 loopback', async () => {
    const lookup = fakeLookup([{ address: '::1', family: 6 }])
    await expect(resolveSafeHostAddress('v6.attacker.test', { lookup })).rejects.toThrow(
      /private or loopback/i,
    )
  })

  it('returns a literal public IP unchanged with no servername and does not resolve it', async () => {
    const lookup = fakeLookup([{ address: '203.0.113.7', family: 4 }])
    const result = await resolveSafeHostAddress('93.184.216.34', { lookup })
    expect(result).toEqual({ host: '93.184.216.34' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a literal internal IP even though the schema should have caught it (defense in depth)', async () => {
    await expect(resolveSafeHostAddress('169.254.169.254')).rejects.toThrow(/private or loopback/i)
  })

  it('throws when the hostname does not resolve to any address', async () => {
    const lookup = fakeLookup([])
    await expect(resolveSafeHostAddress('nxdomain.attacker.test', { lookup })).rejects.toThrow(
      /did not resolve/i,
    )
  })

  it('skips resolution and returns the host verbatim when OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true', async () => {
    process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS = 'true'
    const lookup = fakeLookup([{ address: '10.0.0.5', family: 4 }])
    const result = await resolveSafeHostAddress('mail.internal.lan', { lookup })
    expect(result).toEqual({ host: 'mail.internal.lan' })
    expect(lookup).not.toHaveBeenCalled()
  })
})
