/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { InvalidFieldNameException } from '@mikro-orm/core'
import { commandRegistry, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'
import {
  cancelRecurrence,
  defaultCancelSettlement,
  hasIssuedInvoice,
  isRecurrenceCancelAvailable,
  previewCancelCredit,
  readRecurrence,
  readRecurrences,
  SALES_RECURRENCE_CANCEL_ALLOW_CREDIT_CAPABILITY,
  SALES_RECURRENCE_CANCEL_COMMAND,
  type RecurrenceRead,
} from '../lib/salesRecurrence'
import { SalesContractUnavailableError } from '../lib/salesErrors'

const reportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))

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
    getTransactionContext: () => undefined,
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

  it('stays unavailable while the registered cancel does not honour allowCredit', async () => {
    registerCommand({ id: SALES_RECURRENCE_CANCEL_COMMAND, execute: async () => ({}) })
    const execute = jest.fn(async () => ({ result: { status: 'cancelled', cancelEffectiveOn: '2026-01-10', creditMemoIds: [] } }))
    const container = { resolve: jest.fn(() => ({ execute })) } as unknown as AwilixContainer
    expect(await isRecurrenceCancelAvailable()).toBe(false)
    const base = { orderId: 'order-1', effectiveOn: '2026-01-10', settlement: 'credit_full' as const, idempotencyKey: 'op-1', scheduleVersion: 3 }
    await expect(cancelRecurrence(container, scope, { ...base, allowCredit: false })).rejects.toBeInstanceOf(SalesContractUnavailableError)
    expect(execute).not.toHaveBeenCalled()
    await cancelRecurrence(container, scope, { ...base, allowCredit: true })
    expect(execute).toHaveBeenCalledWith(SALES_RECURRENCE_CANCEL_COMMAND, expect.objectContaining({ input: expect.not.objectContaining({ allowCredit: expect.anything() }) }))
  })

  it('dispatches the planned command with allowCredit and the trusted context', async () => {
    registerCommand({ id: SALES_RECURRENCE_CANCEL_COMMAND, execute: async () => ({}), capabilities: [SALES_RECURRENCE_CANCEL_ALLOW_CREDIT_CAPABILITY] } as never)
    expect(await isRecurrenceCancelAvailable()).toBe(true)
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

  it('falls back to keep, the sales default, while the organization has no sales settings row', async () => {
    const { em } = connectionEm([[]])
    expect(await defaultCancelSettlement(em, scope)).toBe('keep')
  })

  it('falls back to keep while sales has no settlement column, re-checking on every call instead of remembering the absence', async () => {
    const missingColumn = Object.assign(new Error('column "recurring_cancel_settlement" does not exist'), { code: '42703' })
    let columnExists = false
    const calls: string[] = []
    const em = {
      fork: () => em,
      getConnection: () => ({
        execute: async (sql: string) => {
          calls.push(sql)
          if (!columnExists) throw missingColumn
          return [{ recurring_cancel_settlement: 'prorate' }]
        },
      }),
    }
    expect(await defaultCancelSettlement(em as never, scope)).toBe('keep')
    columnExists = true
    expect(await defaultCancelSettlement(em as never, scope)).toBe('prorate')
    expect(calls).toHaveLength(2)
    expect(calls.every((sql) => !sql.includes('information_schema'))).toBe(true)
  })

  it('treats the converted MikroORM undefined-column error as a missing setting', async () => {
    const converted = new InvalidFieldNameException(Object.assign(new Error('column does not exist'), { code: '42703' }))
    const em = { fork: () => em, getConnection: () => ({ execute: async () => { throw converted } }) }
    expect(await defaultCancelSettlement(em as never, scope)).toBe('keep')
  })

  it('fails instead of guessing keep when the settlement cannot be read', async () => {
    const failure = Object.assign(new Error('connection terminated'), { code: '57P01' })
    const readFails = { fork: () => readFails, getConnection: () => ({ execute: async () => { throw failure } }) }
    await expect(defaultCancelSettlement(readFails as never, scope)).rejects.toBe(failure)
  })

  it('reports a registry failure while treating the cancel as unavailable', async () => {
    reportError.mockClear()
    const failure = new Error('[internal] registry broken')
    const load = jest.spyOn(commandRegistry, 'load').mockRejectedValueOnce(failure)
    try {
      expect(await isRecurrenceCancelAvailable()).toBe(false)
    } finally {
      load.mockRestore()
    }
    expect(reportError).toHaveBeenCalledWith(failure, { module: 'property_management', code: 'property_management.recurrence_cancel_lookup_failed' })
  })

  it('reads the organization default settlement once sales stores it', async () => {
    const { em, calls } = connectionEm([[{ recurring_cancel_settlement: 'credit_full' }]])
    expect(await defaultCancelSettlement(em, scope)).toBe('credit_full')
    expect(calls).toEqual([{ sql: expect.stringContaining('select recurring_cancel_settlement from sales_settings'), params: [scope.organizationId, scope.tenantId] }])
  })
})

