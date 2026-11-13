import {
  createContentSecurityPolicy,
  createContentSecurityPolicyRequestHeaders,
  devServerLoopbackFrameAncestorOrigins,
} from '../contentSecurityPolicy'

function directives(policy: string) {
  return Object.fromEntries(policy.split('; ').map((directive) => {
    const [name, ...sources] = directive.split(' ')
    return [name, sources]
  }))
}

describe('production content security policy', () => {
  it.each(['production', 'test', 'preview', undefined])('defaults to restrictive scripts and connections for %s', (NODE_ENV) => {
    const policy = directives(createContentSecurityPolicy({ env: { NODE_ENV }, nonce: 'trustedNonce' }))
    expect(policy['script-src']).toEqual(["'self'", "'nonce-trustedNonce'"])
    expect(policy['style-src']).toEqual(["'self'", "'nonce-trustedNonce'"])
    expect(policy['connect-src']).toEqual(["'self'"])
    expect(policy['script-src-attr']).toEqual(["'none'"])
    expect(policy['style-src-attr']).toEqual(["'unsafe-inline'"])
  })

  it('limits eval and websocket scheme permissions to development', () => {
    const policy = directives(createContentSecurityPolicy({ env: { NODE_ENV: 'development' }, nonce: 'trustedNonce' }))
    expect(policy['script-src']).toContain("'unsafe-eval'")
    expect(policy['style-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(policy['connect-src']).toEqual(["'self'", 'ws:', 'wss:'])
  })

  it('adds and deduplicates explicit operator and provider origins', () => {
    const policy = directives(createContentSecurityPolicy({
      env: {
        NODE_ENV: 'production',
        OM_CSP_CONNECT_ORIGINS: 'https://api.example.com/ wss://collab.example.com',
        OM_CSP_SCRIPT_ORIGINS: 'https://scripts.example.com',
        OM_CSP_STYLE_ORIGINS: 'https://styles.example.com',
        OM_CSP_FRAME_ORIGINS: 'https://frames.example.com',
      },
      connectOrigins: ['https://api.example.com'],
    }))
    expect(policy['connect-src']).toEqual(["'self'", 'https://api.example.com', 'wss://collab.example.com'])
    expect(policy['script-src']).toContain('https://scripts.example.com')
    expect(policy['style-src']).toContain('https://styles.example.com')
    expect(policy['frame-src']).toContain('https://frames.example.com')
  })

  it.each([
    'https:', 'wss:', '*', 'https://*.example.com', "'unsafe-eval'", 'https://api.example.com;script-src',
    'https://user:pass@api.example.com', 'https://api.example.com/path', 'https://api.example.com?q=1',
    'https://api.example.com#fragment', 'http://api.example.com', 'ws://api.example.com',
    'data:text/javascript,alert(1)', 'https://api.example.com\r\nscript-src',
  ])('rejects unsafe production connection configuration: %s', (origin) => {
    expect(() => createContentSecurityPolicy({ env: { NODE_ENV: 'production', OM_CSP_CONNECT_ORIGINS: origin } })).toThrow()
  })

  it('accepts explicit loopback HTTP/websocket tooling origins only in development', () => {
    const policy = directives(createContentSecurityPolicy({
      env: { NODE_ENV: 'development', OM_CSP_CONNECT_ORIGINS: 'http://localhost:3001 ws://localhost:3002' },
    }))
    expect(policy['connect-src']).toContain('http://localhost:3001')
    expect(policy['connect-src']).toContain('ws://localhost:3002')
  })

  it('keeps same-origin framing unless frame ancestors are passed explicitly', () => {
    expect(directives(createContentSecurityPolicy())['frame-ancestors']).toEqual(["'self'"])
    expect(directives(createContentSecurityPolicy({ frameAncestorOrigins: devServerLoopbackFrameAncestorOrigins }))['frame-ancestors'])
      .toEqual(["'self'", 'http://localhost:*', 'http://127.0.0.1:*'])
  })

  it('replaces attacker-supplied nonce and request policy with fresh matching values', () => {
    const original = new Headers({ 'x-nonce': 'attacker', 'Content-Security-Policy': "script-src 'unsafe-inline'", 'x-next-url': '/backend' })
    const first = createContentSecurityPolicyRequestHeaders(original, { env: { NODE_ENV: 'production' } })
    const second = createContentSecurityPolicyRequestHeaders(original, { env: { NODE_ENV: 'production' } })
    const nonce = first.requestHeaders.get('x-nonce')
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(second.requestHeaders.get('x-nonce')).not.toBe(nonce)
    expect(first.contentSecurityPolicy).toContain(`'nonce-${nonce}'`)
    expect(first.requestHeaders.get('Content-Security-Policy')).toBe(first.contentSecurityPolicy)
    expect(first.requestHeaders.get('x-next-url')).toBe('/backend')
    expect(original.get('x-nonce')).toBe('attacker')
  })

  it('rejects a nonce that could inject a directive', () => {
    expect(() => createContentSecurityPolicy({ nonce: "value'; script-src *" })).toThrow()
  })
})
