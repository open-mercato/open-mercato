import { isSafeRelativeReturnPath, resolveGatewayReturnUrl } from '../gatewayReturnUrl'

const ORIGINAL_ENV = { ...process.env }

function resetOrigins() {
  delete process.env.APP_URL
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.CHECKOUT_ALLOWED_ORIGINS
}

describe('gatewayReturnUrl', () => {
  beforeEach(resetOrigins)
  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  describe('isSafeRelativeReturnPath', () => {
    it.each(['/', '/checkout/success', '/a?b=c#d'])('accepts %s', (value) => {
      expect(isSafeRelativeReturnPath(value)).toBe(true)
    })

    it.each(['', 'success', 'https://evil.example', '//evil.example', '/\\evil.example', '/a\tb', 'javascript:alert(1)'])(
      'rejects %j',
      (value) => {
        expect(isSafeRelativeReturnPath(value)).toBe(false)
      },
    )
  })

  describe('resolveGatewayReturnUrl', () => {
    it('returns undefined when no path is given', () => {
      expect(resolveGatewayReturnUrl(null, null)).toBeUndefined()
      expect(resolveGatewayReturnUrl(undefined, null)).toBeUndefined()
    })

    it('resolves against the server-configured origin, never the request host', () => {
      process.env.APP_URL = 'https://shop.example.com/some/path'
      const request = new Request('https://attacker.example/api/checkout/sessions/current/submit')

      expect(resolveGatewayReturnUrl('/checkout/success', request)).toBe('https://shop.example.com/checkout/success')
    })

    it('prefers CHECKOUT_ALLOWED_ORIGINS over APP_URL ordering only by configuration order', () => {
      process.env.CHECKOUT_ALLOWED_ORIGINS = 'https://pay.example.com'
      process.env.APP_URL = 'https://shop.example.com'

      expect(resolveGatewayReturnUrl('/ok', null)).toBe('https://pay.example.com/ok')
    })

    it('rejects absolute and protocol-relative values with 422', () => {
      process.env.APP_URL = 'https://shop.example.com'

      for (const value of ['https://evil.example', '//evil.example/x', '/\\evil.example']) {
        expect(() => resolveGatewayReturnUrl(value, null)).toThrow(expect.objectContaining({ status: 422 }))
      }
    })

    it('falls back to the request origin only on loopback', () => {
      expect(resolveGatewayReturnUrl('/ok', new Request('http://localhost:3000/x'))).toBe('http://localhost:3000/ok')
    })

    it('rejects with 500 when no origin is configured on a non-loopback host', () => {
      expect(() => resolveGatewayReturnUrl('/ok', new Request('https://merchant.example/x'))).toThrow(
        expect.objectContaining({ status: 500 }),
      )
    })
  })
})
