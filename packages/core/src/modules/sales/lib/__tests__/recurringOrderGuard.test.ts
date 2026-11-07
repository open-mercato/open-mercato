/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  assertOrderRecurrenceUnlocked,
  assertRecurringOrderDeletable,
  assertRecurringOrderStatusAllowed,
} from '../recurringOrderGuard'

const order = { id: 'order-1', tenantId: 'ten-1', organizationId: 'org-1' }

function buildEm(options: { recurrence?: Record<string, unknown> | null; periods?: number }) {
  const em = {
    findOne: jest.fn().mockResolvedValue(options.recurrence ?? null),
    find: jest.fn().mockResolvedValue(Array.from({ length: options.periods ?? 0 }, (_, index) => ({ id: `p-${index}` }))),
  }
  return { em: em as unknown as EntityManager, mock: em }
}

describe('assertOrderRecurrenceUnlocked', () => {
  it('allows edits before the first period', async () => {
    const { em } = buildEm({ periods: 0 })
    await expect(assertOrderRecurrenceUnlocked(em, order)).resolves.toBeUndefined()
  })

  it('refuses edits once a period exists', async () => {
    const { em } = buildEm({ periods: 1 })
    await expect(assertOrderRecurrenceUnlocked(em, order)).rejects.toMatchObject({
      status: 409,
      body: { code: 'recurring_order_locked' },
    })
  })
})

describe('assertRecurringOrderStatusAllowed', () => {
  it.each(['canceled', 'cancelled', 'on_hold'])('refuses %s while the recurrence is unfinished', async (status) => {
    for (const recurrenceStatus of ['scheduled', 'active', 'cancelling']) {
      const { em } = buildEm({ recurrence: { status: recurrenceStatus } })
      await expect(assertRecurringOrderStatusAllowed(em, order, status)).rejects.toMatchObject({
        status: 409,
        body: { code: 'recurring_order_use_cancel' },
      })
    }
  })

  it('allows stopping statuses once the recurrence is finished, and on orders without one', async () => {
    for (const recurrence of [{ status: 'completed' }, { status: 'cancelled' }, null]) {
      const { em } = buildEm({ recurrence })
      await expect(assertRecurringOrderStatusAllowed(em, order, 'canceled')).resolves.toBeUndefined()
    }
  })

  it('does not look up the recurrence for other statuses', async () => {
    const { em, mock } = buildEm({ recurrence: { status: 'active' } })
    await expect(assertRecurringOrderStatusAllowed(em, order, 'confirmed')).resolves.toBeUndefined()
    await expect(assertRecurringOrderStatusAllowed(em, order, null)).resolves.toBeUndefined()
    expect(mock.findOne).not.toHaveBeenCalled()
  })

  describe('with the recurrence the same write leaves on the order', () => {
    const schedule = { frequency: 'monthly' as const, startsOn: '2027-01-01' }

    it('refuses a stopping status together with a new recurrence', async () => {
      const { em } = buildEm({ recurrence: null })
      await expect(assertRecurringOrderStatusAllowed(em, order, 'on_hold', schedule)).rejects.toMatchObject({
        status: 409,
        body: { code: 'recurring_order_use_cancel' },
      })
    })

    it('refuses a changed schedule even when the current recurrence is finished', async () => {
      const { em } = buildEm({ recurrence: { ...schedule, status: 'completed' } })
      await expect(
        assertRecurringOrderStatusAllowed(em, order, 'canceled', { ...schedule, frequency: 'yearly' }),
      ).rejects.toMatchObject({ body: { code: 'recurring_order_use_cancel' } })
    })

    it('judges an echoed schedule by the current recurrence', async () => {
      const finished = buildEm({ recurrence: { ...schedule, status: 'completed' } })
      await expect(assertRecurringOrderStatusAllowed(finished.em, order, 'canceled', schedule)).resolves.toBeUndefined()
      const unfinished = buildEm({ recurrence: { ...schedule, status: 'active' } })
      await expect(assertRecurringOrderStatusAllowed(unfinished.em, order, 'canceled', schedule)).rejects.toMatchObject({
        body: { code: 'recurring_order_use_cancel' },
      })
    })

    it('allows stopping an order in the same write that removes its recurrence', async () => {
      const { em, mock } = buildEm({ recurrence: { ...schedule, status: 'scheduled' } })
      await expect(assertRecurringOrderStatusAllowed(em, order, 'canceled', null)).resolves.toBeUndefined()
      expect(mock.findOne).not.toHaveBeenCalled()
    })

    it('looks up only the live recurrence', async () => {
      const { em, mock } = buildEm({ recurrence: null })
      await assertRecurringOrderStatusAllowed(em, order, 'canceled')
      expect(mock.findOne.mock.calls[0][1]).toEqual({ orderId: 'order-1', tenantId: 'ten-1', organizationId: 'org-1', deletedAt: null })
    })
  })
})

describe('assertRecurringOrderDeletable', () => {
  it('locks the recurrence row before checking for periods', async () => {
    const { em, mock } = buildEm({ recurrence: { status: 'scheduled' }, periods: 0 })
    await expect(assertRecurringOrderDeletable(em, order)).resolves.toBeUndefined()
    expect(mock.findOne.mock.calls[0][2]).toMatchObject({ lockMode: expect.anything() })
  })

  it('filters the recurrence and its periods by the order scope', async () => {
    const { em, mock } = buildEm({ recurrence: { status: 'scheduled' }, periods: 0 })
    await assertRecurringOrderDeletable(em, order)
    const scope = { tenantId: 'ten-1', organizationId: 'org-1' }
    expect(mock.findOne.mock.calls[0][1]).toEqual({ orderId: 'order-1', ...scope })
    expect(mock.find.mock.calls[0][1]).toEqual({ order: 'order-1', ...scope })
  })

  it('refuses to delete a recurring order with a period', async () => {
    const { em } = buildEm({ recurrence: { status: 'active' }, periods: 1 })
    await expect(assertRecurringOrderDeletable(em, order)).rejects.toMatchObject({
      status: 409,
      body: { code: 'recurring_order_invoiced' },
    })
  })

  it('allows deleting an order without a recurrence', async () => {
    const { em, mock } = buildEm({ recurrence: null, periods: 1 })
    await expect(assertRecurringOrderDeletable(em, order)).resolves.toBeUndefined()
    expect(mock.find).not.toHaveBeenCalled()
  })
})
