jest.mock('@open-mercato/telemetry/nextjs-config', () => ({ telemetryServerExternalPackages: [] }))

// Regression guard for https://github.com/open-mercato/open-mercato/issues/1606:
// The app-wide CSP must allowlist Stripe's script and frame origins so that
// legitimate payment pages can load https://js.stripe.com/basil/stripe.js and
// render 3-D Secure iframes. Missing these directives manifested as a CSP
// violation in the browser console even after the payment-client side-effect
// leak onto non-payment pages was fixed.
describe('apps/mercato next.config CSP', () => {
  let directives: string[] = []

  beforeAll(async () => {
    const nodeEnvironment = jest.replaceProperty(process.env, 'NODE_ENV', 'production')
    try {
      const { default: nextConfig } = await import('../../next.config')
      const definitions = await nextConfig.headers?.()
      const appHeaders = definitions?.find((definition) => definition.source === '/:path*')?.headers
      const policy = appHeaders?.find((header) => header.key === 'Content-Security-Policy')?.value
      expect(policy).toBeDefined()
      directives = (policy ?? '').split('; ')
    } finally {
      nodeEnvironment.restore()
    }
  })

  function findSources(prefix: string): string[] {
    return directives.find((directive) => directive.startsWith(`${prefix} `))?.split(' ').slice(1) ?? []
  }

  it('allowlists https://js.stripe.com in script-src', () => {
    expect(findSources('script-src')).toEqual(expect.arrayContaining(['https://js.stripe.com']))
  })

  it('exposes a frame-src directive that allows Stripe.js and Stripe hooks', () => {
    expect(findSources('frame-src')).toEqual(expect.arrayContaining(['https://js.stripe.com', 'https://hooks.stripe.com']))
  })

  it('emits restrictive production script, style and connection permissions', () => {
    expect(findSources('script-src')).not.toContain("'unsafe-inline'")
    expect(findSources('script-src')).not.toContain("'unsafe-eval'")
    expect(findSources('style-src')).not.toContain("'unsafe-inline'")
    expect(findSources('connect-src')).not.toContain('https:')
    expect(findSources('connect-src')).not.toContain('ws:')
    expect(findSources('connect-src')).not.toContain('wss:')
  })
})
