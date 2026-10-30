import { MarketingProductWatch } from '../../data/entities'
import { scanPriceWatches, startWatch } from '../product-watches'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resetCapabilityCache } from '../capabilities'

/**
 * The orchestration around the price-drop decision, which the decision's own tests cannot reach.
 *
 * `lib/engine/price-watch.ts` is pure and well covered: given a watched price, a current price and a last
 * notification, it decides. What had no test is everything around that call — whether a second watch is
 * created for the same customer and SKU, whether prices are fetched once per currency or once per watch, and
 * whether the reference price moves when the watch did NOT fire.
 *
 * That last one is the subtle one and the reason this file exists. A product that got dearer has to be
 * measured from its new, higher price next time: without that, the next fall back to the old price reads as a
 * drop, and a customer is told about a "discount" that only undoes a rise.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-30T12:00:00.000Z')

type PriceRow = { sku: string; amount: string }

function fakeEm(input: { watches?: Partial<MarketingProductWatch>[]; existing?: unknown; prices?: PriceRow[][] }) {
  const created: Record<string, unknown>[] = []
  const executed: Array<{ params: unknown[] }> = []
  let flushes = 0
  let priceCall = 0
  const stamped: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const finds: Array<Record<string, unknown>> = []
  const em = {
    /**
     * The capability probe. These tests are about a shop that HAS a catalogue — there is no price to compare
     * against without one — so it reports both present, and the cache is reset per test so one answer cannot
     * leak into the next.
     */
    execute: async () => [{ sales: true, catalog: true }],
    findOne: async () => input.existing ?? null,
    find: async (_entity: unknown, _where: unknown, options?: Record<string, unknown>) => {
      finds.push(options ?? {})
      return (input.watches ?? []) as unknown[]
    },
    nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      stamped.push({ where, data })
      return 1
    },
    create: (_entity: unknown, data: Record<string, unknown>) => { created.push(data); return data },
    persist: () => undefined,
    flush: async () => { flushes += 1 },
    clear: () => undefined,
    getConnection: () => ({
      execute: async (_sql: string, params: unknown[]) => {
        executed.push({ params })
        return (input.prices ?? [])[priceCall++] ?? []
      },
    }),
  }
  return { em: em as unknown as EntityManager, created, executed, stamped, finds, flushes: () => flushes }
}

const watch = (over: Partial<MarketingProductWatch> = {}): Partial<MarketingProductWatch> => ({
  sku: 'SKU-A', currencyCode: 'PLN', watchedPriceGross: '100.00',
  notifiedAt: null, notifiedCount: 0, ...over,
})

describe('startWatch', () => {
  beforeEach(() => resetCapabilityCache())
  it('returns the existing watch rather than creating a second one', async () => {
    // A customer clicking "tell me" twice is one watch, not two notifications.
    const { em, created } = fakeEm({ existing: { id: 'w1' } })
    const result = await startWatch(em, scope, { subjectEntityId: 'c1', sku: 'SKU-A', currencyCode: 'PLN' })
    expect(result.created).toBe(false)
    expect(created).toHaveLength(0)
  })

  it('records the price at the moment of watching, as the reference', async () => {
    const { em, created } = fakeEm({ existing: null, prices: [[{ sku: 'SKU-A', amount: '100.00' }]] })
    const result = await startWatch(em, scope, { subjectEntityId: 'c1', sku: 'SKU-A', currencyCode: 'PLN' })
    expect(result.created).toBe(true)
    expect(created[0]).toMatchObject({ sku: 'SKU-A', currencyCode: 'PLN', watchedPriceGross: '100.00' })
  })

  it('accepts a watch on something with no visible price yet', async () => {
    /**
     * Null rather than a refusal. The watch is still valid — a price appearing later simply becomes its
     * reference on the first scan, which is what somebody watching an unreleased product wants.
     */
    const { em, created } = fakeEm({ existing: null, prices: [[]] })
    await startWatch(em, scope, { subjectEntityId: 'c1', sku: 'SKU-NEW', currencyCode: 'PLN' })
    expect(created[0]).toMatchObject({ watchedPriceGross: null })
  })
})

