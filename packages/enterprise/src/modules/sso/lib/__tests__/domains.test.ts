import { normalizeDomain, validateDomain, uniqueDomains, checkDomainLimit, MAX_DOMAINS_PER_CONFIG } from '../domains'

describe('domains', () => {
  describe('validateDomain', () => {
    test.each([
      'example.com',
      'sub.example.com',
      'my-domain.co.uk',
    ])('accepts valid domain: %s', (domain) => {
      expect(validateDomain(domain)).toEqual({ valid: true })
    })

    test('rejects empty string', () => {
      const result = validateDomain('')
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('rejects domain without dot (localhost)', () => {
      const result = validateDomain('localhost')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('dot')
    })

    test('rejects domain exceeding 253 characters', () => {
      const longDomain = `${'a'.repeat(250)}.com`
      const result = validateDomain(longDomain)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('253')
    })

    test('rejects domain with special characters', () => {
      const result = validateDomain('example .com')
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('rejects domain starting with hyphen', () => {
      const result = validateDomain('-example.com')
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('returns error message for invalid domains', () => {
      const result = validateDomain('')
      expect(typeof result.error).toBe('string')
      expect(result.error!.length).toBeGreaterThan(0)
    })
  })

  describe('normalizeDomain', () => {
    test('lowercases and trims', () => {
      expect(normalizeDomain('  Example.COM  ')).toBe('example.com')
    })
  })

  describe('uniqueDomains', () => {
    test('deduplicates normalized domains', () => {
      const result = uniqueDomains(['Example.com', 'example.com', 'EXAMPLE.COM'])
      expect(result).toEqual(['example.com'])
    })

    test('filters empty strings', () => {
      const result = uniqueDomains(['example.com', '', '  ', 'test.org'])
      expect(result).toEqual(['example.com', 'test.org'])
    })
  })

  describe('checkDomainLimit', () => {
    test('returns ok when under limit', () => {
      expect(checkDomainLimit(5, 3)).toEqual({ ok: true })
    })

    test('returns error when exceeding limit', () => {
      const result = checkDomainLimit(MAX_DOMAINS_PER_CONFIG, 1)
      expect(result.ok).toBe(false)
      expect(result.error).toContain(`${MAX_DOMAINS_PER_CONFIG}`)
    })

    test('returns error when at limit and adding more', () => {
      const result = checkDomainLimit(19, 2)
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
