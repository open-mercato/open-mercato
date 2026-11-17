import { assertPublicTillioApiUrl } from '../lib/url-guard'

describe('assertPublicTillioApiUrl', () => {
  it('allows public https hosts', () => {
    expect(() => assertPublicTillioApiUrl('https://x.example.com')).not.toThrow()
    expect(() => assertPublicTillioApiUrl('https://api.tillio.io/v1')).not.toThrow()
    expect(() => assertPublicTillioApiUrl('https://example.com:8443')).not.toThrow()
    expect(() => assertPublicTillioApiUrl('https://8.8.8.8')).not.toThrow()
  })

  it('rejects plaintext http even on a public host', () => {
    expect(() => assertPublicTillioApiUrl('http://api.tillio.example.com')).toThrow(/https/)
    expect(() => assertPublicTillioApiUrl('http://example.com:8443')).toThrow(/https/)
  })

  it('rejects non-http(s) schemes', () => {
    expect(() => assertPublicTillioApiUrl('file:///etc/passwd')).toThrow()
    expect(() => assertPublicTillioApiUrl('gopher://example.com')).toThrow()
    expect(() => assertPublicTillioApiUrl('not a url')).toThrow()
  })

  // The private-host cases stay on https so they keep exercising the host checks rather
  // than tripping the transport check first.
  it('rejects loopback and localhost', () => {
    expect(() => assertPublicTillioApiUrl('https://localhost:9000')).toThrow()
    expect(() => assertPublicTillioApiUrl('https://api.localhost')).toThrow()
    expect(() => assertPublicTillioApiUrl('https://127.0.0.1')).toThrow()
    expect(() => assertPublicTillioApiUrl('https://[::1]')).toThrow()
  })

  it('rejects RFC1918 private ranges', () => {
    expect(() => assertPublicTillioApiUrl('https://10.0.0.5')).toThrow()
    expect(() => assertPublicTillioApiUrl('https://172.16.0.1')).toThrow()
    expect(() => assertPublicTillioApiUrl('https://192.168.1.1')).toThrow()
  })

  it('rejects link-local / cloud metadata', () => {
    expect(() => assertPublicTillioApiUrl('https://169.254.169.254')).toThrow()
    expect(() => assertPublicTillioApiUrl('https://[fe80::1]')).toThrow()
    expect(() => assertPublicTillioApiUrl('https://0.0.0.0')).toThrow()
  })

  it('rejects ipv4-mapped ipv6 loopback', () => {
    expect(() => assertPublicTillioApiUrl('https://[::ffff:127.0.0.1]')).toThrow()
  })
})
