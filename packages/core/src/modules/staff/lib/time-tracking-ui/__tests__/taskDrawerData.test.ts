import {
  childMinutes,
  formatElapsed,
  formatSplitMinutes,
  resolveDefaultStatusId,
  resolveDoneStatusId,
  summarizeEntries,
  toDrawerComment,
  toDrawerEntry,
  todayIsoDate,
  type DrawerEntry,
} from '../taskDrawerData'
import type { BoardStatus } from '../kanbanBoardData'

function status(overrides: Partial<BoardStatus> & { id: string }): BoardStatus {
  return {
    name: overrides.id,
    slug: null,
    color: null,
    position: 0,
    isDefault: false,
    isDone: false,
    ...overrides,
  }
}

function entry(overrides: Partial<DrawerEntry> & { id: string }): DrawerEntry {
  return {
    taskId: 'task-1',
    date: '2026-07-20',
    description: null,
    durationMinutes: 60,
    isBillable: true,
    cost: null,
    currencyCode: null,
    ...overrides,
  }
}

describe('taskDrawerData', () => {
  describe('summarizeEntries', () => {
    it('splits billable from non-billable minutes', () => {
      const totals = summarizeEntries(
        [entry({ id: 'a', durationMinutes: 150 }), entry({ id: 'b', durationMinutes: 90, isBillable: false })],
        false,
      )
      expect(totals.billableMinutes).toBe(150)
      expect(totals.nonBillableMinutes).toBe(90)
    })

    it('keeps cost null when the caller may not see money', () => {
      const totals = summarizeEntries([entry({ id: 'a' }), entry({ id: 'b' })], false)
      expect(totals.cost).toBeNull()
      expect(totals.currencyCode).toBeNull()
    })

    it('sums cost and snapshots the currency when money is present', () => {
      const totals = summarizeEntries(
        [entry({ id: 'a', cost: 800, currencyCode: 'PLN' }), entry({ id: 'b', cost: 200, currencyCode: 'PLN' })],
        true,
      )
      expect(totals.cost).toBe(1000)
      expect(totals.currencyCode).toBe('PLN')
      expect(totals.partial).toBe(true)
    })
  })

  describe('status resolution', () => {
    const statuses = [
      status({ id: 'backlog', isDefault: true }),
      status({ id: 'progress' }),
      status({ id: 'done', isDone: true }),
      status({ id: 'archived', isDone: true }),
    ]

    it('ticks into the first done column', () => {
      expect(resolveDoneStatusId(statuses)).toBe('done')
    })

    it('unticks back into the default column', () => {
      expect(resolveDefaultStatusId(statuses)).toBe('backlog')
    })

    it('falls back to the first open column when no column is flagged default', () => {
      expect(resolveDefaultStatusId([status({ id: 'progress' }), status({ id: 'done', isDone: true })])).toBe('progress')
    })

    it('reports no done column rather than guessing one', () => {
      expect(resolveDoneStatusId([status({ id: 'backlog', isDefault: true })])).toBeNull()
    })
  })

  describe('rollup arithmetic', () => {
    it('derives the children part of the inclusive rollup', () => {
      expect(childMinutes(1365, 600)).toBe(765)
    })

    it('never reports negative children minutes', () => {
      expect(childMinutes(600, 900)).toBe(0)
    })

    it('formats the split as a duration', () => {
      expect(formatSplitMinutes(765)).toBe('12h 45m')
      expect(formatSplitMinutes(0)).toBe('0m')
    })
  })

  describe('formatElapsed', () => {
    it('renders the running time as a clock', () => {
      const started = '2026-08-12T09:00:00.000Z'
      expect(formatElapsed(started, Date.parse(started) + (74 * 60 + 2) * 1000)).toBe('01:14:02')
    })

    it('degrades to zero for a missing or unparseable start', () => {
      expect(formatElapsed(null, Date.now())).toBe('00:00:00')
      expect(formatElapsed('not a date', Date.now())).toBe('00:00:00')
    })
  })

  describe('row parsing', () => {
    it('reads a comment row', () => {
      expect(
        toDrawerComment({ id: 'c1', body: 'Hej', authorName: 'Anna Nowak', createdAt: '2026-07-17T14:22:00.000Z' }),
      ).toEqual({
        id: 'c1',
        body: 'Hej',
        authorUserId: null,
        authorName: 'Anna Nowak',
        authorEmail: null,
        createdAt: '2026-07-17T14:22:00.000Z',
      })
    })

    it('drops a comment row with no body', () => {
      expect(toDrawerComment({ id: 'c1' })).toBeNull()
    })

    it('treats a missing billable flag as billable, and an absent cost as unknown', () => {
      const parsed = toDrawerEntry({ id: 'e1', task_id: 'task-1', duration_minutes: 30 })
      expect(parsed?.isBillable).toBe(true)
      expect(parsed?.cost).toBeNull()
    })

    it('honours an explicit non-billable flag', () => {
      expect(toDrawerEntry({ id: 'e1', is_billable: false })?.isBillable).toBe(false)
    })
  })

  it('formats today as an ISO date', () => {
    expect(todayIsoDate(new Date(2026, 7, 3))).toBe('2026-08-03')
  })
})
