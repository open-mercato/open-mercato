import { encodeAkeneoPathParam, normalizeAkeneoDateTime, sanitizeAkeneoProductNextUrl } from '../lib/client'

describe('akeneo client helpers', () => {
  it('normalizes ISO timestamps to Akeneo query format', () => {
    expect(normalizeAkeneoDateTime('2026-03-10T12:15:30.000Z')).toBe('2026-03-10 12:15:30')
  })

  it('returns null for blank timestamps', () => {
    expect(normalizeAkeneoDateTime('')).toBeNull()
    expect(normalizeAkeneoDateTime(null)).toBeNull()
  })

  it('removes empty updated filters from Akeneo next urls', () => {
    const url = new URL('https://example.test/api/rest/v1/products-uuid')
    url.searchParams.set('search', JSON.stringify({
      updated: [{ operator: '>', value: '' }],
      enabled: [{ operator: '=', value: true }],
    }))

    const nextUrl = sanitizeAkeneoProductNextUrl(url.toString())
    const search = new URL(nextUrl).searchParams.get('search')
    expect(search).not.toContain('"updated"')
    expect(search).toContain('"enabled"')
  })

  it('normalizes updated filters in Akeneo next urls', () => {
    const url = new URL('https://example.test/api/rest/v1/products-uuid')
    url.searchParams.set('search', JSON.stringify({
      updated: [{ operator: '>', value: '2026-03-10T12:15:30.000Z' }],
    }))

    const nextUrl = sanitizeAkeneoProductNextUrl(url.toString())
    const search = new URL(nextUrl).searchParams.get('search')
    const parsed = JSON.parse(search ?? '{}') as { updated?: Array<{ value?: string }> }
    expect(parsed.updated?.[0]?.value).toBe('2026-03-10 12:15:30')
  })

  it('preserves Akeneo media path separators when encoding path params', () => {
    expect(encodeAkeneoPathParam('6/7/7/6776561ac32580e17fe19bb007edacd2764a8d3c_t_shirt_green.jpg'))
      .toBe('6/7/7/6776561ac32580e17fe19bb007edacd2764a8d3c_t_shirt_green.jpg')
  })
})
