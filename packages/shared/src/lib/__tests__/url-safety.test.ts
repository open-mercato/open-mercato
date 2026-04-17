import {
  assertSafeOutboundUrl,
  assertStaticallySafeOutboundUrl,
  parseOutboundUrl,
  UnsafeOutboundUrlError,
} from '../url-safety'

describe('url-safety — parseOutboundUrl', () => {
  it('accepts plain http and https URLs', () => {
    expect(parseOutboundUrl('https://example.test/hook').hostname).toBe('example.test')
    expect(parseOutboundUrl('http://api.example.com:8080/in').hostname).toBe('api.example.com')
  })

  it('rejects non-http(s) protocols', () => {
    expect(() => parseOutboundUrl('ftp://example.test/hook')).toThrow(UnsafeOutboundUrlError)
    expect(() => parseOutboundUrl('file:///etc/passwd')).toThrow(UnsafeOutboundUrlError)
    expect(() => parseOutboundUrl('gopher://example.test/')).toThrow(UnsafeOutboundUrlError)
  })

  it('rejects embedded basic-auth credentials', () => {
    expect(() => parseOutboundUrl('https://user:pass@example.test/hook')).toThrow(
      UnsafeOutboundUrlError,
    )
  })

  it('rejects garbage', () => {
    expect(() => parseOutboundUrl('not-a-url')).toThrow(UnsafeOutboundUrlError)
    expect(() => parseOutboundUrl('')).toThrow(UnsafeOutboundUrlError)
  })

  it('emits reason field for pattern matching', () => {
    try {
      parseOutboundUrl('ftp://example.test/')
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeOutboundUrlError)
      expect((error as UnsafeOutboundUrlError).reason).toBe('forbidden_protocol')
    }
  })

  it('respects custom errorFactory (subclass support)', () => {
    class CustomErr extends UnsafeOutboundUrlError {
      constructor(reason: any, message: string) {
        super(reason, message)
        this.name = 'CustomErr'
      }
    }
    expect(() =>
      parseOutboundUrl('ftp://example.test/', {
        errorFactory: (reason, message) => new CustomErr(reason, message),
      }),
    ).toThrow(CustomErr)
  })
})

describe('url-safety — assertStaticallySafeOutboundUrl', () => {
  it('accepts plain public hostnames', () => {
    expect(() => assertStaticallySafeOutboundUrl('https://api.stripe.com/v1/webhook')).not.toThrow()
  })

  it('rejects private IPv4 literals', () => {
    expect(() => assertStaticallySafeOutboundUrl('http://127.0.0.1:8080/x')).toThrow(
      UnsafeOutboundUrlError,
    )
    expect(() => assertStaticallySafeOutboundUrl('http://169.254.169.254/')).toThrow(
      UnsafeOutboundUrlError,
    )
    expect(() => assertStaticallySafeOutboundUrl('http://10.0.0.5/admin')).toThrow(
      UnsafeOutboundUrlError,
    )
    expect(() => assertStaticallySafeOutboundUrl('http://192.168.1.1/')).toThrow(
      UnsafeOutboundUrlError,
    )
  })

  it('rejects IPv6 loopback literal', () => {
    expect(() => assertStaticallySafeOutboundUrl('http://[::1]/')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertStaticallySafeOutboundUrl('http://[fc00::1]/')).toThrow(
      UnsafeOutboundUrlError,
    )
  })

  it('rejects well-known blocked hostnames', () => {
    expect(() => assertStaticallySafeOutboundUrl('http://localhost/')).toThrow(
      UnsafeOutboundUrlError,
    )
    expect(() => assertStaticallySafeOutboundUrl('http://metadata.google.internal/')).toThrow(
      UnsafeOutboundUrlError,
    )
    expect(() => assertStaticallySafeOutboundUrl('http://foo.local/')).toThrow(
      UnsafeOutboundUrlError,
    )
  })

  it('bypasses private host checks when allowPrivate=true', () => {
    expect(() =>
      assertStaticallySafeOutboundUrl('http://localhost:3000/dev', { allowPrivate: true }),
    ).not.toThrow()
    expect(() =>
      assertStaticallySafeOutboundUrl('http://10.0.0.5/dev', { allowPrivate: true }),
    ).not.toThrow()
  })

  it('still rejects invalid protocols when allowPrivate=true', () => {
    expect(() =>
      assertStaticallySafeOutboundUrl('file:///etc/passwd', { allowPrivate: true }),
    ).toThrow(UnsafeOutboundUrlError)
  })
})

describe('url-safety — assertSafeOutboundUrl (DNS rebinding guard)', () => {
  it('rejects hostnames that resolve to private IPs', async () => {
    const lookupHost = async () => [{ address: '10.0.0.5', family: 4 }]
    await expect(
      assertSafeOutboundUrl('https://rebind.evil.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'private_ip_resolved' })
  })

  it('rejects AWS metadata even if only one resolved address is private', async () => {
    const lookupHost = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]
    await expect(
      assertSafeOutboundUrl('https://mixed.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'private_ip_resolved' })
  })

  it('accepts hostnames that resolve to public IPs', async () => {
    const lookupHost = async () => [{ address: '93.184.216.34', family: 4 }]
    await expect(
      assertSafeOutboundUrl('https://good.example/', { lookupHost, allowPrivate: false }),
    ).resolves.toBeUndefined()
  })

  it('rejects hostnames whose DNS lookup fails', async () => {
    const lookupHost = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(
      assertSafeOutboundUrl('https://broken.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'dns_resolution_failed' })
  })

  it('rejects hostnames whose DNS lookup returns nothing', async () => {
    const lookupHost = async () => []
    await expect(
      assertSafeOutboundUrl('https://empty.example/', { lookupHost, allowPrivate: false }),
    ).rejects.toMatchObject({ reason: 'dns_resolution_empty' })
  })

  it('short-circuits direct private IP literal without DNS lookup', async () => {
    const lookupHost = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    await expect(
      assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/', {
        lookupHost,
        allowPrivate: false,
      }),
    ).rejects.toMatchObject({ reason: 'private_ip_literal' })
    expect(lookupHost).not.toHaveBeenCalled()
  })

  it('bypasses checks when allowPrivate=true', async () => {
    const lookupHost = jest.fn()
    await expect(
      assertSafeOutboundUrl('http://127.0.0.1:8080/dev', { lookupHost, allowPrivate: true }),
    ).resolves.toBeUndefined()
    expect(lookupHost).not.toHaveBeenCalled()
  })

  it('still rejects invalid protocols when allowPrivate=true', async () => {
    await expect(
      assertSafeOutboundUrl('file:///etc/passwd', { allowPrivate: true }),
    ).rejects.toMatchObject({ reason: 'forbidden_protocol' })
  })
})
