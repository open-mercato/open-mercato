import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CUSTOMERS_SOURCE_ID,
  FULFILLED_ORDERS_SOURCE_ID,
  FULFILLED_ORDER_TRIGGER_ID,
  findRowSweepSource,
  ROW_SWEEP_SOURCES,
  sweepSourceCatalog,
  SWEEP_SOURCE_IDS,
} from '../sweep-sources'
import { isSweepClaimKey, sweepClaimKey } from '../occurrence'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-28T12:00:00.000Z')

function fakeEm(rows: unknown[]) {
  const finds: Array<{ where: Record<string, unknown>; options: Record<string, unknown> }> = []
  const em = {
    find: async (_entity: unknown, where: Record<string, unknown>, options: Record<string, unknown>) => {
      finds.push({ where, options })
      return rows
    },
  }
  return { em: em as unknown as EntityManager, finds }
}

describe('the sweep source registry', () => {
  test('the population source is not a row source, because its query is the audience narrowing', () => {
    expect(findRowSweepSource(CUSTOMERS_SOURCE_ID)).toBeUndefined()
    expect(SWEEP_SOURCE_IDS).toContain(CUSTOMERS_SOURCE_ID)
  })

  test('the catalog offers every id the validator accepts, and nothing else', () => {
    expect(sweepSourceCatalog().map((entry) => entry.id)).toEqual([...SWEEP_SOURCE_IDS])
  })

  test('every row source declares a trigger id and context keys the audience builder can offer', () => {
    for (const source of ROW_SWEEP_SOURCES) {
      expect(source.triggerEventId).toMatch(/^marketing_automation\./)
      expect(source.contextKeys.length).toBeGreaterThan(0)
      for (const key of source.contextKeys) expect(key.startsWith('trigger.')).toBe(true)
    }
  })

  test('an unknown id resolves to nothing rather than to a default source', () => {
    expect(findRowSweepSource('made_up')).toBeUndefined()
    expect(findRowSweepSource(null)).toBeUndefined()
  })
})

describe('fulfilled orders — the review-request source', () => {
  const source = findRowSweepSource(FULFILLED_ORDERS_SOURCE_ID)!

  test('looks at a WINDOW of orders, not at everything older than the delay', async () => {
    const { em, finds } = fakeEm([])
    await source.collect(em, scope, { withinDays: 7 }, now, 50)
    const placedAt = finds[0].where.placedAt as { $gte: Date; $lte: Date }
    // Upper bound: the delay. Lower bound: a lookback, or every tick would scan the whole history.
    expect(placedAt.$lte).toEqual(new Date('2026-09-21T12:00:00.000Z'))
    expect(placedAt.$gte.getTime()).toBeLessThan(placedAt.$lte.getTime())
  })

  test('only orders the customer actually has, and never a cancelled one', async () => {
    const { em, finds } = fakeEm([])
    await source.collect(em, scope, {}, now, 50)
    expect(finds[0].where.fulfillmentStatus).toEqual({ $in: expect.arrayContaining(['fulfilled', 'delivered']) })
    expect(finds[0].where.status).toEqual({ $nin: ['canceled', 'cancelled'] })
    expect(finds[0].where).toMatchObject({ tenantId: 't1', organizationId: 'o1', deletedAt: null })
  })

  test('uses its own default window when the author set none', async () => {
    const { em, finds } = fakeEm([])
    await source.collect(em, scope, {}, now, 50)
    const placedAt = finds[0].where.placedAt as { $lte: Date }
    expect(placedAt.$lte).toEqual(new Date(now.getTime() - source.defaultWithinDays * 86_400_000))
  })

  test('hands back the order context an audience and a message can use', async () => {
    const { em } = fakeEm([{
      id: 'order-1',
      orderNumber: 'SO-1',
      customerEntityId: 'c1',
      grandTotalGrossAmount: '249.9900',
      currencyCode: 'PLN',
      placedAt: new Date('2026-09-18T12:00:00.000Z'),
    }])
    const [candidate] = await source.collect(em, scope, { withinDays: 7 }, now, 50)
    expect(candidate.subjectEntityId).toBe('c1')
    // Money is numeric-as-string in sales; an audience comparing it needs a number.
    expect(candidate.trigger).toMatchObject({ orderId: 'order-1', orderNumber: 'SO-1', orderTotal: 249.99, daysSinceOrder: 10 })
  })

  // Asking twice for a review of the same order is the failure this claim exists to prevent.
  test('claims each order exactly once, durably', async () => {
    const { em } = fakeEm([{ id: 'order-1', customerEntityId: 'c1', placedAt: now }])
    const [candidate] = await source.collect(em, scope, {}, now, 50)
    expect(candidate.claimKey).toBe(sweepClaimKey([FULFILLED_ORDER_TRIGGER_ID, 'order-1']))
    expect(isSweepClaimKey(candidate.claimKey)).toBe(true)
  })

  test('skips a row with no customer rather than starting a run about nobody', async () => {
    const { em } = fakeEm([{ id: 'order-1', customerEntityId: null, placedAt: now }])
    expect(await source.collect(em, scope, {}, now, 50)).toEqual([])
  })
})

describe('expiring quotes', () => {
  const source = findRowSweepSource('expiring_quotes')!

  test('looks forward, not back, and skips settled quotes', async () => {
    const { em, finds } = fakeEm([])
    await source.collect(em, scope, { withinDays: 7 }, now, 50)
    const validUntil = finds[0].where.validUntil as { $gt: Date; $lte: Date }
    expect(validUntil.$gt).toEqual(now)
    expect(validUntil.$lte).toEqual(new Date('2026-10-05T12:00:00.000Z'))
    expect(finds[0].where.status).toEqual({ $nin: ['confirmed', 'canceled', 'cancelled'] })
  })

  // A reminder about an expiring quote is legitimately repeatable; the re-entry policy governs it.
  test('does not claim, unlike the review request', async () => {
    const { em } = fakeEm([{ id: 'q1', customerEntityId: 'c1', validUntil: new Date('2026-10-01T12:00:00.000Z') }])
    const [candidate] = await source.collect(em, scope, {}, now, 50)
    expect(candidate.claimKey).toBeUndefined()
  })
})

describe('sweepClaimKey', () => {
  test('is stable for the same thing and different for different things', () => {
    expect(sweepClaimKey(['a', 'b'])).toBe(sweepClaimKey(['a', 'b']))
    expect(sweepClaimKey(['a', 'b'])).not.toBe(sweepClaimKey(['a', 'c']))
  })

  test('cannot be confused with an event occurrence key', () => {
    expect(isSweepClaimKey(sweepClaimKey(['x']))).toBe(true)
    expect(isSweepClaimKey('0123456789abcdef')).toBe(false)
    expect(isSweepClaimKey(null)).toBe(false)
  })
})