describe('readRecurrences', () => {
  it('reads every order recurrence and its periods in two queries', async () => {
    const { em, calls } = connectionEm([
      [
        { order_id: 'order-1', status: 'active', starts_on: '2026-01-10', anchor_day: null, period_count: 12, ends_on: '2027-01-09', next_period_index: 1, next_invoice_on: '2026-02-10', schedule_version: 2, cancel_effective_on: null, cancel_settlement: null },
        { order_id: 'order-2', status: 'scheduled', starts_on: '2027-01-10', anchor_day: null, period_count: 6, ends_on: '2027-07-09', next_period_index: 0, next_invoice_on: '2027-01-10', schedule_version: 1, cancel_effective_on: null, cancel_settlement: null },
      ],
      [
        { order_id: 'order-1', period_index: 0, period_start: '2026-01-10', period_end: '2026-02-09', invoice_id: 'inv-1', credit_memo_id: null, billed_factor: '1', credited_factor: null },
      ],
    ])
    const reads = await readRecurrences(em, scope, ['order-1', '', 'order-2', 'order-1', 'order-gone'])
    expect(calls).toHaveLength(2)
    expect(calls[0].params).toEqual(['order-1', 'order-2', 'order-gone', scope.organizationId, scope.tenantId])
    expect(calls[1].params).toEqual(['order-1', 'order-2', scope.organizationId, scope.tenantId])
    expect(calls.every((call) => /^\s*select/i.test(call.sql))).toBe(true)
    expect(reads.get('order-1')).toMatchObject({ status: 'active', scheduleVersion: 2, invoicesAvailable: true, periods: [{ periodIndex: 0, invoiceId: 'inv-1' }] })
    expect(reads.get('order-2')).toMatchObject({ status: 'scheduled', periods: [] })
    expect(reads.has('order-gone')).toBe(false)
  })

  function periodsFailingEm(error: unknown) {
    const em = {
      fork: () => em,
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async (sql: string) => {
          if (sql.includes('sales_recurring_periods')) throw error
          return [{ order_id: 'order-1', status: 'active', starts_on: '2026-01-10', next_period_index: 0, schedule_version: 1 }]
        },
      }),
    }
    return em as never
  }

  it('skips the queries without orders and marks invoices unavailable while the periods table does not exist', async () => {
    const empty = connectionEm([])
    expect((await readRecurrences(empty.em, scope, ['', ''])).size).toBe(0)
    expect(empty.calls).toHaveLength(0)
    const missing = Object.assign(new Error('relation "sales_recurring_periods" does not exist'), { code: '42P01' })
    const reads = await readRecurrences(periodsFailingEm(missing), scope, ['order-1'])
    expect(reads.get('order-1')).toMatchObject({ invoicesAvailable: false, periods: [] })
    expect(await readRecurrence(periodsFailingEm(missing), scope, 'order-1')).toMatchObject({ invoicesAvailable: false, periods: [] })
    const wrapped = Object.assign(new Error('table not found'), { cause: { code: '42P01' } })
    expect((await readRecurrences(periodsFailingEm(wrapped), scope, ['order-1'])).get('order-1')).toMatchObject({ invoicesAvailable: false })
  })

  it('rethrows every other periods error instead of under-reporting invoices', async () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    await expect(readRecurrences(periodsFailingEm(timeout), scope, ['order-1'])).rejects.toBe(timeout)
    await expect(readRecurrence(periodsFailingEm(timeout), scope, 'order-1')).rejects.toBe(timeout)
  })

  function transactionEm(periods: () => unknown[]) {
    const transactionContext = { id: 'trx' }
    const statements: string[] = []
    const execute = jest.fn(async (sql: string, _params: unknown[], _method: string, ctx: unknown) => {
      expect(ctx).toBe(transactionContext)
      statements.push(sql.replace(/\s+/g, ' ').trim())
      if (sql.includes('sales_recurring_periods')) return periods()
      if (sql.includes('sales_order_recurrences')) return [{ order_id: 'order-1', status: 'active', starts_on: '2026-01-10', next_period_index: 0, schedule_version: 1 }]
      return []
    })
    const em = { fork: jest.fn(), getTransactionContext: () => transactionContext, getConnection: () => ({ execute }) }
    return { em: em as never, statements }
  }

  it('reads the periods behind a savepoint so a missing table cannot abort the caller transaction', async () => {
    const missing = transactionEm(() => {
      throw Object.assign(new Error('relation "sales_recurring_periods" does not exist'), { code: '42P01' })
    })
    expect(await readRecurrence(missing.em, scope, 'order-1')).toMatchObject({ invoicesAvailable: false, periods: [] })
    expect(missing.statements.filter((sql) => !sql.startsWith('select'))).toEqual([
      'savepoint property_management_recurring_periods',
      'rollback to savepoint property_management_recurring_periods',
    ])
    const present = transactionEm(() => [])
    expect((await readRecurrences(present.em, scope, ['order-1'])).get('order-1')).toMatchObject({ invoicesAvailable: true })
    expect(present.statements.filter((sql) => !sql.startsWith('select'))).toEqual([
      'savepoint property_management_recurring_periods',
      'release savepoint property_management_recurring_periods',
    ])
  })

  it('rolls back to the savepoint and rethrows any other periods error inside a transaction', async () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    const failing = transactionEm(() => {
      throw timeout
    })
    await expect(readRecurrence(failing.em, scope, 'order-1')).rejects.toBe(timeout)
    expect(failing.statements.at(-1)).toBe('rollback to savepoint property_management_recurring_periods')
  })

  it('runs its reads on the caller transaction connection', async () => {
    const transactionContext = { id: 'trx' }
    const execute = jest.fn(async () => [])
    const em = { fork: jest.fn(), getTransactionContext: () => transactionContext, getConnection: () => ({ execute }) }
    await readRecurrence(em as never, scope, 'order-1')
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('sales_order_recurrences'), expect.any(Array), 'all', transactionContext)
    expect(em.fork).not.toHaveBeenCalled()
  })
})
