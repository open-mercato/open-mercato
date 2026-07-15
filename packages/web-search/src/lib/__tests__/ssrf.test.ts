import { assertPublicUrl, isPrivateAddress } from '../ssrf'
import { isWebSearchProviderError } from '../errors'
import type { LookupFn } from '../ssrf'

const publicLookup: LookupFn = async () => [{ address: '8.8.8.8', family: 4 }]
const privateLookup: LookupFn = async () => [{ address: '10.0.0.1', family: 4 }]

async function expectBlocked(promise: Promise<unknown>): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(isWebSearchProviderError(caught)).toBe(true)
  expect(isWebSearchProviderError(caught) && caught.code).toBe('ssrf_blocked')
}

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '10.1.2.3',
    '192.168.0.5',
    '172.16.9.9',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])('flags %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])(
    'flags %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false)
    },
  )

  it('treats a non-IP literal as unsafe', () => {
    expect(isPrivateAddress('example.com')).toBe(true)
  })
})

describe('assertPublicUrl', () => {
  it('blocks non-http(s) schemes', async () => {
    await expectBlocked(assertPublicUrl('ftp://example.com/x'))
    await expectBlocked(assertPublicUrl('file:///etc/passwd'))
  })

  it('blocks credentials embedded in the URL', async () => {
    await expectBlocked(assertPublicUrl('http://user:pass@example.com', { lookup: publicLookup }))
  })

  it('blocks an invalid URL', async () => {
    await expectBlocked(assertPublicUrl('not a url'))
  })

  it('blocks literal private / metadata IPs without resolving', async () => {
    await expectBlocked(assertPublicUrl('http://127.0.0.1/'))
    await expectBlocked(assertPublicUrl('http://169.254.169.254/latest/meta-data'))
    await expectBlocked(assertPublicUrl('http://[::1]/'))
  })

  it('blocks a hostname that resolves to a private address (rebinding)', async () => {
    await expectBlocked(assertPublicUrl('http://rebind.example.com/', { lookup: privateLookup }))
  })

  it('allows a hostname that resolves to a public address', async () => {
    const url = await assertPublicUrl('https://example.com/path', { lookup: publicLookup })
    expect(url.hostname).toBe('example.com')
  })

  it('blocks when the host does not resolve', async () => {
    await expectBlocked(assertPublicUrl('http://nope.example.com/', { lookup: async () => [] }))
  })
})
