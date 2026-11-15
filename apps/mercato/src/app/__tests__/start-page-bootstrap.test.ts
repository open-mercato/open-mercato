import fs from 'node:fs'
import path from 'node:path'

/**
 * `/start` reads the database counters through `createRequestContainer()` and gates the
 * self-service onboarding CTA on `isEmailDeliveryConfigured()`. Both depend on the process
 * having been bootstrapped: the container throws until `registerDiRegistrars()` has run, and
 * the email transport the capability check reads is registered by a module's DI `register()`.
 *
 * Neither failure is visible — the container error is swallowed into the database panel and the
 * missing transport just reads as "email is not configured" — so the page answered a cold
 * process with an error panel and no CTA on a fully configured instance, then corrected itself
 * once any API route bootstrapped the process (#5817). Asserting the call is a statement at
 * module scope, rather than merely that the identifier appears, keeps an import-only or
 * inside-a-branch regression from passing.
 */
describe('start page bootstrap', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/start/page.tsx'), 'utf8')

  it('imports the full app bootstrap', () => {
    expect(source).toMatch(/^import \{ bootstrap \} from '@\/bootstrap'$/m)
  })

  it('invokes it at module scope, before any request is served', () => {
    const moduleScopeCall = /^bootstrap\(\)$/m
    expect(source).toMatch(moduleScopeCall)

    const callIndex = source.search(moduleScopeCall)
    const defaultExportIndex = source.indexOf('export default async function StartPage')
    expect(callIndex).toBeGreaterThan(-1)
    expect(defaultExportIndex).toBeGreaterThan(-1)
    expect(callIndex).toBeLessThan(defaultExportIndex)
  })
})
