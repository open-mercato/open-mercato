import fs from 'node:fs'
import path from 'node:path'

// Regression guard for https://github.com/open-mercato/open-mercato/issues/1606:
// The app-wide CSP must allowlist Stripe's script and frame origins so that
// legitimate payment pages can load https://js.stripe.com/basil/stripe.js and
// render 3-D Secure iframes. Missing these directives manifested as a CSP
// violation in the browser console even after the payment-client side-effect
// leak onto non-payment pages was fixed.
describe('apps/mercato next.config CSP', () => {
  const nextConfigSource = fs.readFileSync(
    path.resolve(__dirname, '../../next.config.ts'),
    'utf8',
  )

  const cspBlockMatch = nextConfigSource.match(/const contentSecurityPolicy = \[([\s\S]*?)\]\.join/)
  const cspBlock = cspBlockMatch?.[1] ?? ''
  const directives = cspBlock
    .split('\n')
    .map((line) => line.replace(/^[\s,"]+|[\s,"]+$/g, ''))
    .filter((line) => line.length > 0)

  function findDirective(prefix: string): string | undefined {
    return directives.find((line) => line.startsWith(`${prefix} `))
  }

  it('allowlists https://js.stripe.com in script-src', () => {
    const scriptSrc = findDirective('script-src')
    expect(scriptSrc).toBeDefined()
    expect(scriptSrc).toContain('https://js.stripe.com')
  })

  it('exposes a frame-src directive that allows Stripe.js and Stripe hooks', () => {
    const frameSrc = findDirective('frame-src')
    expect(frameSrc).toBeDefined()
    expect(frameSrc).toContain('https://js.stripe.com')
    expect(frameSrc).toContain('https://hooks.stripe.com')
  })
})