describe('scanPriceWatches', () => {
  it('asks nothing of the database when there is nothing to scan', async () => {
    const { em, executed } = fakeEm({ watches: [] })
    expect(await scanPriceWatches(em, scope, now)).toEqual({ scanned: 0, fired: [], reasons: {} })
    expect(executed).toHaveLength(0)
  })

  it('fetches prices once per CURRENCY, not once per watch', async () => {
    /**
     * A price is only comparable within one currency, so the watches are grouped by it — and the grouping is
     * also what keeps the scan to one query per currency rather than one per watch.
     */
    const { em, executed } = fakeEm({
      watches: [watch({ sku: 'SKU-A' }), watch({ sku: 'SKU-B' }), watch({ sku: 'SKU-C', currencyCode: 'EUR' })],
      prices: [[{ sku: 'SKU-A', amount: '100.00' }, { sku: 'SKU-B', amount: '100.00' }], [{ sku: 'SKU-C', amount: '100.00' }]],
    })
    await scanPriceWatches(em, scope, now)
    expect(executed).toHaveLength(2)
  })

  it('fires on a real drop and stamps the watch so a redelivered scan cannot repeat it', async () => {
    const row = watch({ watchedPriceGross: '100.00' })
    const { em } = fakeEm({ watches: [row], prices: [[{ sku: 'SKU-A', amount: '70.00' }]] })
    const outcome = await scanPriceWatches(em, scope, now)
    expect(outcome.fired).toHaveLength(1)
    expect(row.notifiedAt).toEqual(now)
    expect(row.notifiedCount).toBe(1)
  })

  it('counts why nothing fired, per reason', async () => {
    // So the demand screen can say "prices have not moved" rather than showing an empty table.
    const { em } = fakeEm({
      watches: [watch(), watch({ sku: 'SKU-B' })],
      prices: [[{ sku: 'SKU-A', amount: '100.00' }, { sku: 'SKU-B', amount: '100.00' }]],
    })
    const outcome = await scanPriceWatches(em, scope, now)
    expect(outcome.fired).toHaveLength(0)
    expect(Object.values(outcome.reasons).reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('moves the reference price up when the product got DEARER, though nothing fired', async () => {
    /**
     * The reason this file exists.
     *
     * Leave the reference at the old, lower price and the next fall BACK to it reads as a drop — so the
     * customer is told about a discount that only undoes a rise.
     */
    const row = watch({ watchedPriceGross: '100.00' })
    const { em } = fakeEm({ watches: [row], prices: [[{ sku: 'SKU-A', amount: '130.00' }]] })
    const outcome = await scanPriceWatches(em, scope, now)
    expect(outcome.fired).toHaveLength(0)
    expect(row.watchedPriceGross).toBe('130.00')
  })

  it('commits the stamps before the caller emits anything', async () => {
    /**
     * The reference price and the notified timestamp are the only things stopping a redelivered scan from
     * telling the same customer twice, so they are written first and the message goes out after.
     */
    const { em, flushes } = fakeEm({ watches: [watch()], prices: [[{ sku: 'SKU-A', amount: '70.00' }]] })
    await scanPriceWatches(em, scope, now)
    expect(flushes()).toBe(1)
  })
})

/**
 * The cap has to be a rotation, not a window on the oldest rows.
 *
 * The scan takes a bounded number of watches per tick and ordered them by creation, so an installation with
 * more watches than the cap re-read the same rows for ever and everything past it was never looked at once:
 * a customer waiting on a price they would never be told about, and nothing anywhere saying so.
 */
describe('scanPriceWatches — rotation', () => {
  test('asks for the least recently scanned first, nulls before anything', async () => {
    const { em, finds } = fakeEm({ watches: [watch({ id: 'w1' })], prices: [[]] })
    await scanPriceWatches(em, scope, now)
    expect(finds[0]?.orderBy).toEqual({ lastScannedAt: 'ASC NULLS FIRST', createdAt: 'ASC' })
  })

  test('stamps every watch it looked at, not only the ones that fired', async () => {
    // Without this the ordering is not a rotation: an unchanged price writes nothing else, so the same rows
    // would keep sorting first and the cap would never advance.
    const { em, stamped } = fakeEm({ watches: [watch({ id: 'w1' }), watch({ id: 'w2' })], prices: [[]] })
    const outcome = await scanPriceWatches(em, scope, now)
    expect(outcome.fired).toHaveLength(0)
    expect(stamped).toHaveLength(1)
    expect(stamped[0].data).toEqual({ lastScannedAt: now })
    expect(stamped[0].where).toMatchObject({ id: { $in: ['w1', 'w2'] }, ...scope })
  })
})
