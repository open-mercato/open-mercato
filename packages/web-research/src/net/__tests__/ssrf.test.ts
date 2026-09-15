import { assertPublicUrl, isLoopbackHostname, isPrivateAddress, type LookupFn } from '../ssrf'
import { isWebResearchError } from '../../contract/errors'

const publicLookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }]
const privateLookup: LookupFn = async () => [{ address: '10.0.0.5', family: 4 }]
const failingLookup: LookupFn = async () => {
  throw new Error('ENOTFOUND')
}

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '240.0.0.1',
    '198.18.0.1',
  ])('blocks IPv4 %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1'])('allows public IPv4 %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })

  it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1'])(
    'blocks IPv6 %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(true)
    },
  )

  it('allows a public IPv6 address', () => {
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
  })

  // Regression: `new URL('http://[::ffff:127.0.0.1]/').hostname` is '::ffff:7f00:1',
  // so a guard matching only the dotted-quad spelling lets loopback through.
  it.each(['::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '::ffff:169.254.169.254'])(
    'blocks IPv4-mapped IPv6 %s in either spelling',
    (address) => {
      expect(isPrivateAddress(address)).toBe(true)
    },
  )

  it('blocks NAT64-embedded private IPv4', () => {
    expect(isPrivateAddress('64:ff9b::a00:1')).toBe(true)
  })

  it('treats an unparseable address as unsafe', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
    expect(isPrivateAddress('12345::zz')).toBe(true)
  })
})

describe('isLoopbackHostname', () => {
  it.each(['localhost', 'LOCALHOST', 'api.localhost'])('matches %s', (host) => {
    expect(isLoopbackHostname(host)).toBe(true)
  })

  it('does not match a lookalike', () => {
    expect(isLoopbackHostname('notlocalhost.com')).toBe(false)
  })
})

describe('assertPublicUrl', () => {
  it('returns the vetted addresses so the caller can pin them', async () => {
    const vetted = await assertPublicUrl('https://example.com/a', 'test', { lookup: publicLookup })
    expect(vetted.addresses).toEqual(['93.184.216.34'])
    expect(vetted.url.href).toBe('https://example.com/a')
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com'])(
    'rejects scheme in %s',
    async (url) => {
      await expect(assertPublicUrl(url, 'test', { lookup: publicLookup })).rejects.toThrow()
    },
  )

  it('rejects credentials in the URL', async () => {
    await expect(
      assertPublicUrl('https://user:pass@example.com/', 'test', { lookup: publicLookup }),
    ).rejects.toThrow(/Credentials/)
  })

  it('rejects a loopback hostname before consulting DNS', async () => {
    const lookup = jest.fn<ReturnType<LookupFn>, [string]>()
    await expect(assertPublicUrl('http://localhost:3000/', 'test', { lookup })).rejects.toThrow()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a host resolving to a private address', async () => {
    await expect(
      assertPublicUrl('https://internal.example.com/', 'test', { lookup: privateLookup }),
    ).rejects.toThrow(/non-public address/)
  })

  it('rejects a bracketed IPv4-mapped loopback literal', async () => {
    await expect(
      assertPublicUrl('http://[::ffff:127.0.0.1]/', 'test', { lookup: publicLookup }),
    ).rejects.toThrow(/non-public address/)
  })

  it('fails closed on DNS failure by default, because it cannot pin without addresses', async () => {
    await expect(
      assertPublicUrl('https://example.com/', 'test', { lookup: failingLookup }),
    ).rejects.toThrow(/Could not resolve/)
  })

  it('can fail open for callers that do not pin', async () => {
    const vetted = await assertPublicUrl('https://example.com/', 'test', {
      lookup: failingLookup,
      failClosed: false,
    })
    expect(vetted.addresses).toEqual([])
  })

  it('throws a branded error that survives realm boundaries', async () => {
    const error = await assertPublicUrl('http://127.0.0.1/', 'test').catch((caught: unknown) => caught)
    expect(isWebResearchError(error)).toBe(true)
  })

  describe('allowPrivateHosts', () => {
    it('lets a named host resolve privately', async () => {
      const vetted = await assertPublicUrl('http://searxng:8080/search', 'test', {
        lookup: async () => [{ address: '10.1.2.3', family: 4 }],
        allowPrivateHosts: ['searxng'],
      })
      expect(vetted.addresses).toEqual(['10.1.2.3'])
    })

    it('matches on a dot boundary, never a bare suffix', async () => {
      const options = {
        lookup: async () => [{ address: '10.1.2.3', family: 4 }],
        allowPrivateHosts: ['internal.example.com'],
      }
      await expect(
        assertPublicUrl('http://search.internal.example.com/', 'test', options),
      ).resolves.toBeDefined()
      await expect(
        assertPublicUrl('http://notinternal.example.com/', 'test', options),
      ).rejects.toMatchObject({ code: 'ssrf_blocked' })
    })

    it('still refuses a host nobody named', async () => {
      await expect(
        assertPublicUrl('http://169.254.169.254/latest/meta-data/', 'test', {
          allowPrivateHosts: ['searxng'],
        }),
      ).rejects.toMatchObject({ code: 'ssrf_blocked' })
    })

    it('unblocks loopback only for the named host', async () => {
      await expect(assertPublicUrl('http://127.0.0.1/', 'test', { allowPrivateHosts: ['127.0.0.1'] }))
        .resolves.toBeDefined()
      await expect(
        assertPublicUrl('http://localhost/', 'test', { allowPrivateHosts: ['127.0.0.1'] }),
      ).rejects.toMatchObject({ code: 'ssrf_blocked' })
    })
  })
})
