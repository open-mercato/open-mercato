/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { commandRegistry, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'
import {
  cancelRecurrence,
  defaultCancelSettlement,
  hasIssuedInvoice,
  isRecurrenceCancelAvailable,
  previewCancelCredit,
  readRecurrence,
  resetSalesRecurrenceAdapterCache,
  SALES_RECURRENCE_CANCEL_COMMAND,
  type RecurrenceRead,
} from '../lib/salesRecurrence'
import { SalesContractUnavailableError } from '../lib/salesErrors'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function recurrence(periods: Array<Partial<RecurrenceRead['periods'][number]>>, extra: Partial<RecurrenceRead> = {}): RecurrenceRead {
  return {
    orderId: 'order-1',
    status: 'active',
    startsOn: '2026-01-10',
    periodCount: 12,
    endsOn: '2027-01-09',
    nextPeriodIndex: periods.length,
    nextInvoiceOn: null,
    scheduleVersion: 3,
    cancelEffectiveOn: null,
    cancelSettlement: null,
    invoicesAvailable: true,
    periods: periods.map((period, index) => ({
      periodIndex: index,
      periodStart: '',
      periodEnd: '',
      invoiceId: null,
      creditMemoId: null,
      billedFactor: '1',
      creditedFactor: null,
      ...period,
    })),
    ...extra,
  }
}

function connectionEm(responses: Array<unknown[]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const em = {
    fork: () => em,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return responses.shift() ?? []
      },
    }),
  }
  return { em: em as never, calls }
}

describe('salesRecurrence adapter', () => {
  afterEach(() => {
    if (commandRegistry.get(SALES_RECURRENCE_CANCEL_COMMAND)) unregisterCommand(SALES_RECURRENCE_CANCEL_COMMAND)
    resetSalesRecurrenceAdapterCache()
  })

  it('fails with a typed refusal while sales has no recurrence cancellation', async () => {
    const container = { resolve: jest.fn() } as unknown as AwilixContainer
    expect(await isRecurrenceCancelAvailable()).toBe(false)
    await expect(
      cancelRecurrence(container, scope, {
        orderId: 'order-1',
        effectiveOn: '2026-05-15',
        settlement: 'keep',
        idempotencyKey: 'op-1',
        scheduleVersion: 3,
        allowCredit: false,
      }),
    ).rejects.toBeInstanceOf(SalesContractUnavailableError)
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it('dispatches the planned command with allowCredit and the trusted context', async () => {
    registerCommand({ id: SALES_RECURRENCE_CANCEL_COMMAND, execute: async () => ({}) })
    const execute = jest.fn(async () => ({ result: { status: 'cancelling', cancelEffectiveOn: '2026-05-15', creditMemoIds: ['cm-1'] } }))
    const container = { resolve: jest.fn(() => ({ execute })) } as unknown as AwilixContainer
    const result = await cancelRecurrence(container, scope, {
      orderId: 'order-1',
      effectiveOn: '2026-05-15',
      settlement: 'prorate',
      idempotencyKey: 'op-1',
      scheduleVersion: 3,
      allowCredit: false,
    })
    expect(result).toEqual({ status: 'cancelling', cancelEffectiveOn: '2026-05-15', creditMemoIds: ['cm-1'] })
    expect(execute).toHaveBeenCalledWith(SALES_RECURRENCE_CANCEL_COMMAND, {
      input: {
        orderId: 'order-1',
        effectiveOn: '2026-05-15',
        settlement: 'prorate',
        idempotencyKey: 'op-1',
        scheduleVersion: 3,
        allowCredit: false,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      ctx: expect.objectContaining({ auth: null, selectedOrganizationId: scope.organizationId }),
    })
  })

  it('previews what a cancellation would credit', () => {
    const issued = recurrence([
      { periodStart: '2026-01-10', periodEnd: '2026-02-09', invoiceId: 'inv-1' },
      { periodStart: '2026-02-10', periodEnd: '2026-03-09', invoiceId: 'inv-2' },
      { periodStart: '2026-03-10', periodEnd: '2026-04-09', invoiceId: 'inv-3' },
    ])
    expect(previewCancelCredit(issued, '2026-02-20', 'keep')).toEqual({
      wouldCredit: true,
      fullyCreditedPeriods: [2],
      finalPeriodIndex: 1,
      finalPeriodIssued: true,
    })
    expect(previewCancelCredit(issued, '2026-04-10', 'keep').wouldCredit).toBe(false)
    expect(previewCancelCredit(issued, '2026-04-01', 'keep').wouldCredit).toBe(false)
    expect(previewCancelCredit(issued, '2026-04-01', 'prorate').wouldCredit).toBe(true)
    expect(previewCancelCredit(issued, '2026-03-10', 'credit_full').wouldCredit).toBe(true)
    expect(previewCancelCredit(recurrence([]), '2026-03-10', 'credit_full').wouldCredit).toBe(false)
    expect(previewCancelCredit(null, '2026-03-10', 'prorate').wouldCredit).toBe(false)
  })

  it('knows when any invoice has been issued', () => {
    expect(hasIssuedInvoice(null)).toBe(false)
    expect(hasIssuedInvoice(recurrence([]))).toBe(false)
    expect(hasIssuedInvoice(recurrence([], { nextPeriodIndex: 1 }))).toBe(true)
    expect(hasIssuedInvoice(recurrence([{ invoiceId: 'inv-1' }]))).toBe(true)
  })

  it('reads the recurrence row and its periods read-only', async () => {
    const { em, calls } = connectionEm([
      [{ order_id: 'order-1', status: 'cancelling', starts_on: '2026-01-10', anchor_day: null, period_count: 12, ends_on: '2027-01-09', next_period_index: 2, next_invoice_on: '2026-03-10', schedule_version: 4, cancel_effective_on: '2026-06-10', cancel_settlement: 'keep' }],
      [{ period_index: 0, period_start: '2026-01-10', period_end: '2026-02-09', invoice_id: 'inv-1', credit_memo_id: null, billed_factor: '1', credited_factor: null }],
    ])
    const read = await readRecurrence(em, scope, 'order-1')
    expect(read).toMatchObject({ status: 'cancelling', scheduleVersion: 4, cancelEffectiveOn: '2026-06-10', nextPeriodIndex: 2 })
    expect(read?.periods).toEqual([
      { periodIndex: 0, periodStart: '2026-01-10', periodEnd: '2026-02-09', invoiceId: 'inv-1', creditMemoId: null, billedFactor: '1', creditedFactor: null },
    ])
    expect(calls.every((call) => /^\s*select/i.test(call.sql))).toBe(true)
  })

  it('returns null for an order without a recurrence', async () => {
    const { em } = connectionEm([[]])
    expect(await readRecurrence(em, scope, 'order-1')).toBeNull()
  })

  it('falls back to prorate while sales has no default settlement setting', async () => {
    const { em } = connectionEm([[]])
    expect(await defaultCancelSettlement(em, scope)).toBe('prorate')
  })

  it('reads the organization default settlement once sales stores it', async () => {
    const { em } = connectionEm([[{ column_name: 'recurring_cancel_settlement' }], [{ recurring_cancel_settlement: 'keep' }]])
    expect(await defaultCancelSettlement(em, scope)).toBe('keep')
  })
})
