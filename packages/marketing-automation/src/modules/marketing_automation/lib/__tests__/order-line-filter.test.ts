import {
  PLACED_ORDER_FILTER_SQL,
  PLACED_ORDER_FILTER_SQL_ALIASED,
  PLACED_ORDER_LINE_FILTER_SQL_ALIASED,
} from '../order-filter'
import * as EXTERNAL_TABLES from '../external/tables'

/**
 * `sales_order_lines` carries `deleted_at` and not one of this module's ten line queries filtered it.
 *
 * So a line removed from an order went on counting as a purchase: a customer who had the one relevant product
 * taken off their order stayed in "bought SKU X" audiences, kept getting reorder reminders for it, and kept
 * seeing it excluded from their recommendations as something they already owned.
 */
const normalise = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

/**
 * Foreign table names are declared in `lib/external/tables.ts`, so the query text now interpolates a constant.
 *
 * This detector matched the literal `sales_order_lines l` and reported ZERO queries the moment they became
 * `${SALES_ORDER_LINES} l` — the exact rot this module's guidance warns about, a guard that has stopped
 * matching certifying a clean module for ever. It was caught only by the positive control below, which is why
 * that control exists.
 *
 * Resolving the constants rather than matching both spellings: the test asserts something about the SQL that
 * REACHES Postgres, and that is this string with the names substituted in. Matching the indirection would make
 * the next layer of indirection break it again.
 */
const resolveTableNames = (sql: string): string =>
  sql.replace(/\$\{([A-Z_]+)\}/g, (whole, name: string) => {
    const declared = (EXTERNAL_TABLES as Record<string, string | undefined>)[name]
    return declared ?? whole
  })

describe('the order filters', () => {
  it('say the same thing about an order, aliased or not', () => {
    // Two readable clauses kept in step, rather than one mangled at runtime.
    expect(normalise(PLACED_ORDER_FILTER_SQL_ALIASED)).toBe(
      normalise(PLACED_ORDER_FILTER_SQL).replace(/\b(tenant_id|organization_id|deleted_at|placed_at|status)\b/g, 'o.$1'),
    )
  })

  it('the line filter is the order filter plus the line soft delete', () => {
    const line = normalise(PLACED_ORDER_LINE_FILTER_SQL_ALIASED)
    expect(line).toContain('l.deleted_at is null')
    expect(line).toContain(normalise(PLACED_ORDER_FILTER_SQL_ALIASED))
  })

  /**
   * Kept separate on purpose: the funnel and the A/B revenue join orders ALONE, where `l` does not exist and
   * naming it would be a syntax error rather than a wrong answer.
   */
  it('the order-only filter never mentions a line', () => {
    expect(PLACED_ORDER_FILTER_SQL_ALIASED).not.toContain('l.')
    expect(PLACED_ORDER_FILTER_SQL).not.toContain('l.')
  })

  it('both scope by tenant and organization, which is what a consumer must not hand-roll', () => {
    for (const sql of [PLACED_ORDER_FILTER_SQL_ALIASED, PLACED_ORDER_LINE_FILTER_SQL_ALIASED]) {
      expect(sql).toContain('tenant_id = ?')
      expect(sql).toContain('organization_id = ?')
    }
  })
})

/**
 * Every QUERY that joins lines uses the line filter, and no query joining orders alone does.
 *
 * The defect was not one missing clause but ten, and the reason was that each site hand-rolled its own
 * subset — which is exactly what `order-filter.ts` exists to stop.
 *
 * Per query rather than per file: `subject-document.ts` holds both kinds, so a file-level rule either misses
 * the line queries or flags the order-only ones. The definition file is excluded because it is the only place
 * both constants legitimately appear outside a query.
 */
describe('every consumer', () => {
  const queries = (() => {
    const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const root = join(__dirname, '..')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (entry === '__tests__') return []
      return statSync(path).isDirectory() ? walk(path) : (entry.endsWith('.ts') ? [path] : [])
    })
    return walk(root)
      /**
       * The two files that DEFINE the fragments, rather than querying with them.
       *
       * `order-filter.ts` is where the predicates live and `external/joins.ts` is where the join shapes do, so
       * each legitimately holds a join without the predicate beside it — that is what being the definition
       * means. Every other file is a caller and must carry both.
       */
      .filter((path) => !path.endsWith('order-filter.ts'))
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        // Every SQL in this module is a backtick template; one entry per template.
        return [...source.matchAll(/`[^`]*`/g)]
          .map((match) => ({ path: path.slice(path.indexOf('/lib/')), sql: resolveTableNames(match[0]) }))
      })
  })()

  it('finds the queries it is meant to be guarding', () => {
    // A rename that empties this list would turn the suite into a silent pass.
    expect(queries.filter((query) => query.sql.includes('sales_order_lines l')).length).toBeGreaterThanOrEqual(8)
  })

  it('uses the line filter in every query that joins order lines', () => {
    const offenders = queries
      .filter((query) => query.sql.includes('sales_order_lines l'))
      .filter((query) => !query.sql.includes('${PLACED_ORDER_LINE_FILTER_SQL_ALIASED}'))
      .map((query) => query.path)
    expect(offenders).toEqual([])
  })

  it('never hand-rolls the order conditions in a query that joins lines', () => {
    const offenders = queries
      .filter((query) => query.sql.includes('sales_order_lines l'))
      .filter((query) => /not in \('canceled', 'cancelled'\)/.test(query.sql))
      .map((query) => query.path)
    expect(offenders).toEqual([])
  })
})
