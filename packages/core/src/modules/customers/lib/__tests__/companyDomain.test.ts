import { normalizeCompanyDomain, parseCompanyDomainFilter } from '../companyDomain'

const MAX_LENGTH_DOMAIN = `${`${'a'.repeat(63)}.`.repeat(3)}${'a'.repeat(61)}`

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
    ['https://www.BÜCHER.de/', 'xn--bcher-kva.de'],
    ['xn--bcher-kva.de', 'xn--bcher-kva.de'],
    ['acme corp', 'acme corp'],
    ['https://user@www.acme.com/', 'acme.com'],
    ['\u200Bwww.acme.com', 'acme.com'],
    ['\uFF57\uFF57\uFF57.acme.com', 'acme.com'],
    ['acme.com\u3002', 'acme.com'],
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
    ['acme.com.', 'acme.com'],
    ['shop.acme.com', 'shop.acme.com'],
    ['acme.co.uk', 'acme.co.uk'],
    ['bücher.de', 'xn--bcher-kva.de'],
    ['@WWW.BÜCHER.de', 'xn--bcher-kva.de'],
    ['\uFF57\uFF57\uFF57.acme.com', 'acme.com'],
    ['acme\uFF0Ecom\u3002', 'acme.com'],
    [MAX_LENGTH_DOMAIN, MAX_LENGTH_DOMAIN],
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
    ['acme.com?ref=1'],
    ['acme%2ecom'],
    ['acme.com\\other.com'],
    ['\\acme.com'],
    ['acme.com\uFF3Cother.com'],
    ['acme.com\u0001'],
    ['jane@acme.com'],
    ['@@acme.com'],
    ['acme corp.com'],
    ['acme'],
    ['.com'],
    ['acme.'],
    ['.acme.com'],
    ['acme..com'],
    ['-acme.com'],
    ['acme_corp.com'],
    ['127.0.0.1'],
    [`a${'.'.repeat(16000)}b`],
    [`${'a'.repeat(250)}.com`],
    [`${'a'.repeat(63)}.${MAX_LENGTH_DOMAIN}`],
    [Array(4).fill('ü'.repeat(57)).join('.')],
  ])('rejects %p', (input) => {
    expect(parseCompanyDomainFilter(input)).toBeNull()
  })
})
