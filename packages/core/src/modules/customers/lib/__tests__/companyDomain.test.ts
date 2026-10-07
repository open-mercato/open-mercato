import { normalizeCompanyDomain, parseCompanyDomainFilter } from '../companyDomain'

describe('normalizeCompanyDomain', () => {
  it.each([
    ['acme.com', 'acme.com'],
    ['  ACME.com ', 'acme.com'],
    ['www.acme.com', 'acme.com'],
    ['https://www.Acme.com/', 'acme.com'],
    ['http://acme.com:8080/pricing?ref=1#top', 'acme.com'],
    ['acme.com.', 'acme.com'],
    ['shop.acme.com', 'shop.acme.com'],
    ['acme.co.uk/', 'acme.co.uk'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeCompanyDomain(input)).toBe(expected)
  })

  it.each([[''], ['   '], ['https://'], [null], [undefined], [42]])('returns null for %p', (input) => {
    expect(normalizeCompanyDomain(input)).toBeNull()
  })
})

describe('parseCompanyDomainFilter', () => {
  it.each([
    ['acme.com', 'acme.com'],
    [' ACME.com ', 'acme.com'],
    ['www.acme.com', 'acme.com'],
    ['@acme.com', 'acme.com'],
    ['shop.acme.com', 'shop.acme.com'],
    ['acme.co.uk', 'acme.co.uk'],
  ])('accepts %p as %p', (input, expected) => {
    expect(parseCompanyDomainFilter(input)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['/'],
    ['https://'],
    ['https://acme.com'],
    ['acme.com/pricing'],
    ['acme.com:8080'],
    ['acme corp.com'],
    ['acme'],
    ['.com'],
    ['acme.'],
  ])('rejects %p', (input) => {
    expect(parseCompanyDomainFilter(input)).toBeNull()
  })
})
