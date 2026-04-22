import {
  assertSafeWebhookDeliveryUrl,
  assertStaticallySafeWebhookUrl,
  isPrivateIpAddress,
  parseWebhookUrl,
  UnsafeWebhookUrlError,
} from '../url-safety'

describe('url-safety — parseWebhookUrl', () => {
  it('accepts plain http and https URLs', () => {
    expect(parseWebhookUrl('https://example.test/hook').hostname).toBe('example.test')
    expect(parseWebhookUrl('http://hooks.example.com:8080/in').hostname).toBe('hooks.example.com')
  })

  it('rejects non-http(s) protocols', () => {
    expect(() => parseWebhookUrl('ftp://example.test/hook')).toThrow(UnsafeWebhookUrlError)
    expect(() => parseWebhookUrl('file:///etc/passwd')).toThrow(UnsafeWebhookUrlError)
    expect(() => parseWebhookUrl('gopher://example.test/')).toThrow(UnsafeWebhookUrlError)
  })

  it('rejects embedded basic-auth credentials', () => {
    expect(() => parseWebhookUrl('https://user:pass@example.test/hook')).toThrow(UnsafeWebhookUrlError)
  })

  it('rejects garbage', () => {
    expect(() => parseWebhookUrl('not-a-url')).toThrow(UnsafeWebhookUrlError)
    expect(() => parseWebhookUrl('')).toThrow(UnsafeWebhookUrlError)
  })
})

describe('url-safety — isPrivateIpAddress', () => {
  const privateV4 = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.0.1',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.5',
    '224.0.0.1',
    '239.255.255.255',
    '255.255.255.255',
  ]
  const publicV4 = ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '93.184.216.34']

  it.each(privateV4)('flags private IPv4 %s', (addr) => {
    expect(isPrivateIpAddress(addr)).toBe(true)
  })

  it.each(publicV4)('allows public IPv4 %s', (addr) => {
    expect(isPrivateIpAddress(addr)).toBe(false)
  })

  it('flags private IPv6 ranges', () => {
    expect(isPrivateIpAddress('::1')).toBe(true)
    expect(isPrivateIpAddress('::')).toBe(true)
    expect(isPrivateIpAddress('fc00::1')).toBe(true)
    expect(isPrivateIpAddress('fd12:3456::1')).toBe(true)
    expect(isPrivateIpAddress('fe80::1')).toBe(true)
    expect(isPrivateIpAddress('ff02::1')).toBe(true)
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIpAddress('::ffff:7f00:1')).toBe(true)
    expect(isPrivateIpAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isPrivateIpAddress('::ffff:a9fe:a9fe')).toBe(true)
    expect(isPrivateIpAddress('64:ff9b::a9fe:a9fe')).toBe(true)
    expect(isPrivateIpAddress('2002:0a00:0001::1')).toBe(true)
    expect(isPrivateIpAddress('::8.8.8.8')).toBe(true)
    expect(isPrivateIpAddress('::808:808')).toBe(true)
  })

  it('allows public IPv6', () => {
    expect(isPrivateIpAddress('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIpAddress('2001:4860:4860::8888')).toBe(false)
  })
})

