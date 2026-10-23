import { MarketingReferralCode, MarketingReferralRedemption } from '../../data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { claimReferral, ensureReferralCode } from '../referrals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resetCapabilityCache } from '../capabilities'

/**
 * The referral programme's rules, which are mostly rules about refusing.
 *
 * `lib/referrals.ts` is 266 lines and had no unit test. Almost every branch in it is a refusal — a code whose
 * owner was deleted, a customer referring themselves, a second claim by the same person, a race lost to the
 * unique index — and none of those states is one an integration spec constructs on its way through the happy
 * path.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }

type Row = Record<string, unknown>

/**
 * A fake entity manager that answers by entity class.
 *
 * Deliberately dumb: these tests are about which questions the code asks and what it does with the answers,
 * not about MikroORM. The one place a fake could hide a defect — whether the generated SQL is valid — is
 * covered separately by `orm-queries-compile.test.ts`, which compiles the real clause.
 */
function fakeEm(answers: {
  code?: Row | null
  liveCustomers?: Row[]
  redemption?: Row | null
  onFlush?: () => void
  /** Rows the "has this person already bought from us" probe returns. Empty means a new customer. */
  earlierOrders?: Row[]
}) {
  const created: Array<{ entity: unknown; data: Row }> = []
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const em = {
    findOne: async (entity: unknown, where: Row) => {
      if (entity === MarketingReferralCode) return answers.code ?? null
      if (entity === MarketingReferralRedemption) return answers.redemption ?? null
      return null
    },
    find: async (entity: unknown) => (entity === CustomerEntity ? answers.liveCustomers ?? [] : []),
    execute: async (sql: string, params: unknown[]) => {
      /**
       * The capability probe comes through the same door, so it is answered by its shape rather than recorded.
       *
       * Recording it would shift every `executed[0]` assertion in this file by one, and these tests are about
       * which statement the claim path runs. Both modules present: the anti-abuse check these tests cover only
       * exists on an installation that HAS orders.
       */
      if (sql.includes('to_regclass')) return [{ sales: true, catalog: true }]
      executed.push({ sql, params })
      return answers.earlierOrders ?? []
    },
    create: (entity: unknown, data: Row) => { created.push({ entity, data }); return { id: 'new', ...data } },
    persist: () => undefined,
    flush: async () => { answers.onFlush?.() },
    clear: () => undefined,
    // The connection form escapes a transaction, and a storefront may well claim inside one.
    getConnection: () => { throw new Error('[internal] use em.execute()') },
  }
  return { em: em as unknown as EntityManager, created, executed }
}

describe('ensureReferralCode', () => {
  beforeEach(() => resetCapabilityCache())
  it('returns the code the customer already has rather than a second one', async () => {
    // Idempotent on purpose: the step that calls it runs inside a journey that may be redelivered, and a
    // person's code has to stay the same as the one already printed in every message that mentioned it.
    const { em, created } = fakeEm({ code: { code: 'KEEPME1' } })
    expect(await ensureReferralCode(em, scope, 'ref-1')).toBe('KEEPME1')
    expect(created).toHaveLength(0)
  })

  it('issues one on first use', async () => {
    const { em, created } = fakeEm({ code: null })
    const code = await ensureReferralCode(em, scope, 'ref-1')
    expect(code).toMatch(/^[A-Z0-9]+$/)
    expect(created[0].data).toMatchObject({ referrerEntityId: 'ref-1', ...scope })
  })

  it('answers with the code that won when a concurrent call got there first', async () => {
    /**
     * Losing this race is not a failure. The likelier cause of the insert throwing is another call for the
     * SAME customer rather than a code collision, and the right answer to that is the code that won.
     */
    let flushes = 0
    const answers: Parameters<typeof fakeEm>[0] = { code: null, onFlush: () => { throw new Error('duplicate key') } }
    const { em } = fakeEm(answers)
    const original = em.findOne.bind(em)
    ;(em as unknown as { findOne: unknown }).findOne = async (entity: unknown, where: Row) => {
      // Absent before the insert, present after it: the shape of a race.
      if (entity === MarketingReferralCode) return flushes++ === 0 ? null : { code: 'RACEWON' }
      return original(entity as never, where as never)
    }
    expect(await ensureReferralCode(em, scope, 'ref-1')).toBe('RACEWON')
  })
})

