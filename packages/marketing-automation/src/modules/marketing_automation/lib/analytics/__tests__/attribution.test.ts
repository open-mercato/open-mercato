import { attributeLinear, loadAttribution } from '../attribution'
import type { AttributionTouch } from '../attribution'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resetCapabilityCache } from '../../capabilities'

const touch = (orderId: string, campaignId: string, orderTotal: number, currencyCode = 'PLN'): AttributionTouch =>
  ({ orderId, campaignId, orderTotal, currencyCode })

describe('attributeLinear', () => {
  test('a single touch takes the whole order', () => {
    expect(attributeLinear([touch('o1', 'c1', 100)])).toEqual([
      { campaignId: 'c1', currencyCode: 'PLN', orders: 1, revenue: 100 },
    ])
  })

  test('two campaigns split one order equally', () => {
    const rows = attributeLinear([touch('o1', 'c1', 100), touch('o1', 'c2', 100)])
    expect(rows).toEqual([
      { campaignId: 'c1', currencyCode: 'PLN', orders: 1, revenue: 50 },
      { campaignId: 'c2', currencyCode: 'PLN', orders: 1, revenue: 50 },
    ])
  })

  // The shares of one order must add up to that order, or the report claims revenue the shop never took.
  test('the shares of an order sum to the order', () => {
    const rows = attributeLinear([
      touch('o1', 'c1', 100), touch('o1', 'c2', 100), touch('o1', 'c3', 100),
    ])
    const total = rows.reduce((sum, row) => sum + row.revenue, 0)
    expect(Math.round(total)).toBe(100)
  })

  // Otherwise a customer who clicked the same newsletter three times hands it three quarters of the sale.
  test('the same campaign clicked twice before one order is one touch', () => {
    const rows = attributeLinear([
      touch('o1', 'c1', 100), touch('o1', 'c1', 100), touch('o1', 'c2', 100),
    ])
    expect(rows).toEqual([
      { campaignId: 'c1', currencyCode: 'PLN', orders: 1, revenue: 50 },
      { campaignId: 'c2', currencyCode: 'PLN', orders: 1, revenue: 50 },
    ])
  })

  test('orders accumulate per campaign', () => {
    const rows = attributeLinear([touch('o1', 'c1', 100), touch('o2', 'c1', 40)])
    expect(rows).toEqual([{ campaignId: 'c1', currencyCode: 'PLN', orders: 2, revenue: 140 }])
  })

  // A single figure mixing PLN and EUR is a number that means nothing.
  test('currencies are reported separately, never summed', () => {
    const rows = attributeLinear([touch('o1', 'c1', 100, 'PLN'), touch('o2', 'c1', 100, 'EUR')])
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.currencyCode).sort()).toEqual(['EUR', 'PLN'])
  })

  test('rounds to cents rather than carrying floating-point noise', () => {
    const rows = attributeLinear([touch('o1', 'c1', 10), touch('o1', 'c2', 10), touch('o1', 'c3', 10)])
    expect(rows.every((row) => row.revenue === 3.33)).toBe(true)
  })

  test('the biggest contributor is listed first', () => {
    const rows = attributeLinear([touch('o1', 'small', 10), touch('o2', 'big', 500)])
    expect(rows[0].campaignId).toBe('big')
  })

  test('nothing in, nothing out', () => {
    expect(attributeLinear([])).toEqual([])
  })
})

describe('loadAttribution', () => {
  const scope = { tenantId: 't1', organizationId: 'o1' }
  const since = new Date('2026-09-01T00:00:00.000Z')

  /**
   * `em.execute` answers the capability probe; `getConnection().execute` answers the query under test.
   *
   * These tests are about an installation that HAS `sales` — attribution is meaningless without it — so the
   * probe reports both modules present. The no-sales path has its own test, and the cache is reset per test so
   * one answer cannot leak into the next.
   */
  function fakeEm(rows: unknown[]) {
    const executed: Array<{ sql: string; params: unknown[] }> = []
    const em = {
      execute: async () => [{ sales: true, catalog: true }],
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          executed.push({ sql, params })
          return rows
        },
      }),
    }
    return { em: em as unknown as EntityManager, executed }
  }

  beforeEach(() => resetCapabilityCache())

  test('returns nothing, rather than zero revenue, when there is no sales module', async () => {
    // Declared in `optionalRequires`: the tables may not exist, and "we cannot see purchases" is not the same
    // claim as "this campaign earned nothing".
    const em = { execute: async () => [{ sales: false, catalog: false }] } as unknown as EntityManager
    expect(await loadAttribution(em, scope, { windowDays: 7, since })).toEqual([])
  })

  test('joins clicks to later orders inside the window, scoped, excluding cancellations', async () => {
    const { em, executed } = fakeEm([])
    await loadAttribution(em, scope, { windowDays: 7, since })
    const { sql, params } = executed[0]
    expect(sql).toContain("e.type = 'clicked'")
    expect(sql).toContain('o.placed_at > c.occurred_at')
    expect(sql).toContain('make_interval(days => ?)')
    expect(sql).toContain("o.status not in ('canceled', 'cancelled')")
    expect(params).toEqual(['t1', 'o1', since, 7, 't1', 'o1'])
  })

  test('parses money that sales stores as a string', async () => {
    const { em } = fakeEm([
      { order_id: 'o1', campaign_id: 'c1', currency_code: 'PLN', order_total: '249.9900' },
    ])
    expect(await loadAttribution(em, scope, { windowDays: 7, since })).toEqual([
      { campaignId: 'c1', currencyCode: 'PLN', orders: 1, revenue: 249.99 },
    ])
  })

  // Narrowing the QUERY to one campaign would hide the other touches on the same order and hand this
  // campaign a share it did not earn.
  test('a campaign filter applies after the split, not before it', async () => {
    const { em } = fakeEm([
      { order_id: 'o1', campaign_id: 'c1', currency_code: 'PLN', order_total: '100' },
      { order_id: 'o1', campaign_id: 'c2', currency_code: 'PLN', order_total: '100' },
    ])
    const rows = await loadAttribution(em, scope, { windowDays: 7, since, campaignId: 'c1' })
    expect(rows).toEqual([{ campaignId: 'c1', currencyCode: 'PLN', orders: 1, revenue: 50 }])
  })
})
