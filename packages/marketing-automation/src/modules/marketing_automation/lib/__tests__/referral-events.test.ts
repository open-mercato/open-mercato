jest.mock('../../events', () => ({
  emitMarketingAutomationEvent: jest.fn(),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { MarketingReferralCode, MarketingReferralRedemption } from '../../data/entities'
import { emitMarketingAutomationEvent } from '../../events'
import { resetCapabilityCache } from '../capabilities'
import { convertReferralFromOrderEvent } from '../referral-events'

const mockedEmit = emitMarketingAutomationEvent as jest.MockedFunction<typeof emitMarketingAutomationEvent>

const scope = { tenantId: 't1', organizationId: 'o1' }

type Row = Record<string, unknown>

/**
 * The before/after ordering this suite exists to lock in.
 *
 * A referral is always CLAIMED before the order that converts it — `claimReferral` refuses anybody who has
 * already bought, so a pending redemption can only exist for an order not yet placed. What varies is which
 * event tells this module the order now counts: created-already-placed (the storefront shape) or
 * confirmed-after-the-fact (a draft, a quote, a submission reviewed later). Both must convert the SAME
 * pending redemption; neither is the "normal" one to the code, only to the business.
 */
function fakeEm(answers: {
  order?: Row | null
  redemption?: Row | null
  code?: Row | null
  nativeUpdateCount?: number
}) {
  const nativeUpdateCalls: Array<{ where: Row; data: Row }> = []
  const em = {
    // The capability probe comes through the same door as every other query; answered by its shape
    // (`to_regclass`) rather than recorded, same as `lib/__tests__/referrals.test.ts`'s fake.
    execute: async (sql: string) => {
      if (sql.includes('to_regclass')) return [{ sales: true, catalog: true }]
      return []
    },
    findOne: async (entity: unknown, where: Row) => {
      if (entity === SalesOrder) return answers.order ?? null
      if (entity === MarketingReferralRedemption) return answers.redemption ?? null
      if (entity === MarketingReferralCode) return answers.code ?? null
      return null
    },
    nativeUpdate: async (entity: unknown, where: Row, data: Row) => {
      nativeUpdateCalls.push({ where, data })
      return entity === MarketingReferralRedemption ? answers.nativeUpdateCount ?? 1 : 0
    },
  }
  return { em: em as unknown as EntityManager, nativeUpdateCalls }
}

function ctxFor(em: EntityManager) {
  return { resolve: <T>(name: string): T => (name === 'em' ? (em as unknown as T) : (undefined as T)) }
}

const placedOrder: Row = {
  id: 'order-1',
  tenantId: 't1',
  organizationId: 'o1',
  customerEntityId: 'referred-1',
  status: 'confirmed',
  placedAt: new Date('2026-02-01'),
  grandTotalGrossAmount: '123.00',
}

const pendingRedemption: Row = {
  id: 'redemption-1',
  referrerEntityId: 'referrer-1',
  referredEntityId: 'referred-1',
  codeId: 'code-1',
}

const liveCode: Row = { code: 'GOOD1234' }

beforeEach(() => {
  mockedEmit.mockClear()
  resetCapabilityCache()
})

describe('convertReferralFromOrderEvent', () => {
  it('converts on sales.order.created, when the order is already placed the moment it exists', async () => {
    const { em } = fakeEm({ order: placedOrder, redemption: pendingRedemption, code: liveCode })
    await convertReferralFromOrderEvent('sales.order.created', { tenantId: 't1', organizationId: 'o1', id: 'order-1' }, ctxFor(em))
    expect(mockedEmit).toHaveBeenCalledWith(
      'marketing_automation.referral.converted',
      expect.objectContaining({ entityId: 'referrer-1', referredEntityId: 'referred-1', orderId: 'order-1' }),
      { persistent: true },
    )
  })

  it('converts on sales.order.confirmed, when the referral was claimed before an order created unplaced and confirmed afterwards', async () => {
    /**
     * The regression this test guards. `sales.order.created` already fired once, for the earlier,
     * not-yet-eligible shape of this same order — this module never saw it, because that version of the
     * order had no `placedAt` yet. `sales.order.confirmed` is the event that tells this module the order
     * NOW counts, and it must convert the SAME pending redemption `sales.order.created` could not.
     */
    const { em } = fakeEm({ order: placedOrder, redemption: pendingRedemption, code: liveCode })
    await convertReferralFromOrderEvent('sales.order.confirmed', { tenantId: 't1', organizationId: 'o1', id: 'order-1' }, ctxFor(em))
    expect(mockedEmit).toHaveBeenCalledWith(
      'marketing_automation.referral.converted',
      expect.objectContaining({ entityId: 'referrer-1', referredEntityId: 'referred-1', orderId: 'order-1' }),
      { persistent: true },
    )
  })

  it('converts nothing for a cancelled order, on either event', async () => {
    const cancelled = { ...placedOrder, status: 'cancelled' }
    for (const eventId of ['sales.order.created', 'sales.order.confirmed'] as const) {
      const { em } = fakeEm({ order: cancelled, redemption: pendingRedemption, code: liveCode })
      await convertReferralFromOrderEvent(eventId, { tenantId: 't1', organizationId: 'o1', id: 'order-1' }, ctxFor(em))
    }
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('converts nothing for an order with no placedAt yet, on either event', async () => {
    const unplaced = { ...placedOrder, placedAt: null }
    for (const eventId of ['sales.order.created', 'sales.order.confirmed'] as const) {
      const { em } = fakeEm({ order: unplaced, redemption: pendingRedemption, code: liveCode })
      await convertReferralFromOrderEvent(eventId, { tenantId: 't1', organizationId: 'o1', id: 'order-1' }, ctxFor(em))
    }
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('does nothing when the order has no customer', async () => {
    const { em } = fakeEm({ order: { ...placedOrder, customerEntityId: null } })
    await convertReferralFromOrderEvent('sales.order.confirmed', { tenantId: 't1', organizationId: 'o1', id: 'order-1' }, ctxFor(em))
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('does nothing when there is no pending referral for this customer', async () => {
    const { em } = fakeEm({ order: placedOrder, redemption: null })
    await convertReferralFromOrderEvent('sales.order.confirmed', { tenantId: 't1', organizationId: 'o1', id: 'order-1' }, ctxFor(em))
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('never double-converts when both events fire for the same order', async () => {
    // The first call wins the conditional UPDATE; the second finds nothing left in `pending` status.
    const { em } = fakeEm({ order: placedOrder, redemption: pendingRedemption, code: liveCode, nativeUpdateCount: 0 })
    await convertReferralFromOrderEvent('sales.order.confirmed', { tenantId: 't1', organizationId: 'o1', id: 'order-1' }, ctxFor(em))
    expect(mockedEmit).not.toHaveBeenCalled()
  })
})
