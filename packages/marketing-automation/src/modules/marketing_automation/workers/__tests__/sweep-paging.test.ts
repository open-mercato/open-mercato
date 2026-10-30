import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every paged loop in the sweep releases its page.
 *
 * Read from the source rather than exercised, because there is no seam to exercise: the three loops are internal
 * to the worker and each needs a database, a campaign, a customer population and a dispatcher behind it. A static
 * guard is what this module already does for the queue-name literals, and for the same reason — the mistake is an
 * omission somebody makes while editing, and it has no visible symptom until a tick walks thousands of rows and
 * the worker's memory grows for the whole tick.
 *
 * The row loop was the one that lacked it. It pages to `MAX_ROWS_PER_TICK`, which is twenty-five pages, so it
 * accumulated every row, every customer its subject documents touched and every run it created in one identity
 * map — while the two population scans beside it had cleared theirs since they were written.
 */
const source = readFileSync(join(__dirname, '..', 'sweep.ts'), 'utf8')

describe('sweep paging', () => {
  test('each page-advancing loop clears the identity map', () => {
    // `em.clear()` however the em is reached: a local alias, or through the deps object.
    const clears = source.match(/\.clear\(\)/g) ?? []
    const pagedLoops = source.match(/for \([^)]*PAGE_SIZE[^)]*\)|for \(;;\)/g) ?? []
    expect(clears.length).toBeGreaterThanOrEqual(pagedLoops.length)
  })

  test('the row loop in particular clears between pages', () => {
    const rowLoop = source.slice(source.indexOf('async function sweepRows'))
    expect(rowLoop.includes('.clear()')).toBe(true)
  })

  /**
   * And it only PAGES a source that hydrates entities.
   *
   * Paging protects the identity map, which is a problem only an entity source has. A raw-SQL source pays for
   * it instead: `reorderDue` groups the shop's whole order-line history and `birthdays` joins custom field
   * values to people, and Postgres has to compute the entire aggregate before it can skip to any offset — so
   * paging ran the same aggregation twenty-five times a tick for a result that does not change between pages.
   *
   * A static guard for the same reason as the one above: nothing observable changes if somebody deletes the
   * branch, except that the sweep quietly costs twenty-five times as much.
   */
  test('a raw-SQL source is collected once rather than paged', () => {
    const rowLoop = source.slice(source.indexOf('async function sweepRows'))
    expect(rowLoop).toContain('source.hydratesEntities ? PAGE_SIZE : MAX_ROWS_PER_TICK')
    // The single bulk read, and the loop reusing it rather than fetching again.
    expect(rowLoop).toMatch(/bulk\s*=\s*source\.hydratesEntities/)
    expect(rowLoop).toContain('bulk ?? await source.collect(')
  })
})
