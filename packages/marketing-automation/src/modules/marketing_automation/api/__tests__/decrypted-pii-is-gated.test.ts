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
