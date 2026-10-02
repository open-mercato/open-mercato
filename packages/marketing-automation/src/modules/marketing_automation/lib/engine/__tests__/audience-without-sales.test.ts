import { matchesAudience } from '../audience'
import type { SubjectDocument } from '../types'

/**
 * On an installation with no `sales` module, an order audience must match NOBODY — never everybody.
 *
 * `sales` is declared in `optionalRequires`, so its tables may genuinely not exist, and the subject document
 * omits the whole `orders` key rather than filling it with zeroes. This test is why.
 *
 * `orders.count: 0` is a TRUE statement about a never-buyer and a LIE about a shop that cannot record a sale —
 * and the lie satisfies `orders.count <= 5`, so a win-back campaign would mail the entire customer base on an
 * installation that has never sold anything. The failure would arrive as mail, to real people, and look like
 * the feature working.
 */
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const now = new Date('2026-10-02T12:00:00.000Z')
const check = (audience: unknown, subject: SubjectDocument) =>
  matchesAudience(audience as never, subject, { now, logger })

/** Exactly what `buildSubjectDocument` produces when the probe reports no sales: no `orders` key at all. */
const withoutSales: SubjectDocument = {
  customer: { id: 'c1', email: 'someone@example.com', displayName: 'Someone', createdAt: '2026-01-01T00:00:00.000Z' },
  tags: ['newsletter'],
  trigger: {},
} as SubjectDocument

/** The same person on an installation that HAS sales, who has simply never bought. */
const neverBought: SubjectDocument = {
  customer: { id: 'c1', email: 'someone@example.com', displayName: 'Someone', createdAt: '2026-01-01T00:00:00.000Z' },
  tags: ['newsletter'],
  orders: { count: 0, totalGross: 0, skus: [], categories: [], channels: [] },
  trigger: {},
} as SubjectDocument

const lightBuyer = { field: 'orders.count', operator: '<=', value: 5 }
const winBack = { field: 'orders.daysSinceLast', operator: '<=', value: 30 }
const bigSpender = { field: 'orders.totalGross', operator: '>=', value: 100 }

describe('an order audience with no sales module', () => {
  it('does not match "fewer than five orders"', () => {
    expect(check(lightBuyer, withoutSales)).toBe(false)
  })

  it('does not match a win-back window', () => {
    expect(check(winBack, withoutSales)).toBe(false)
  })

  it('does not match a spend threshold', () => {
    expect(check(bigSpender, withoutSales)).toBe(false)
  })

  it('matches nothing through a missing intermediate level, not just a missing leaf', () => {
    // The whole `orders` group is gone, so this relies on path resolution stopping at the absent parent.
    expect(check({ field: 'orders.skus', operator: 'CONTAINS', value: 'anything' }, withoutSales)).toBe(false)
  })
})

describe('the control: the same expressions against a real never-buyer', () => {
  it('"fewer than five orders" DOES match somebody with zero', () => {
    /**
     * This is the asymmetry the whole design rests on. A never-buyer genuinely satisfies `orders.count <= 5`,
     * which is correct and is what a welcome campaign targets — so zeroing the key on an installation without
     * sales would have swept in every customer, indistinguishably from the intended behaviour.
     */
    expect(check(lightBuyer, neverBought)).toBe(true)
  })

  it('but a magnitude comparison on an ABSENT aggregate still fails closed', () => {
    // `daysSinceLast` is absent even for a real never-buyer, which is the rule `types.ts` calls load-bearing.
    expect(check(winBack, neverBought)).toBe(false)
  })
})

/**
 * That the document BUILDER actually omits the key, not merely that an omitted key behaves.
 *
 * The tests above prove the semantics; this proves the producer. Asserted against the source because driving
 * the real `buildSubjectDocument` needs a fake that stages a dozen queries, and a fake that elaborate tends to
 * certify itself — the module has been bitten by exactly that (`gdpr.test.ts` implemented `getConnection()` and
 * thirteen tests certified a defect).
 */
describe('buildSubjectDocument', () => {
  const source = (() => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    return readFileSync(join(__dirname, '..', '..', 'subject-document.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
  })()

  it('asks whether the optional modules are there', () => {
    expect(source).toContain('readCapabilities(em)')
  })

  it('skips the order reads rather than attempting and catching them', () => {
    // A missing table is the installation this module promises to run on, not an error to recover from — and
    // catching it would log a failure per customer per evaluation for a shop configured exactly as intended.
    expect(source).toContain('capabilities.sales ? loadOrderAggregates')
    expect(source).toContain('capabilities.sales ? loadPurchasedSkus')
    expect(source).toContain('capabilities.sales ? loadPurchasedChannels')
  })

  it('needs BOTH modules for categories, because the join spans them', () => {
    // The line comes from `sales`, its classification from `catalog`.
    expect(source).toContain('capabilities.sales && capabilities.catalog ? loadPurchasedCategories')
  })

  it('omits the orders key instead of spreading an empty one', () => {
    expect(source).toContain('...(orders ? { orders:')
    // The shape that would have been the bug: an unconditional key.
    expect(/\n\s+orders: \{ \.\.\.orders,/.test(source)).toBe(false)
  })

  it('withholds everything derived FROM orders too', () => {
    // RFM of 1-1-1 reads as "our worst customer" and would be swept into every win-back audience.
    expect(source).toContain('rfm: orders ? computeRfm')
    expect(source).toContain('orders ? projectCustomerValue')
    expect(source).toContain('orders ? grossPercentile')
  })
})
