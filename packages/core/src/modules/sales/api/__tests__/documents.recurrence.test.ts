/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/core/generated/entities.ids.generated', () => ({
  E: { sales: { sales_order: 'sales:sales_order', sales_quote: 'sales:sales_quote' } },
}))

jest.mock('../../commands/returns', () => ({
  recalculateOrderTotalsForDisplay: jest.fn(),
}))

import { attachRecurrences } from '../documents/factory'

const orderRecurrence = {
  order: { id: 'order-1' },
  frequency: 'monthly',
  startsOn: '2026-11-01',
  anchorDay: null,
  periodCount: 12,
  endsOn: '2027-10-31',
  nextPeriodIndex: 0,
  nextInvoiceOn: '2026-11-01',
  status: 'scheduled',
  scheduleVersion: 2,
}

function buildCtx(rows: Record<string, unknown[]>) {
  const calls: Array<{ entity: string; where: Record<string, unknown> }> = []
  const em = {
    find: (entity: { name?: string }, where: Record<string, unknown>) => {
      const name = entity?.name ?? ''
      calls.push({ entity: name, where })
      return Promise.resolve(rows[name] ?? [])
    },
  }
  return {
    calls,
    ctx: {
      container: { resolve: (token: string) => (token === 'em' ? em : null) },
      auth: { tenantId: 'ten-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
    },
  }
}

describe('attachRecurrences', () => {
  it('adds the order schedule with its derived fields and marks invoiced orders locked', async () => {
    const { ctx, calls } = buildCtx({
      SalesOrderRecurrence: [orderRecurrence, { ...orderRecurrence, order: { id: 'order-2' } }],
      SalesRecurringPeriod: [{ id: 'period-1', order: { id: 'order-2' } }],
    })
    const payload = { items: [{ id: 'order-1' }, { id: 'order-2' }, { id: 'order-3' }] as Array<Record<string, unknown>> }

    await attachRecurrences(payload, ctx as never, 'order')

    expect(payload.items[0].recurrence).toEqual({
      frequency: 'monthly',
      startsOn: '2026-11-01',
      anchorDay: null,
      periodCount: 12,
      endsOn: '2027-10-31',
      nextInvoiceOn: '2026-11-01',
      status: 'scheduled',
      scheduleVersion: 2,
      locked: false,
    })
    expect(payload.items[1].recurrence).toMatchObject({ locked: true })
    expect(payload.items[2].recurrence).toBeNull()
    expect(calls.every((call) => call.where.tenantId === 'ten-1')).toBe(true)
  })

  it('adds the quote schedule with a calculated end date and no order-only state', async () => {
    const { ctx, calls } = buildCtx({
      SalesQuoteRecurrence: [
        { quote: { id: 'quote-1' }, frequency: 'quarterly', startsOn: '2026-08-31', anchorDay: null, periodCount: 2 },
      ],
    })
    const payload = { items: [{ id: 'quote-1' }] as Array<Record<string, unknown>> }

    await attachRecurrences(payload, ctx as never, 'quote')

    expect(payload.items[0].recurrence).toEqual({
      frequency: 'quarterly',
      startsOn: '2026-08-31',
      anchorDay: null,
      periodCount: 2,
      endsOn: '2027-02-27',
      nextInvoiceOn: null,
      status: null,
      scheduleVersion: null,
      locked: false,
    })
    expect(calls.map((call) => call.entity)).toEqual(['SalesQuoteRecurrence'])
  })

  it('does nothing without a tenant', async () => {
    const { ctx, calls } = buildCtx({})
    const payload = { items: [{ id: 'order-1' }] as Array<Record<string, unknown>> }

    await attachRecurrences(payload, { ...ctx, auth: null } as never, 'order')

    expect(calls).toHaveLength(0)
    expect(payload.items[0].recurrence).toBeUndefined()
  })
})
