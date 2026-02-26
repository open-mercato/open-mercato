import { resolveLocaleFromRequest } from '../locale'

function makeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

describe('resolveLocaleFromRequest', () => {
  describe('query parameter', () => {
    it('returns locale from ?locale= query param', () => {
      const req = makeRequest('https://example.com/api/products?locale=de')
      expect(resolveLocaleFromRequest(req)).toBe('de')
    })

    it('returns locale from query param with other params', () => {
      const req = makeRequest('https://example.com/api/products?page=1&locale=fr&pageSize=10')
      expect(resolveLocaleFromRequest(req)).toBe('fr')
    })

    it('ignores query param shorter than 2 chars', () => {
      const req = makeRequest('https://example.com/api/products?locale=x')
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })

    it('ignores query param longer than 10 chars', () => {
      const req = makeRequest('https://example.com/api/products?locale=abcdefghijk')
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })
  })

  describe('X-Locale header', () => {
    it('returns locale from X-Locale header', () => {
      const req = makeRequest('https://example.com/api/products', { 'x-locale': 'es' })
      expect(resolveLocaleFromRequest(req)).toBe('es')
    })

    it('ignores X-Locale header shorter than 2 chars', () => {
      const req = makeRequest('https://example.com/api/products', { 'x-locale': 'a' })
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })

    it('ignores X-Locale header longer than 10 chars', () => {
      const req = makeRequest('https://example.com/api/products', { 'x-locale': 'abcdefghijk' })
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })
  })

  describe('cookie', () => {
    it('returns locale from cookie', () => {
      const req = makeRequest('https://example.com/api/products', { cookie: 'locale=pl' })
      expect(resolveLocaleFromRequest(req)).toBe('pl')
    })

    it('extracts locale from cookie among other cookies', () => {
      const req = makeRequest('https://example.com/api/products', { cookie: 'session=abc; locale=de; theme=dark' })
      expect(resolveLocaleFromRequest(req)).toBe('de')
    })

    it('ignores cookie value shorter than 2 chars', () => {
      const req = makeRequest('https://example.com/api/products', { cookie: 'locale=x' })
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })
  })

  describe('Accept-Language header', () => {
    it('returns matching locale from Accept-Language (single supported)', () => {
      const req = makeRequest('https://example.com/api/products', { 'accept-language': 'pl;q=1.0' })
      expect(resolveLocaleFromRequest(req)).toBe('pl')
    })

    it('matches first supported locale found in Accept-Language', () => {
      // locales array is ['en', 'pl', 'es', 'de'] — en is checked first
      const req = makeRequest('https://example.com/api/products', { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' })
      expect(resolveLocaleFromRequest(req)).toBe('en')
    })

    it('returns de when Accept-Language only contains de', () => {
      const req = makeRequest('https://example.com/api/products', { 'accept-language': 'de-DE,de;q=0.9' })
      expect(resolveLocaleFromRequest(req)).toBe('de')
    })

    it('returns null when Accept-Language has no matching locale', () => {
      const req = makeRequest('https://example.com/api/products', { 'accept-language': 'ja,zh;q=0.9' })
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })
  })

  describe('priority ordering', () => {
    it('query param takes priority over header', () => {
      const req = makeRequest('https://example.com/api/products?locale=de', { 'x-locale': 'fr' })
      expect(resolveLocaleFromRequest(req)).toBe('de')
    })

    it('X-Locale header takes priority over cookie', () => {
      const req = makeRequest('https://example.com/api/products', { 'x-locale': 'es', cookie: 'locale=pl' })
      expect(resolveLocaleFromRequest(req)).toBe('es')
    })

    it('cookie takes priority over Accept-Language', () => {
      const req = makeRequest('https://example.com/api/products', { cookie: 'locale=de', 'accept-language': 'en,pl;q=0.9' })
      expect(resolveLocaleFromRequest(req)).toBe('de')
    })
  })

  describe('fallback', () => {
    it('returns null when no locale source is present', () => {
      const req = makeRequest('https://example.com/api/products')
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })

    it('returns null when all sources are empty', () => {
      const req = makeRequest('https://example.com/api/products', { cookie: 'session=abc' })
      expect(resolveLocaleFromRequest(req)).toBeNull()
    })
  })
})
