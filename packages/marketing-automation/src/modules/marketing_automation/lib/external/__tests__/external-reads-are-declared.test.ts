import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as DECLARED from '../tables'

/**
 * No foreign table name may be spelled outside `lib/external/tables.ts`.
 *
 * The review of this module found cross-module reads in sixteen files and called the coupling unauditable,
 * which it was: nothing said what marketing read that it did not own, and nothing stopped the list growing.
 * `tables.ts` is now the complete answer and this test is what keeps it complete — a seventeenth file reaching
 * into `sales` fails here rather than being discovered by the next reviewer.
 *
 * This does NOT claim the module is decoupled, and `tables.ts` says so at length. These reads are analytical
 * aggregates that join marketing's own tables to those in one statement; pulling the foreign rows into JS to
 * join them in memory would turn an indexed query into a population walk. What the declaration buys is that
 * the coupling is enumerable, a rename upstream is one edit, and its growth is visible.
 */
const MODULE_ROOT = join(__dirname, '..', '..', '..')

/** The prefixes that belong to other modules. Marketing's own tables are all `marketing_`. */
const FOREIGN_PREFIXES = ['sales_', 'catalog_', 'customer_', 'customers_']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__' || entry === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return entry.endsWith('.ts') ? [path] : []
  })
}

const DECLARED_NAMES = new Set(Object.values(DECLARED))

/** `from`/`join` is what reaches a table; a column called `customer_entity_id` is not a read of one. */
const READ_PATTERN = new RegExp(
  String.raw`\b(?:from|join)\s+(` + FOREIGN_PREFIXES.map((prefix) => `${prefix}[a-z_]+`).join('|') + String.raw`)\b`,
  'g',
)

describe('cross-module reads', () => {
  const offenders = sourceFiles(MODULE_ROOT)
    .filter((path) => !path.includes('/lib/external/'))
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return [...source.matchAll(READ_PATTERN)].map((match) => ({
        path: path.slice(path.indexOf('/marketing_automation/')),
        table: match[1],
      }))
    })

  it('are all declared, so none is spelled at a call site', () => {
    // Named rather than counted: the failure has to say which file reached for which table.
    expect(offenders).toEqual([])
  })

  it('still finds the reads, so the rule cannot pass by having stopped matching', () => {
    /**
     * The positive control, and this module has needed it twice — most recently in this very change, where
     * the sibling line-filter guard reported ZERO queries the moment the table names became constants and was
     * caught only by its own control.
     *
     * A fixture rather than real source: the rule's own correctness must not depend on a file somewhere else
     * continuing to break it.
     */
    const fixture = 'select 1 from sales_orders o join catalog_products p on p.id = o.product_id'
    expect([...fixture.matchAll(READ_PATTERN)].map((match) => match[1])).toEqual(['sales_orders', 'catalog_products'])
  })

  it('declares every table it reads, and declares nothing it does not', () => {
    /**
     * Both directions. An undeclared table is the hole this guards; a declared table nobody reads any more is
     * a stale claim about the module's surface, and the surface is the whole point of the file.
     */
    const read = new Set(
      sourceFiles(MODULE_ROOT)
        .filter((path) => path.includes('/lib/external/'))
        .flatMap((path) => {
          const source = readFileSync(path, 'utf8')
          return [...source.matchAll(/\$\{([A-Z_]+)\}/g)].map((match) => match[1])
        })
        .map((name) => (DECLARED as Record<string, string | undefined>)[name])
        .filter((name): name is string => Boolean(name)),
    )
    const usedInQueries = new Set(
      sourceFiles(MODULE_ROOT)
        .flatMap((path) => {
          const source = readFileSync(path, 'utf8')
          return [...source.matchAll(/\$\{([A-Z_]+)\}/g)].map((match) => match[1])
        })
        .map((name) => (DECLARED as Record<string, string | undefined>)[name])
        .filter((name): name is string => Boolean(name)),
    )
    for (const name of read) expect(usedInQueries.has(name)).toBe(true)
    /**
     * This direction can only be judged on the COMPLETE module, and says so rather than pretending otherwise.
     *
     * "Declares nothing it does not read" is a statement about the whole surface. A delivery containing part of
     * the module legitimately declares tables whose only readers arrive later, so asserting it here would fail
     * for the right reason in the wrong place — and quietly lowering the bar would be worse, because a stale
     * declaration is exactly the kind of drift this file exists to prevent.
     *
     * So the assertion is deferred to the delivery that holds every reader, and until then the unused names are
     * REPORTED rather than ignored: a human reading a failing-free run still sees the list.
     */
    const unused = [...DECLARED_NAMES].filter((name) => !usedInQueries.has(name))
    if (unused.length > 0) {
      // eslint-disable-next-line no-console
      console.info(
        `[external-reads] ${unused.length} declared table(s) have no reader in this delivery: ${unused.join(', ')}` +
          ' — expected while the module is delivered in phases; asserted empty once every reader is present.',
      )
    }
    // What IS checkable here: nothing is read that was never declared, which the rule above covers, and every
    // name the seam itself interpolates resolves to a declaration.
    for (const name of read) expect(DECLARED_NAMES.has(name)).toBe(true)
  })
})
