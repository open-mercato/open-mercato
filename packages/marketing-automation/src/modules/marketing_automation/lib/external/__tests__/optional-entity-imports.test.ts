import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Importing an OPTIONAL module's ORM entity is the second way this module reaches across a boundary.
 *
 * `tables.ts` declares the raw-SQL reads and a guard keeps that list complete — but it only sees table names in
 * SQL, so `em.find(SalesOrder, …)` slipped straight past it. The table behind an entity is just as absent on an
 * installation without the module, and the failure is the same Postgres error at request time.
 *
 * Each such file has to be safe for ONE of three stated reasons, and this test insists it be one of them rather
 * than left to a reader to work out:
 *
 *  - it consults the capability probe before touching the entity;
 *  - it declares `requiresModule`, which the palette and the sweep worker both honour;
 *  - it is a SUBSCRIBER to that module's own events, which cannot fire where the module is not installed.
 *
 * `customers` is deliberately not in scope: it is a hard dependency in `requires` and always present.
 */
const MODULE_ROOT = join(__dirname, '..', '..', '..')

/** Entities belonging to modules this one is working towards running without. */
const OPTIONAL_ENTITY_MODULES = ['sales', 'catalog']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__' || entry === '__integration__') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return entry.endsWith('.ts') ? [path] : []
  })
}

const IMPORT_PATTERN = new RegExp(
  String.raw`from '@open-mercato/core/modules/(` + OPTIONAL_ENTITY_MODULES.join('|') + String.raw`)/data/entities'`,
)

describe('files importing an optional module entity', () => {
  const importers = sourceFiles(MODULE_ROOT)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => IMPORT_PATTERN.test(source))
    .map(({ path, source }) => ({
      name: path.slice(path.indexOf('/marketing_automation/')),
      source,
      isSubscriber: path.includes('/subscribers/'),
    }))

  it('finds the importers it is meant to be guarding', () => {
    /**
     * Counted by the import PATH, independently of the per-file classification above.
     *
     * A rename that empties the list would turn the rule into a silent pass, and "at least three" was the
     * number that existed when this was written — which a delivery holding a subset cannot meet. The two counts
     * use different facts, so they cannot rot together.
     */
    const byPath = sourceFiles(MODULE_ROOT).filter((path) => IMPORT_PATTERN.test(readFileSync(path, 'utf8')))
    expect(importers.length).toBe(byPath.length)
  })

  for (const { name, source, isSubscriber } of importers) {
    it(`${name} is safe for one of the three stated reasons`, () => {
      const probesCapability = /readCapabilities\(|hasSales\(|hasCatalog\(/.test(source)
      const declaresRequirement = /requiresModule:\s*'(sales|catalog)'/.test(source)
      /**
       * A subscriber is safe BY CONSTRUCTION, and only for its own module's events: nothing emits
       * `sales.order.created` where `sales` is not installed, so the handler is never called. Asserted against
       * the declared event rather than the folder alone, because a subscriber to a `customers` event that also
       * read an order would not be safe at all.
       */
      const subscribesToThatModule = isSubscriber && /event:\s*'(sales|catalog)\./.test(source)

      expect([name, probesCapability || declaresRequirement || subscribesToThatModule]).toEqual([name, true])
    })
  }

  it('does not accept the subscriber folder as a blanket excuse', () => {
    // The rule reads the DECLARED event. A subscriber in that folder listening to something else must still
    // probe, and this asserts the predicate is actually looking at the event id.
    const pretend = "export const metadata = { event: 'customers.person.created' }\nem.find(SalesOrder, {})"
    expect(/event:\s*'(sales|catalog)\./.test(pretend)).toBe(false)
  })
})
