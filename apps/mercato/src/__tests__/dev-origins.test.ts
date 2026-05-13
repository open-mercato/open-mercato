import { resolveAllowedDevOrigins } from '../lib/dev-origins'

describe('resolveAllowedDevOrigins', () => {
  it('extracts hostnames from public app origin envs', () => {
    expect(
      resolveAllowedDevOrigins({
        APP_URL: 'https://preview.example.com/app/',
        NEXT_PUBLIC_APP_URL: 'https://public.example.com',
        APP_ALLOWED_ORIGINS: 'https://builder.example.com, https://preview.example.com/app/, invalid, https://public.example.com',
      }),
    ).toEqual(['preview.example.com', 'public.example.com', 'builder.example.com'])
  })

  it('returns an empty list when no valid origins are configured', () => {
    expect(resolveAllowedDevOrigins({ APP_URL: 'not-a-url', NEXT_PUBLIC_APP_URL: '', APP_ALLOWED_ORIGINS: '  ' })).toEqual([])
  })

  it('allowlists loopback host aliases together', () => {
    expect(
      resolveAllowedDevOrigins({
        APP_URL: 'http://localhost:3000',
        NEXT_PUBLIC_APP_URL: '',
        APP_ALLOWED_ORIGINS: '',
      }),
    ).toEqual(['localhost', '127.0.0.1', '[::1]'])
  })

  it('strips explicit ports so only the hostname is allowlisted', () => {
    expect(
      resolveAllowedDevOrigins({
        APP_URL: 'https://preview.example.com:8443/',
        NEXT_PUBLIC_APP_URL: 'http://public.example.com:3000',
        APP_ALLOWED_ORIGINS: '',
      }),
    ).toEqual(['preview.example.com', 'public.example.com'])
  })

  it('lowercases hostnames and dedupes case-insensitive duplicates', () => {
    expect(
      resolveAllowedDevOrigins({
        APP_URL: 'https://Preview.Example.COM/',
        NEXT_PUBLIC_APP_URL: 'https://preview.example.com',
        APP_ALLOWED_ORIGINS: '',
      }),
    ).toEqual(['preview.example.com'])
  })

  it('accepts IPv6 literal hosts', () => {
    expect(
      resolveAllowedDevOrigins({
        APP_URL: 'http://[::1]:3000/',
        NEXT_PUBLIC_APP_URL: '',
        APP_ALLOWED_ORIGINS: '',
      }),
    ).toEqual(['[::1]', 'localhost', '127.0.0.1'])
  })
})
