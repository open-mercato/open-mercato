import { findRowSweepSource, REORDER_DUE_SOURCE_ID, sweepSourceCatalog } from '../sweep-sources'

/**
 * The reorder source: what it asks the database, and how it pages.
 *
 * Driven through a fake connection, because the interesting parts are the query it builds and the claims it
 * produces — the cadence arithmetic itself is tested directly in `lib/engine/__tests__/reorder.test.ts`.
 */
function fakeEm(rows: Array<{ customer_entity_id: string; sku: string; purchased_at: Array<Date | string> }>) {
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const em = {
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        executed.push({ sql, params })
        return rows
      },
    }),
  }
  return { em: em as never, executed }
}

const scope = { tenantId: 't1', organizationId: 'o1' }
const NOW = new Date('2026-09-29T00:00:00.000Z')
const MS_PER_DAY = 86_400_000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * MS_PER_DAY)

describe('the reorder sweep source', () => {
  const source = findRowSweepSource(REORDER_DUE_SOURCE_ID)!

  test('is registered and offered to an author', () => {
    expect(source).toBeTruthy()
    expect(sweepSourceCatalog().map((entry) => entry.id)).toContain(REORDER_DUE_SOURCE_ID)
  })

  /**
   * Candidate PAIRS, not customers: a shop's (customer, product) history is far larger than its customer list,
   * so the worker's paging has to page over pairs — and that only works if the order is total.
   */
  test('groups by customer and sku, orders totally and takes an offset', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, NOW, 200, 400)
    const { sql, params } = executed[0]
    expect(sql).toContain('group by 1, 2')
    expect(sql).toContain('order by o.customer_entity_id, 2')
    expect(sql).toContain('limit ? offset ?')
    expect(params.slice(-2)).toEqual([200, 400])
  })

  test('the database discards pairs that can never have a cadence', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, NOW, 10)
    // Cheap half of the filter in SQL: fewer than three purchases cannot produce an interval.
    expect(executed[0].sql).toContain('having count(distinct o.id) >= ?')
    expect(executed[0].params).toContain(3)
  })

  test('reads the sku from the catalogue SNAPSHOT, so a renamed product still counts', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, NOW, 10)
    expect(executed[0].sql).toContain("catalog_snapshot -> 'product' ->> 'sku'")
  })

  test('produces a candidate for somebody who is due, with the copy context', async () => {
    const { em } = fakeEm([
      { customer_entity_id: 'c1', sku: 'COFFEE-1KG', purchased_at: [daysAgo(31), daysAgo(61), daysAgo(91)] },
    ])
    const [candidate] = await source.collect(em, scope, {}, NOW, 10)
    expect(candidate.subjectEntityId).toBe('c1')
    // "Your coffee usually lasts you about a month" is a sentence only this context makes possible.
    expect(candidate.trigger).toMatchObject({ sku: 'COFFEE-1KG', cycleDays: 30, daysSinceLast: 31, purchases: 3 })
  })

  test('says nothing about somebody who just bought', async () => {
    const { em } = fakeEm([
      { customer_entity_id: 'c1', sku: 'COFFEE-1KG', purchased_at: [daysAgo(1), daysAgo(31), daysAgo(61)] },
    ])
    expect(await source.collect(em, scope, {}, NOW, 10)).toEqual([])
  })

  /**
   * `withinDays` means a PERCENTAGE of the cycle here, not a window of days — the one source where it does, and
   * the label says so. Ten per cent of a monthly habit is three days early.
   */
  test('the parameter brings the reminder forward as a share of the cycle', async () => {
    const rows = [
      { customer_entity_id: 'c1', sku: 'COFFEE-1KG', purchased_at: [daysAgo(27), daysAgo(57), daysAgo(87)] },
    ]
    expect(await source.collect(fakeEm(rows).em, scope, { withinDays: 0 }, NOW, 10)).toEqual([])
    expect(await source.collect(fakeEm(rows).em, scope, { withinDays: 20 }, NOW, 10)).toHaveLength(1)
  })

  /**
   * Once per cycle: the claim is what stops this being either a single reminder forever or a daily nag.
   */
  test('claims each cycle separately, and each sku separately', async () => {
    const coffee = [{ customer_entity_id: 'c1', sku: 'COFFEE', purchased_at: [daysAgo(31), daysAgo(61), daysAgo(91)] }]
    const laterCycle = [{ customer_entity_id: 'c1', sku: 'COFFEE', purchased_at: [daysAgo(61), daysAgo(91), daysAgo(121)] }]
    const filters = [{ customer_entity_id: 'c1', sku: 'FILTERS', purchased_at: [daysAgo(31), daysAgo(61), daysAgo(91)] }]

    const [first] = await source.collect(fakeEm(coffee).em, scope, {}, NOW, 10)
    const [second] = await source.collect(fakeEm(laterCycle).em, scope, {}, NOW, 10)
    const [other] = await source.collect(fakeEm(filters).em, scope, {}, NOW, 10)

    expect(first.claimKey).toBeTruthy()
    // A later cycle of the same habit is a new claim, so the customer is reminded again next month.
    expect(second.claimKey).not.toBe(first.claimKey)
    // Being due for coffee says nothing about being due for filters.
    expect(other.claimKey).not.toBe(first.claimKey)
  })

  test('the same tick twice produces the same claim, so a retry does not nag', async () => {
    const rows = [{ customer_entity_id: 'c1', sku: 'COFFEE', purchased_at: [daysAgo(31), daysAgo(61), daysAgo(91)] }]
    const [first] = await source.collect(fakeEm(rows).em, scope, {}, NOW, 10)
    const [again] = await source.collect(fakeEm(rows).em, scope, {}, NOW, 10)
    expect(again.claimKey).toBe(first.claimKey)
  })

  test('drops a row with no usable dates rather than guessing', async () => {
    const { em } = fakeEm([{ customer_entity_id: 'c1', sku: 'X', purchased_at: ['not a date'] }])
    expect(await source.collect(em, scope, {}, NOW, 10)).toEqual([])
  })
})
