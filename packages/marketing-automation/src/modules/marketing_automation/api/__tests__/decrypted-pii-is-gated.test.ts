import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A route that decrypts a customer must also check the feature that protects them.
 *
 * `display_name` and `primary_email` are GDPR-encrypted at rest, and `findWithDecryption` decrypts on tenant
 * scope alone — there is no permission check anywhere in that path. `customers.people.view` is the grant that
 * guards contact data, and a marketing role can hold `marketing_automation.*` without it, so a route that
 * hands back a decrypted name under a marketing feature alone is a way to read the CRM without the permission
 * that protects it.
 *
 * Written after exactly that happened here. The runs list printed eight characters of a subject id; a change
 * replaced them with the customer's name and address and left the guard as it was. Nothing failed — the names
 * were correct, the tests passed, and the route quietly became a bulk export of every enrolled customer's
 * contact details.
 *
 * Two spellings satisfy the rule, and both are in use in this module: naming the feature in `requireFeatures`,
 * or a second `userHasAllFeatures` check inside the handler for a route that stays readable without it and
 * withholds only the CRM fields.
 */
const API_ROOT = join(__dirname, '..')

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__') return []
    if (statSync(path).isDirectory()) return routeFiles(path)
    return entry === 'route.ts' ? [path] : []
  })
}

describe('routes that decrypt a customer', () => {
  const decrypting = routeFiles(API_ROOT)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /findWithDecryption|findOneWithDecryption/.test(source))

  it('finds the routes it is meant to be guarding', () => {
    // A rename that empties this list would turn the whole suite into a silent pass.
    expect(decrypting.length).toBeGreaterThanOrEqual(4)
  })

  for (const { path, source } of decrypting) {
    const name = path.slice(path.indexOf('/api/') + 1)
    it(`${name} checks customers.people.view`, () => {
      const declared = /requireFeatures:\s*\[[^\]]*'customers\.people\.view'/.test(source)
      const checkedInline = source.includes("'customers.people.view'") && source.includes('userHasAllFeatures')
      expect(declared || checkedInline).toBe(true)
    })
  }
})

/**
 * A route that interpolates a subject document into AUTHORED copy must check the same feature.
 *
 * This is the second way the module reaches decrypted data, and the finders above do not see it:
 * `buildSubjectDocument` does the decrypting one call deeper, so a route that never names a finder can
 * still hand back a customer's name, address and order history. `lib/interpolate.ts` resolves any context
 * path, so the documented placeholder list is a hint rather than a fence — whatever is in the document can
 * be pulled into the copy by whoever wrote the copy.
 *
 * Written after `test-send` did exactly that: `marketing_automation.test_dispatch` alone was enough to have
 * it build any customer's document, interpolate it and mail the result to the caller's own address, while
 * the sibling `render` route already gated the identical operation.
 *
 * Building a document is deliberately NOT the trigger for this rule. `preview` and `test-dispatch` build one
 * and return fixed projections with no decrypted field in them (step ids, lane assignment, `hasEmail` as a
 * boolean); requiring the grant there would withhold nothing. `explain` is the one case worth revisiting: it
 * returns the recipient's own `timeZone` and local hour, read from the encrypted `customer_people.timezone`,
 * under `marketing_automation.runs.view` alone. That is a narrower exposure than a name or an address and it
 * is load-bearing for the screen's whole answer ("it is waiting for nine o'clock their time"), so it is
 * recorded here as a known gap rather than closed by a detector change.
 */
describe('routes that interpolate a subject document into authored copy', () => {
  const interpolating = routeFiles(API_ROOT)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /renderEmail|renderValuesFromDocument/.test(source))

  it('finds the routes it is meant to be guarding', () => {
    expect(interpolating.length).toBeGreaterThanOrEqual(2)
  })

  for (const { path, source } of interpolating) {
    const name = path.slice(path.indexOf('/api/') + 1)
    it(`${name} checks customers.people.view`, () => {
      const declared = /requireFeatures:\s*\[[^\]]*'customers\.people\.view'/.test(source)
      const checkedInline = source.includes("'customers.people.view'") && source.includes('userHasAllFeatures')
      expect(declared || checkedInline).toBe(true)
    })

    /**
     * The gate has to decide whether the DOCUMENT is built, not merely what is shown afterwards:
     * building it and then hiding one field leaves every other field reachable through the copy.
     */
    it(`${name} drops the subject rather than filtering the rendered output`, () => {
      expect(/subjectEntityId && mayReadSubject/.test(source)).toBe(true)
    })
  }
})
