/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { SalesOrder, SalesOrderRecurrence } from '../../data/entities'
import {
  persistNewOrderRecurrence,
  restoreOrderRecurrence,
  writeOrderRecurrence,
  writeQuoteRecurrence,
  type OrderRecurrenceSnapshot,
} from '../recurrenceStore'
import { assertRecurringQuoteConvertible } from '../recurringOrderGuard'

const order = { id: 'order-1', tenantId: 'ten-1', organizationId: 'org-1' } as SalesOrder

function buildEm(existing: Record<string, unknown> | null = null) {
  const persisted: Array<Record<string, unknown>> = []
  const removed: unknown[] = []
  const em = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((entity: Record<string, unknown>) => persisted.push(entity)),
    remove: jest.fn((entity: unknown) => removed.push(entity)),
  }
  return { em: em as unknown as EntityManager, mock: em, persisted, removed }
}

describe('writeOrderRecurrence', () => {
  it('creates a scheduled recurrence whose first invoice is due on the start date', async () => {
    const { em, persisted } = buildEm()
    await writeOrderRecurrence(em, order, { frequency: 'monthly', startsOn: '2027-01-31', periodCount: 3 })
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      organizationId: 'org-1',
      tenantId: 'ten-1',
      frequency: 'monthly',
      startsOn: '2027-01-31',
      anchorDay: null,
      periodCount: 3,
      endsOn: '2027-04-29',
      nextPeriodIndex: 0,
      nextInvoiceOn: '2027-01-31',
      status: 'scheduled',
      scheduleVersion: 1,
    })
  })

  it('leaves the recurrence alone when the input is undefined', async () => {
    const { em, mock } = buildEm()
    await writeOrderRecurrence(em, order, undefined)
    expect(mock.findOne).not.toHaveBeenCalled()
  })

  it('replaces a changed schedule and bumps the schedule version', async () => {
    const existing = {
      frequency: 'monthly',
      startsOn: '2027-01-01',
      anchorDay: null,
      periodCount: null,
      endsOn: null,
      scheduleVersion: 3,
    } as unknown as SalesOrderRecurrence
    const { em, persisted } = buildEm(existing as never)
    await writeOrderRecurrence(em, order, { frequency: 'yearly', startsOn: '2027-02-01', periodCount: 2 })
    expect(persisted).toHaveLength(0)
    expect(existing).toMatchObject({
      frequency: 'yearly',
      startsOn: '2027-02-01',
      periodCount: 2,
      endsOn: '2029-01-31',
      nextInvoiceOn: '2027-02-01',
      scheduleVersion: 4,
    })
  })

  it('keeps the schedule version when the same schedule is sent again', async () => {
    const existing = { frequency: 'monthly', startsOn: '2027-01-01', anchorDay: null, periodCount: null, scheduleVersion: 3 }
    const { em } = buildEm(existing)
    await writeOrderRecurrence(em, order, { frequency: 'monthly', startsOn: '2027-01-01' })
    expect(existing.scheduleVersion).toBe(3)
  })

  it('removes the recurrence for null', async () => {
    const existing = { frequency: 'monthly', startsOn: '2027-01-01' }
    const { em, removed } = buildEm(existing)
    await writeOrderRecurrence(em, order, null)
    expect(removed).toEqual([existing])
  })
})

describe('persistNewOrderRecurrence', () => {
  it('creates the recurrence without querying', () => {
    const { em, mock, persisted } = buildEm()
    persistNewOrderRecurrence(em, order, { frequency: 'weekly', startsOn: '2027-01-04', periodCount: 2 })
    expect(mock.findOne).not.toHaveBeenCalled()
    expect(persisted[0]).toMatchObject({ endsOn: '2027-01-17', nextInvoiceOn: '2027-01-04', status: 'scheduled' })
  })
})

describe('restoreOrderRecurrence', () => {
  const snapshot: OrderRecurrenceSnapshot = {
    frequency: 'monthly',
    startsOn: '2027-01-01',
    anchorDay: null,
    periodCount: null,
    endsOn: null,
    nextPeriodIndex: 0,
    nextInvoiceOn: '2027-01-01',
    status: 'scheduled',
    scheduleVersion: 1,
    cancelRequestedAt: null,
    cancelEffectiveOn: null,
    cancelSettlement: null,
    cancelledByUserId: null,
    cancelIdempotencyKey: null,
    cancelResult: null,
  }

  it('restores the recorded schedule but never moves the schedule version backwards', async () => {
    const existing = { frequency: 'yearly', startsOn: '2027-02-01', scheduleVersion: 2 }
    const { em } = buildEm(existing)
    await restoreOrderRecurrence(em, order, snapshot)
    expect(existing).toMatchObject({ frequency: 'monthly', startsOn: '2027-01-01', scheduleVersion: 3 })
  })

  it('recreates a removed recurrence with its recorded version', async () => {
    const { em, persisted } = buildEm()
    await restoreOrderRecurrence(em, order, { ...snapshot, scheduleVersion: 4 })
    expect(persisted[0]).toMatchObject({ frequency: 'monthly', scheduleVersion: 4 })
  })

  it('leaves the recurrence alone for snapshots recorded before recurrence existed', async () => {
    const { em, mock } = buildEm()
    await restoreOrderRecurrence(em, order, undefined)
    expect(mock.findOne).not.toHaveBeenCalled()
  })
})

describe('writeQuoteRecurrence', () => {
  it('stores only the schedule on a quote', async () => {
    const { em, persisted } = buildEm()
    await writeQuoteRecurrence(em, { id: 'quote-1', tenantId: 'ten-1', organizationId: 'org-1' } as never, {
      frequency: 'quarterly',
      startsOn: '2026-11-30',
      anchorDay: 31,
    })
    expect(persisted[0]).toMatchObject({ frequency: 'quarterly', startsOn: '2026-11-30', anchorDay: 31, periodCount: null })
    expect(persisted[0]).not.toHaveProperty('status')
  })
})

describe('assertRecurringQuoteConvertible', () => {
  it('passes for a quote without recurrence', async () => {
    await expect(assertRecurringQuoteConvertible(null, 0, '2026-10-26')).resolves.toBeUndefined()
  })

  it('passes on and before the start date', async () => {
    await expect(assertRecurringQuoteConvertible({ startsOn: '2026-10-26' }, 1, '2026-10-26')).resolves.toBeUndefined()
    await expect(assertRecurringQuoteConvertible({ startsOn: '2026-11-01' }, 1, '2026-10-26')).resolves.toBeUndefined()
  })

  it('refuses after the start date with 422 recurring_quote_started', async () => {
    await expect(assertRecurringQuoteConvertible({ startsOn: '2026-10-25' }, 1, '2026-10-26')).rejects.toMatchObject({
      status: 422,
      body: { code: 'recurring_quote_started' },
    })
  })

  it('refuses a recurring quote without lines', async () => {
    await expect(assertRecurringQuoteConvertible({ startsOn: '2026-11-01' }, 0, '2026-10-26')).rejects.toMatchObject({
      status: 422,
      body: { code: 'recurring_quote_no_lines' },
    })
  })
})
