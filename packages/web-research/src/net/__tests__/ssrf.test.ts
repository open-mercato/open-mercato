import { assertPublicUrl, isLoopbackHostname, isPrivateAddress, type LookupFn } from '../ssrf'
import { isWebResearchError } from '../../contract/errors'

const publicLookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }]
const privateLookup: LookupFn = async () => [{ address: '10.0.0.5', family: 4 }]
const failingLookup: LookupFn = async () => {
  throw new Error('ENOTFOUND')
}

const localUseTranslationAddresses = [
  '64:ff9b:1::',
  '64:ff9b:1::a00:1',
  '64:ff9b:1::808:808',
  '0064:FF9B:0001:1234:5678:90AB:CDEF:1234',
  '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
]
const private6to4Addresses = [
  '2002:0000:0000::1',
  '2002:0a01:0203::1',
  '2002:6440:0001::1',
  '2002:7f00:0001::1',
  '2002:a9fe:a9fe::1',
  '2002:ac10:0001::1',
  '2002:c000:0001::1',
  '2002:c0a8:0101::1',
  '2002:c612:0001::1',
  '2002:e000:0001::1',
  '2002:f000:0001::1',
  '2002:0A00:0001:0000:0000:0000:0808:0808',
]
const blockedTransitionAddresses = [...localUseTranslationAddresses, ...private6to4Addresses]
const publicIpv6Addresses = [
  '2606:2800:220:1:248:1893:25c8:1946',
  '64:ff9b::808:808',
  '2002:0808:0808:abcd::1',
  '2002:5db8:d822::a00:1',
]

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

  it.each(publicIpv6Addresses)('allows public IPv6 %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })

  it.each(localUseTranslationAddresses)('blocks the local-use translation address %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(private6to4Addresses)('blocks 6to4 with non-public embedded IPv4 %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
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

  it.each(blockedTransitionAddresses)('rejects the IPv6 literal %s before DNS', async (address) => {
    const lookup = jest.fn<ReturnType<LookupFn>, [string]>()
    await expect(assertPublicUrl(`http://[${address}]/`, 'test', { lookup })).rejects.toMatchObject({
      code: 'ssrf_blocked',
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each(blockedTransitionAddresses)('rejects a mixed DNS answer containing %s', async (address) => {
    await expect(
      assertPublicUrl('https://translated.example.com/', 'test', {
        lookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address, family: 6 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ssrf_blocked' })
  })

  it.each(publicIpv6Addresses)('vets and retains public IPv6 %s for pinning', async (address) => {
    const literal = await assertPublicUrl(`https://[${address}]/`, 'test')
    expect(literal.addresses).toEqual([new URL(`https://[${address}]/`).hostname.slice(1, -1)])
    const resolved = await assertPublicUrl('https://public.example.com/', 'test', {
      lookup: async () => [{ address, family: 6 }],
    })
    expect(resolved.addresses).toEqual([address])
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
    it.each(blockedTransitionAddresses)('permits %s only for explicitly named hosts', async (address) => {
      const options = {
        lookup: async () => [{ address, family: 6 }],
        allowPrivateHosts: ['internal.example.com'],
      }
      const vetted = await assertPublicUrl('http://search.internal.example.com/', 'test', options)
      expect(vetted.addresses).toEqual([address])
      await expect(
        assertPublicUrl('http://notinternal.example.com/', 'test', options),
      ).rejects.toMatchObject({ code: 'ssrf_blocked' })
    })

    it.each(['64:ff9b:1::a00:1', '2002:a00:1::1'])(
      'permits the explicitly named IPv6 literal %s',
      async (address) => {
        const vetted = await assertPublicUrl(`http://[${address}]/`, 'test', {
          allowPrivateHosts: [address],
        })
        expect(vetted.addresses).toEqual([address])
      },
    )

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
