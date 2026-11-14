/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { SalesOrder, SalesOrderRecurrence } from '../../data/entities'
import {
  orderRecurrenceChanges,
  persistOrderRecurrence,
  restoreOrderRecurrence,
  retireOrderRecurrence,
  sameRecurrenceState,
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
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
      where.deletedAt === null && existing?.deletedAt ? null : existing,
    ),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((entity: Record<string, unknown>) => persisted.push(entity)),
    remove: jest.fn((entity: unknown) => removed.push(entity)),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      if (!existing || (where.deletedAt === null && existing.deletedAt)) return 0
      Object.assign(existing, data)
      return 1
    }),
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

  it('marks the recurrence deleted for null, keeping its schedule version', async () => {
    const existing: Record<string, unknown> = { frequency: 'monthly', startsOn: '2027-01-01', scheduleVersion: 3, deletedAt: null }
    const { em, removed } = buildEm(existing)
    await writeOrderRecurrence(em, order, null)
    expect(removed).toEqual([])
    expect(existing.deletedAt).toBeInstanceOf(Date)
    expect(existing.scheduleVersion).toBe(3)
  })

  it('adds a removed recurrence back on its row with the next schedule version', async () => {
    const existing: Record<string, unknown> = {
      frequency: 'monthly',
      startsOn: '2027-01-01',
      anchorDay: null,
      periodCount: null,
      scheduleVersion: 3,
      cancelSettlement: 'prorate',
      deletedAt: new Date('2026-11-01T00:00:00Z'),
    }
    const { em, persisted } = buildEm(existing)
    await writeOrderRecurrence(em, order, { frequency: 'monthly', startsOn: '2027-01-01' })
    expect(persisted).toHaveLength(0)
    expect(existing).toMatchObject({ scheduleVersion: 4, deletedAt: null, cancelSettlement: null, status: 'scheduled' })
  })
})

describe('orderRecurrenceChanges', () => {
  const current = { frequency: 'monthly', startsOn: '2027-01-01', anchorDay: null, periodCount: null, deletedAt: null }

  it('treats an echoed schedule as no change', async () => {
    const { em } = buildEm(current)
    await expect(orderRecurrenceChanges(em, order, { frequency: 'monthly', startsOn: '2027-01-01' })).resolves.toBe(false)
  })

  it('reports a set, changed or removed recurrence', async () => {
    await expect(orderRecurrenceChanges(buildEm(current).em, order, { frequency: 'yearly', startsOn: '2027-01-01' })).resolves.toBe(true)
    await expect(orderRecurrenceChanges(buildEm(current).em, order, null)).resolves.toBe(true)
    await expect(orderRecurrenceChanges(buildEm().em, order, { frequency: 'monthly', startsOn: '2027-01-01' })).resolves.toBe(true)
  })

  it('reports no change when nothing is sent or nothing is removed', async () => {
    await expect(orderRecurrenceChanges(buildEm(current).em, order, undefined)).resolves.toBe(false)
    await expect(orderRecurrenceChanges(buildEm().em, order, null)).resolves.toBe(false)
  })
})

describe('persistOrderRecurrence', () => {
  it('creates the recurrence without querying', () => {
    const { em, mock, persisted } = buildEm()
    persistOrderRecurrence(em, order, { frequency: 'weekly', startsOn: '2027-01-04', periodCount: 2 })
    expect(mock.findOne).not.toHaveBeenCalled()
    expect(persisted[0]).toMatchObject({ endsOn: '2027-01-17', nextInvoiceOn: '2027-01-04', status: 'scheduled' })
  })

  it('reuses the removed row of a deleted order with the next schedule version', () => {
    const removed: Record<string, unknown> = { frequency: 'monthly', scheduleVersion: 3, deletedAt: new Date(), cancelResult: { ok: true } }
    const { em, persisted } = buildEm()
    persistOrderRecurrence(em, order, { frequency: 'weekly', startsOn: '2027-01-04' }, removed as unknown as SalesOrderRecurrence)
    expect(persisted).toHaveLength(0)
    expect(removed).toMatchObject({ frequency: 'weekly', scheduleVersion: 4, deletedAt: null, cancelResult: null })
  })
})

