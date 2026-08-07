import { assertPublicTillioApiUrl } from '../lib/url-guard'

describe('assertPublicTillioApiUrl', () => {
  it('allows public https/http hosts', () => {
    expect(() => assertPublicTillioApiUrl('https://x.example.com')).not.toThrow()
    expect(() => assertPublicTillioApiUrl('https://api.tillio.io/v1')).not.toThrow()
    expect(() => assertPublicTillioApiUrl('http://example.com:8443')).not.toThrow()
    expect(() => assertPublicTillioApiUrl('https://8.8.8.8')).not.toThrow()
  })

  it('rejects non-http(s) schemes', () => {
    expect(() => assertPublicTillioApiUrl('file:///etc/passwd')).toThrow()
    expect(() => assertPublicTillioApiUrl('gopher://example.com')).toThrow()
    expect(() => assertPublicTillioApiUrl('not a url')).toThrow()
  })

  it('rejects loopback and localhost', () => {
    expect(() => assertPublicTillioApiUrl('http://localhost:9000')).toThrow()
    expect(() => assertPublicTillioApiUrl('http://api.localhost')).toThrow()
    expect(() => assertPublicTillioApiUrl('http://127.0.0.1')).toThrow()
    expect(() => assertPublicTillioApiUrl('http://[::1]')).toThrow()
  })

  it('rejects RFC1918 private ranges', () => {
    expect(() => assertPublicTillioApiUrl('http://10.0.0.5')).toThrow()
    expect(() => assertPublicTillioApiUrl('http://172.16.0.1')).toThrow()
    expect(() => assertPublicTillioApiUrl('http://192.168.1.1')).toThrow()
  })

  it('rejects link-local / cloud metadata', () => {
    expect(() => assertPublicTillioApiUrl('http://169.254.169.254')).toThrow()
    expect(() => assertPublicTillioApiUrl('http://[fe80::1]')).toThrow()
    expect(() => assertPublicTillioApiUrl('http://0.0.0.0')).toThrow()
  })

  it('rejects ipv4-mapped ipv6 loopback', () => {
    expect(() => assertPublicTillioApiUrl('http://[::ffff:127.0.0.1]')).toThrow()
  })
})
