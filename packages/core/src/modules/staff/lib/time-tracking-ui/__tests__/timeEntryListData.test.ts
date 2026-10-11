import {
  COPY_DAY_TARGET_NOT_EMPTY_CODE,
  TIME_ENTRY_LOCKED_CODE,
  collectDirectoryIds,
  currentWeekRange,
  formatEntryClockRange,
  isEntryLockedError,
  readCopyDayTargetConflict,
  summarizeTimeEntries,
  toTimeEntryListRow,
  type TimeEntryListRow,
} from '../timeEntryListData'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '44444444-4444-4444-8444-444444444444'

function row(overrides: Partial<TimeEntryListRow> = {}): TimeEntryListRow {
  return {
    id: ENTRY_ID,
    date: '2026-07-20',
    taskId: null,
    taskTitle: null,
    timeProjectId: null,
    projectLabel: null,
    description: null,
    startText: '',
    endText: '',
    durationMinutes: 60,
    roundedMinutes: 60,
    isBillable: true,
    cost: null,
    currencyCode: null,
    rateOverrideAmount: null,
    isLocked: false,
    lockedReportId: null,
    updatedAt: null,
    tagIds: [],
    ...overrides,
  }
}

describe('toTimeEntryListRow', () => {
  it('reads the decorated aliases and resolves the task and project labels', () => {
    const mapped = toTimeEntryListRow(
      {
        id: ENTRY_ID,
        date: '2026-07-20',
        task_id: TASK_ID,
        time_project_id: PROJECT_ID,
        description: 'Poprawki mapowania cen',
        started_at: '09:00',
        ended_at: '11:30',
        duration_minutes: 150,
        roundedMinutes: 150,
        is_billable: true,
        cost: 800,
        currencyCode: 'PLN',
        isLocked: false,
        updated_at: '2026-07-20T12:00:00.000Z',
        tags: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
      },
      {
        taskTitles: new Map([[TASK_ID, 'Migracja koszyka B2B']]),
        projectLabels: new Map([[PROJECT_ID, 'Nordvik — migracja B2B']]),
      },
    )

    expect(mapped).not.toBeNull()
    expect(mapped?.taskTitle).toBe('Migracja koszyka B2B')
    expect(mapped?.projectLabel).toBe('Nordvik — migracja B2B')
    expect(mapped?.durationMinutes).toBe(150)
    expect(mapped?.cost).toBe(800)
    expect(mapped?.tagIds).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
    expect(formatEntryClockRange(mapped!)).toBe('09:00 – 11:30')
  })

  it('marks a locked row and keeps the report that froze it', () => {
    const mapped = toTimeEntryListRow({
      id: ENTRY_ID,
      date: '2026-07-16',
      duration_minutes: 360,
      isLocked: true,
      lockedReportId: REPORT_ID,
    })
    expect(mapped?.isLocked).toBe(true)
    expect(mapped?.lockedReportId).toBe(REPORT_ID)
  })
})

describe('summarizeTimeEntries', () => {
  it('sums the displayed durations', () => {
    const summary = summarizeTimeEntries([
      row({ durationMinutes: 150 }),
      row({ durationMinutes: 105 }),
      row({ durationMinutes: 45 }),
    ])
    expect(summary.totalMinutes).toBe(300)
    expect(summary.visibleCount).toBe(3)
  })

  it('never adds two currencies together', () => {
    const summary = summarizeTimeEntries([
      row({ durationMinutes: 60, cost: 800, currencyCode: 'PLN' }),
      row({ durationMinutes: 60, cost: 200, currencyCode: 'EUR' }),
      row({ durationMinutes: 60, cost: 105, currencyCode: 'PLN' }),
    ])
    expect(summary.money).toHaveLength(2)
    expect(summary.money).toEqual(
      expect.arrayContaining([
        { currencyCode: 'PLN', amount: 905 },
        { currencyCode: 'EUR', amount: 200 },
      ]),
    )
    expect(summary.money.some((entry) => entry.amount === 1105)).toBe(false)
  })

  it('skips a non-billable row instead of adding a zero to its currency', () => {
    const summary = summarizeTimeEntries([
      row({ durationMinutes: 45, isBillable: false, cost: null, currencyCode: 'PLN' }),
    ])
    expect(summary.money).toHaveLength(0)
    expect(summary.totalMinutes).toBe(45)
  })
})

describe('error readers', () => {
  it('recognises the shared lock refusal on the flat and nested error shapes', () => {
    expect(isEntryLockedError(Object.assign(new Error('nope'), { status: 409, code: TIME_ENTRY_LOCKED_CODE }))).toBe(
      true,
    )
    expect(isEntryLockedError({ body: { code: 'entry_locked' } })).toBe(true)
    expect(isEntryLockedError(Object.assign(new Error('nope'), { status: 409, code: 'optimistic_lock_conflict' }))).toBe(
      false,
    )
  })

  it('reads the copy-day refusal with the count of what is already on the target day', () => {
    const conflict = readCopyDayTargetConflict(
      Object.assign(new Error('busy'), {
        status: 409,
        code: COPY_DAY_TARGET_NOT_EMPTY_CODE,
        toDate: '2026-07-21',
        existingEntryCount: 3,
        existingEntryIds: [ENTRY_ID],
      }),
    )
    expect(conflict).toEqual({ toDate: '2026-07-21', existingEntryCount: 3 })
    expect(readCopyDayTargetConflict(Object.assign(new Error('x'), { status: 500 }))).toBeNull()
  })
})

describe('currentWeekRange', () => {
  it('runs Monday to Sunday around the given day', () => {
    expect(currentWeekRange(new Date(2026, 6, 22))).toEqual({ from: '2026-07-20', to: '2026-07-26' })
    expect(currentWeekRange(new Date(2026, 6, 20))).toEqual({ from: '2026-07-20', to: '2026-07-26' })
    expect(currentWeekRange(new Date(2026, 6, 26))).toEqual({ from: '2026-07-20', to: '2026-07-26' })
  })
})

describe('collectDirectoryIds', () => {
  it('deduplicates the task and project ids on the page', () => {
    const ids = collectDirectoryIds([
      row({ taskId: TASK_ID, timeProjectId: PROJECT_ID }),
      row({ taskId: TASK_ID, timeProjectId: PROJECT_ID }),
      row({ taskId: null, timeProjectId: null }),
    ])
    expect(ids.taskIds).toEqual([TASK_ID])
    expect(ids.projectIds).toEqual([PROJECT_ID])
  })
})