describe('url-safety — assertStaticallySafeWebhookUrl', () => {
  it('accepts plain public hostnames', () => {
    expect(() => assertStaticallySafeWebhookUrl('https://hooks.example.com/endpoint')).not.toThrow()
    expect(() => assertStaticallySafeWebhookUrl('https://api.stripe.com/v1/webhook')).not.toThrow()
  })

  it('rejects private IPv4 literals', () => {
    expect(() => assertStaticallySafeWebhookUrl('http://127.0.0.1:8080/steal')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://169.254.169.254/latest/meta-data/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://10.0.0.5/admin')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://192.168.1.1/')).toThrow(UnsafeWebhookUrlError)
  })

  it('rejects IPv6 loopback literal', () => {
    expect(() => assertStaticallySafeWebhookUrl('http://[::1]/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://[fc00::1]/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://[::ffff:127.0.0.1]/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://[::ffff:0a00:0001]/')).toThrow(UnsafeWebhookUrlError)
  })

  it('rejects non-standard IPv4 literals normalized by URL parsing', () => {
    expect(() => assertStaticallySafeWebhookUrl('http://2130706433/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://0177.0.0.1/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://0x7f.0.0.1/')).toThrow(UnsafeWebhookUrlError)
  })

  it('rejects well-known blocked hostnames', () => {
    expect(() => assertStaticallySafeWebhookUrl('http://localhost/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://metadata.google.internal/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://localhost./')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://foo.local/')).toThrow(UnsafeWebhookUrlError)
    expect(() => assertStaticallySafeWebhookUrl('http://service.internal/')).toThrow(UnsafeWebhookUrlError)
  })

  it('bypasses private host checks when OM_WEBHOOKS_ALLOW_PRIVATE_URLS is enabled', () => {
    expect(() => assertStaticallySafeWebhookUrl('http://localhost:3000/dev', { allowPrivate: true })).not.toThrow()
    expect(() => assertStaticallySafeWebhookUrl('http://10.0.0.5/dev', { allowPrivate: true })).not.toThrow()
  })

  it('still rejects invalid protocols when the static private URL override is enabled', () => {
    expect(() => assertStaticallySafeWebhookUrl('file:///etc/passwd', { allowPrivate: true })).toThrow(UnsafeWebhookUrlError)
  })
})

describe('url-safety — assertSafeWebhookDeliveryUrl (DNS rebinding guard)', () => {
  it('rejects hostnames that resolve to private IPs', async () => {
    const lookupHost = async () => [{ address: '10.0.0.5', family: 4 }]
    await expect(
      assertSafeWebhookDeliveryUrl('https://rebind.evil.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'private_ip_resolved' })
  })

  it('rejects AWS metadata even if only one resolved address is private', async () => {
    const lookupHost = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]
    await expect(
      assertSafeWebhookDeliveryUrl('https://mixed.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'private_ip_resolved' })
  })

  it('accepts hostnames that resolve to public IPs', async () => {
    const lookupHost = async () => [{ address: '93.184.216.34', family: 4 }]
    await expect(
      assertSafeWebhookDeliveryUrl('https://good.example/', { lookupHost, allowPrivate: false }),
    ).resolves.toBeUndefined()
  })

  it('rejects hostnames whose DNS lookup fails', async () => {
    const lookupHost = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(
      assertSafeWebhookDeliveryUrl('https://broken.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'dns_resolution_failed' })
  })

  it('rejects hostnames whose DNS lookup returns nothing', async () => {
    const lookupHost = async () => []
    await expect(
      assertSafeWebhookDeliveryUrl('https://empty.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'dns_resolution_empty' })
  })

  it('short-circuits direct private IP literal without DNS lookup', async () => {
    const lookupHost = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    await expect(
      assertSafeWebhookDeliveryUrl('http://169.254.169.254/latest/meta-data/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'private_ip_literal' })
    expect(lookupHost).not.toHaveBeenCalled()
  })

  it('bypasses checks when OM_WEBHOOKS_ALLOW_PRIVATE_URLS is enabled', async () => {
    const lookupHost = jest.fn()
    await expect(
      assertSafeWebhookDeliveryUrl('http://127.0.0.1:8080/dev', { lookupHost, allowPrivate: true }),
    ).resolves.toBeUndefined()
    expect(lookupHost).not.toHaveBeenCalled()
  })

  it('still rejects invalid protocols when private URL delivery override is enabled', async () => {
    await expect(
      assertSafeWebhookDeliveryUrl('file:///etc/passwd', { allowPrivate: true }),
    ).rejects.toMatchObject({ reason: 'forbidden_protocol' })
  })
})
