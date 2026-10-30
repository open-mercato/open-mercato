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

  it('finds every route that decrypts, counted a second way', () => {
    /**
     * The control, and it carries no NUMBER on purpose.
     *
     * A rename that empties the list would turn the whole suite into a silent pass, so the control has to
     * notice — but "at least four" was only ever "the number that existed when this was written", which makes
     * the guard fail in any delivery that contains a subset of the module. Counting the same thing by a second
     * route is exact wherever it runs: every file under `api/` whose text names a decrypting finder must be in
     * the list the rule iterates.
     */
    const byPlainScan = routeFiles(API_ROOT).filter((path) =>
      /findWithDecryption|findOneWithDecryption/.test(readFileSync(path, 'utf8')),
    )
    expect(decrypting.map(({ path }) => path).sort()).toEqual(byPlainScan.sort())
    // And it must find something, or both routes agree on nothing and prove nothing.
    expect(decrypting.length).toBeGreaterThan(0)
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

/**
 * A route that builds a subject document must check the same feature.
 *
 * This is the second way the module reaches decrypted data, and the finders above cannot see it:
 * `buildSubjectDocument` does the decrypting one call deeper, so a route that never names a finder
 * still returns a customer's name, email, order history, tags, addresses and scores.
 *
 * The rule used to stop at the finders, and `test-send` was the hole that left: holding
 * `marketing_automation.test_dispatch` alone was enough to have it build any customer's document,
 * interpolate it into the copy and mail the result to the caller's own address.
 *
 * Returning a FIXED PROJECTION of the document is not a defence, and an earlier version of this file
 * claimed it was. `preview`, `test-dispatch` and `explain` each evaluate the campaign's own audience
 * against the document and return the verdict — `entered`, `inAudience`, an audience gate outcome.
 * That audience is an author-controlled predicate over any dotted path (`lib/engine/audience.ts`
 * resolves `leaf.field` through `getNestedValue`, and `business_rules` validates that path for length
 * and nothing else), and the same `campaigns.manage` that saves it reads the verdict back. One
 * returned boolean is therefore a one-bit oracle over the entire record, `STARTS_WITH` at a time. The
 * gate has to decide whether the document is BUILT.
 */
describe('routes that build a subject document', () => {
  const building = routeFiles(API_ROOT)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /buildSubjectDocument/.test(source))

  it('finds every route that builds a document, or says why there are none', () => {
    /**
     * A control that survives a partial delivery, without going vacuous.
     *
     * Counting a second way keeps it exact. But a delivery that does not yet contain the document BUILDER has
     * no routes to find, and demanding at least one would fail for the right reason in the wrong place — while
     * demanding nothing would let the rule pass silently if the detector broke.
     *
     * So the emptiness is tied to a checkable fact instead of a number: no routes means the builder itself is
     * absent from this tree. If it IS here and the list is empty, the detector has stopped matching and this
     * fails, which is exactly what a control is for.
     */
    /**
     * Counted by the IMPORT rather than by the call, which is what makes it independent.
     *
     * A second count using the same regex as the detector proves nothing: if that regex rots, both sides go to
     * zero together and the comparison passes. The import path and the call site are two different facts about
     * the same file, so they would have to rot in step — and a delivery containing none of these routes gets an
     * honest empty set from both, with nothing invented to keep a threshold happy.
     */
    const byImport = routeFiles(API_ROOT).filter((path) =>
      /from '[^']*subject-document/.test(readFileSync(path, 'utf8')),
    )
    expect(building.map(({ path }) => path).sort()).toEqual(byImport.sort())
  })

  for (const { path, source } of building) {
    const name = path.slice(path.indexOf('/api/') + 1)
    it(`${name} checks customers.people.view`, () => {
      const declared = /requireFeatures:\s*\[[^\]]*'customers\.people\.view'/.test(source)
      const checkedInline = source.includes('mayReadSubjectPii')
        || (source.includes("'customers.people.view'") && source.includes('userHasAllFeatures'))
      expect(declared || checkedInline).toBe(true)
    })

    /**
     * The check has to come BEFORE the document exists. Building it and then hiding one field leaves
     * every other field reachable through the audience verdict.
     */
    it(`${name} decides the grant before building the document`, () => {
      if (/requireFeatures:\s*\[[^\]]*'customers\.people\.view'/.test(source)) return
      expect(source.indexOf('mayReadSubjectPii(')).toBeLessThan(source.indexOf('buildSubjectDocument('))
    })
  }
})
