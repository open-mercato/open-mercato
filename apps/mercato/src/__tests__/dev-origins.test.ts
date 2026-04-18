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
})