describe('claimReferral', () => {
  const live = [{ id: 'ref-1' }]

  it('claims a good code', async () => {
    const { em, created } = fakeEm({ code: { id: 'c1', code: 'GOOD1234', referrerEntityId: 'ref-1' }, liveCustomers: live })
    const outcome = await claimReferral(em, scope, { code: 'good1234', referredEntityId: 'new-1' })
    expect(outcome).toMatchObject({ status: 'claimed', referrerEntityId: 'ref-1' })
    expect(created[0].data).toMatchObject({ referredEntityId: 'new-1', status: 'pending' })
  })

  it('forgives the characters people confuse when copying a code by hand', async () => {
    /**
     * A code arrives from a storefront field or off a printed message, so the case, the spacing and the
     * classic misreadings are the customer's. Normalisation folds them before the lookup: `O` and `0`, `I`
     * and `L` and `1`, `U` and `V` — which is also why the generated alphabet contains only one of each pair.
     */
    const { em } = fakeEm({ code: { id: 'c1', code: 'G00D1234', referrerEntityId: 'ref-1' }, liveCustomers: live })
    expect(await claimReferral(em, scope, { code: ' good-1234 ', referredEntityId: 'new-1' }))
      .toMatchObject({ status: 'claimed', code: 'G00D1234' })
  })

  it('refuses a code that does not exist', async () => {
    const { em } = fakeEm({ code: null })
    expect(await claimReferral(em, scope, { code: 'NOPE1234', referredEntityId: 'new-1' }))
      .toEqual({ status: 'unknown_code' })
  })

  it('refuses a code with nobody behind it', async () => {
    // An erased referrer's code is retired in the same statement that unlinks them; this is belt and braces,
    // because a code with no owner has nobody to reward.
    const { em } = fakeEm({ code: { id: 'c1', code: 'GOOD1234', referrerEntityId: null } })
    expect(await claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' }))
      .toEqual({ status: 'unknown_code' })
  })

  it('refuses a code whose owner was deleted, without retiring it', async () => {
    /**
     * The code is not retired on delete: a delete can be undone, and the code is already printed in every
     * message that mentioned it. It simply stops resolving while its owner is gone.
     */
    const { em } = fakeEm({ code: { id: 'c1', code: 'GOOD1234', referrerEntityId: 'ref-1' }, liveCustomers: [] })
    expect(await claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' }))
      .toEqual({ status: 'unknown_code' })
  })

  it('refuses somebody referring themselves', async () => {
    const { em } = fakeEm({ code: { id: 'c1', code: 'GOOD1234', referrerEntityId: 'ref-1' }, liveCustomers: live })
    expect(await claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'ref-1' }))
      .toEqual({ status: 'self_referral' })
  })

  it('refuses a customer who has already been referred', async () => {
    const { em } = fakeEm({
      code: { id: 'c1', code: 'GOOD1234', referrerEntityId: 'ref-1' },
      liveCustomers: live,
      redemption: { id: 'r1' },
    })
    expect(await claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' }))
      .toEqual({ status: 'already_referred' })
  })

  describe('when the insert throws', () => {
    const code = { id: 'c1', code: 'GOOD1234', referrerEntityId: 'ref-1' }

    it('treats a unique violation as already referred, because that is the race the index exists to win', async () => {
      const { em } = fakeEm({
        code, liveCustomers: live,
        onFlush: () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }) },
      })
      expect(await claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' }))
        .toEqual({ status: 'already_referred' })
    })

    it('lets everything else through rather than calling it already referred', async () => {
      /**
       * The branch this test exists for. A bare catch here answered `already_referred` to a dead connection,
       * a statement timeout and an unanticipated constraint alike — so a storefront told the customer their
       * code had been used while the real error was never reported.
       */
      const { em } = fakeEm({
        code, liveCustomers: live,
        onFlush: () => { throw new Error('connection terminated') },
      })
      await expect(claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' }))
        .rejects.toThrow('connection terminated')
    })
  })
})

/**
 * The third way a referral programme is gamed: being referred when you are already a customer.
 *
 * Claiming your own code and claiming twice were both refused; this was not. An existing customer typing any
 * code before their next order had the conversion pay out on a purchase that was going to happen anyway — and
 * between two accounts that is a reward machine, because the referred side needs nothing but a code and an
 * order.
 */
describe('claimReferral — an existing buyer', () => {
  const liveReferrer = [{ id: 'ref-1' }]

  it('refuses somebody who has already ordered', async () => {
    const { em, created } = fakeEm({
      code: { id: 'code-1', code: 'GOOD1234', referrerEntityId: 'ref-1' },
      liveCustomers: liveReferrer,
      redemption: null,
      earlierOrders: [{ one: 1 }],
    })
    await expect(claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' }))
      .resolves.toEqual({ status: 'already_a_customer' })
    // Nothing recorded: a refused claim must not leave a pending redemption behind.
    expect(created).toHaveLength(0)
  })

  it('lets a genuinely new customer through', async () => {
    const { em, created } = fakeEm({
      code: { id: 'code-1', code: 'GOOD1234', referrerEntityId: 'ref-1' },
      liveCustomers: liveReferrer,
      redemption: null,
      earlierOrders: [],
    })
    const outcome = await claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' })
    expect(outcome).toMatchObject({ status: 'claimed', referrerEntityId: 'ref-1' })
    expect(created).toHaveLength(1)
  })

  it('asks with the module\'s own definition of an order that counts', async () => {
    const { em, executed } = fakeEm({
      code: { id: 'code-1', code: 'GOOD1234', referrerEntityId: 'ref-1' },
      liveCustomers: liveReferrer,
      redemption: null,
      earlierOrders: [],
    })
    await claimReferral(em, scope, { code: 'GOOD1234', referredEntityId: 'new-1' })
    const probe = executed.find((entry) => entry.sql.includes('sales_orders'))
    expect(probe).toBeDefined()
    // A cancelled order must not disqualify anybody, and nor must a cart they never submitted.
    expect(probe?.sql).toContain("not in ('canceled', 'cancelled')")
    expect(probe?.sql).toContain('placed_at is not null')
    expect(probe?.params).toEqual(['t1', 'o1', 'new-1'])
  })
})
