import fs from 'node:fs'
import path from 'node:path'

// Regression guard for https://github.com/open-mercato/open-mercato/issues/1606:
// The embedded payments client must never import `loadStripe` from the default
// `@stripe/stripe-js` entry, because that entry eagerly fetches
// https://js.stripe.com/basil/stripe.js as an import side effect. Since this
// client module is side-effect-imported on every page via the generated
// `payments.client.generated` bootstrap, a non-pure import leaks Stripe.js onto
// unrelated admin routes (e.g., /backend/rules/*) and triggers CSP violations.
describe('gateway-stripe payments client', () => {
  const clientSource = fs.readFileSync(
    path.resolve(__dirname, '../widgets/payments/client.tsx'),
    'utf8',
  )

  it('imports loadStripe from @stripe/stripe-js/pure to avoid side-effect script loading', () => {
    expect(clientSource).toMatch(/from ['"]@stripe\/stripe-js\/pure['"]/)
  })

  it('never imports loadStripe from the non-pure @stripe/stripe-js entry', () => {
    const runtimeImport = /import\s+\{[^}]*\bloadStripe\b[^}]*\}\s+from\s+['"]@stripe\/stripe-js['"]/
    expect(clientSource).not.toMatch(runtimeImport)
  })
})