describe('retireOrderRecurrence', () => {
  it('marks only the live recurrence of the order removed, within the order scope', async () => {
    const row: Record<string, unknown> = { scheduleVersion: 2, deletedAt: null }
    const { em, mock } = buildEm(row)
    await retireOrderRecurrence(em, order)
    expect(mock.nativeUpdate.mock.calls[0][1]).toEqual({ orderId: 'order-1', tenantId: 'ten-1', organizationId: 'org-1', deletedAt: null })
    expect(row).toMatchObject({ scheduleVersion: 2, deletedAt: expect.any(Date) })
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

  it('restores a removed recurrence on its row with a version above the removed one', async () => {
    const existing: Record<string, unknown> = { frequency: 'monthly', scheduleVersion: 4, deletedAt: new Date() }
    const { em, persisted } = buildEm(existing)
    await restoreOrderRecurrence(em, order, { ...snapshot, scheduleVersion: 4 })
    expect(persisted).toHaveLength(0)
    expect(existing).toMatchObject({ frequency: 'monthly', scheduleVersion: 5, deletedAt: null })
  })

  it('never reuses a schedule version across remove, undo and redo', async () => {
    const row: Record<string, unknown> = { ...snapshot, scheduleVersion: 1, deletedAt: null }
    const { em } = buildEm(row)
    const seen = [row.scheduleVersion as number]
    const record = () => {
      expect(row.scheduleVersion as number).toBeGreaterThan(Math.max(...seen))
      seen.push(row.scheduleVersion as number)
    }
    const removalSnapshot = { ...snapshot, scheduleVersion: row.scheduleVersion as number }
    await writeOrderRecurrence(em, order, null)
    await restoreOrderRecurrence(em, order, removalSnapshot)
    record()
    const redoSnapshot = { ...snapshot, scheduleVersion: row.scheduleVersion as number }
    await writeOrderRecurrence(em, order, null)
    await restoreOrderRecurrence(em, order, redoSnapshot)
    record()
    await restoreOrderRecurrence(em, order, null)
    await writeOrderRecurrence(em, order, { frequency: 'monthly', startsOn: '2027-01-01' })
    record()
    expect(row.deletedAt).toBeNull()
  })

  it('never reuses a schedule version across whole-order delete, undo and redo', async () => {
    const row: Record<string, unknown> = { ...snapshot, scheduleVersion: 4, deletedAt: null }
    const { em, persisted } = buildEm(row)
    const seen = [row.scheduleVersion as number]
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const deleteSnapshot = { ...snapshot, scheduleVersion: row.scheduleVersion as number }
      await retireOrderRecurrence(em, order)
      await restoreOrderRecurrence(em, order, deleteSnapshot)
      expect(row.scheduleVersion as number).toBeGreaterThan(Math.max(...seen))
      seen.push(row.scheduleVersion as number)
    }
    expect(persisted).toHaveLength(0)
    expect(row.deletedAt).toBeNull()
  })

  it('recreates a recurrence that has no row at all with its recorded version', async () => {
    const { em, persisted } = buildEm()
    await restoreOrderRecurrence(em, order, { ...snapshot, scheduleVersion: 4 })
    expect(persisted[0]).toMatchObject({ frequency: 'monthly', scheduleVersion: 4, deletedAt: null })
  })

  it('leaves the recurrence alone for snapshots recorded before recurrence existed', async () => {
    const { em, mock } = buildEm()
    await restoreOrderRecurrence(em, order, undefined)
    expect(mock.findOne).not.toHaveBeenCalled()
  })

  it('looks the recurrence up within the order scope', async () => {
    const { em, mock } = buildEm()
    await restoreOrderRecurrence(em, order, snapshot)
    expect(mock.findOne.mock.calls[0][1]).toEqual({ orderId: 'order-1', tenantId: 'ten-1', organizationId: 'org-1' })
  })
})

describe('sameRecurrenceState', () => {
  const recorded: OrderRecurrenceSnapshot = {
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

  it('ignores the schedule version an earlier undo bumped', () => {
    expect(sameRecurrenceState({ ...recorded, scheduleVersion: 3 }, recorded)).toBe(true)
  })

  it('detects a changed schedule or billing state', () => {
    expect(sameRecurrenceState({ ...recorded, frequency: 'yearly' }, recorded)).toBe(false)
    expect(sameRecurrenceState({ ...recorded, nextPeriodIndex: 1 }, recorded)).toBe(false)
    expect(sameRecurrenceState({ ...recorded, status: 'cancelling' }, recorded)).toBe(false)
  })

  it('detects an added or removed recurrence', () => {
    expect(sameRecurrenceState(null, recorded)).toBe(false)
    expect(sameRecurrenceState(recorded, null)).toBe(false)
    expect(sameRecurrenceState(null, null)).toBe(true)
  })

  it('matches anything for snapshots recorded before recurrence existed', () => {
    expect(sameRecurrenceState(recorded, undefined)).toBe(true)
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
