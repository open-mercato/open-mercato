import { refreshValueBoundariesIfStale, VALUE_BOUNDARY_MAX_AGE_MS } from '../value-boundaries'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resetCapabilityCache } from '../capabilities'

/**
 * How often the most expensive statement in this module is allowed to run.
 *
 * The cut points are percentiles over every buyer in the tenant. The sweep comment said they were
 * "refreshed below once a day" and the code recomputed them on every hourly tick, so the whole cost was
 * paid twenty-four times to produce the same numbers. The opposite mistake is worse, though: with no row
 * at all a published "top 20% spenders" campaign enrols nobody, so an absent row refreshes immediately
 * whatever the clock says.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-10-02T12:00:00.000Z')

function fakeEm(computedAt: Date | null) {
  const executed: string[] = []
  const em = {
    findOne: async () => (computedAt
      ? { boundaries: {}, buyerCount: 10, computedAt }
      : null),
    // The capability probe. These tests are about a shop that HAS sales — there are no cut points to compute
    // without buyers — so it reports both present, and the cache is reset per test.
    execute: async () => [{ sales: true, catalog: true }],
    getConnection: () => ({
      execute: async (sql: string) => {
        executed.push(sql)
        return [{}]
      },
    }),
    nativeUpdate: async () => 1,
    create: () => ({}),
    persist: () => undefined,
    flush: async () => undefined,
  }
  return { em: em as unknown as EntityManager, executed }
}

describe('refreshValueBoundariesIfStale', () => {
  beforeEach(() => resetCapabilityCache())

  test('recomputes when there is no row, which is the first-sweep case', async () => {
    const { em, executed } = fakeEm(null)
    const result = await refreshValueBoundariesIfStale(em, scope, now)
    expect(result.refreshed).toBe(true)
    expect(executed.length).toBeGreaterThan(0)
  })

  test('leaves cut points computed an hour ago alone', async () => {
    const { em, executed } = fakeEm(new Date(now.getTime() - 60 * 60_000))
    const result = await refreshValueBoundariesIfStale(em, scope, now)
    expect(result.refreshed).toBe(false)
    // The negative control: the percentile statement did not run.
    expect(executed).toHaveLength(0)
  })

  test('recomputes once they are a day old', async () => {
    const { em, executed } = fakeEm(new Date(now.getTime() - VALUE_BOUNDARY_MAX_AGE_MS - 1000))
    const result = await refreshValueBoundariesIfStale(em, scope, now)
    expect(result.refreshed).toBe(true)
    expect(executed.length).toBeGreaterThan(0)
  })
})
