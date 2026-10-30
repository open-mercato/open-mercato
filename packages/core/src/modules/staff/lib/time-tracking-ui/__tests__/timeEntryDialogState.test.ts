import {
  clockFromApiValue,
  combineDateAndClock,
  createIntervalState,
  describeTaskOption,
  reduceIntervalState,
  shiftIsoDate,
  toTaskOption,
  toTimeEntryRecord,
} from '../timeEntryDialogState'

describe('time entry interval state (2-of-3 arithmetic)', () => {
  it('derives the end from a start and a duration and marks it computed', () => {
    let state = createIntervalState({})
    state = reduceIntervalState(state, { field: 'start', value: '15:10' })
    state = reduceIntervalState(state, { field: 'duration', minutes: 75, invalid: false })

    expect(state.endText).toBe('16:25')
    expect(state.computed).toBe('end')
  })

  it('moves the badge to the duration when the end is edited', () => {
    let state = createIntervalState({ start: '15:10', durationMinutes: 75 })
    expect(state.computed).toBe('end')

    state = reduceIntervalState(state, { field: 'end', value: '17:00' })

    expect(state.computed).toBe('duration')
    expect(state.durationMinutes).toBe(110)
    expect(state.startText).toBe('15:10')
  })

  it('derives the start from an end and a duration', () => {
    let state = createIntervalState({})
    state = reduceIntervalState(state, { field: 'end', value: '13:30' })
    state = reduceIntervalState(state, { field: 'duration', minutes: 90, invalid: false })

    expect(state.startText).toBe('12:00')
    expect(state.computed).toBe('start')
  })

  it('opens a consistent stored entry with no badge at all', () => {
    const state = createIntervalState({ start: '09:00', end: '10:30', durationMinutes: 90 })
    expect(state.computed).toBeNull()
  })

  it('keeps half-typed clock text instead of rewriting it', () => {
    let state = createIntervalState({ durationMinutes: 60 })
    state = reduceIntervalState(state, { field: 'start', value: '15:1' })
    expect(state.startText).toBe('15:1')
    expect(state.computed).toBeNull()
  })

  it('reads an end before its start as crossing midnight', () => {
    const state = createIntervalState({ start: '23:00', end: '01:00' })
    expect(state.crossesMidnight).toBe(true)
    expect(state.durationMinutes).toBe(120)
  })

  it('snapping the start keeps the duration and moves the end', () => {
    let state = createIntervalState({ start: '11:00', end: '13:00' })
    expect(state.durationMinutes).toBe(120)

    state = reduceIntervalState(state, { field: 'snapStart', value: '13:30' })

    expect(state.startText).toBe('13:30')
    expect(state.durationMinutes).toBe(120)
    expect(state.endText).toBe('15:30')
    expect(state.computed).toBe('end')
  })

  it('bumps the duration epoch only when the derived duration changes', () => {
    let state = createIntervalState({ start: '15:10', durationMinutes: 75 })
    const before = state.durationEpoch

    state = reduceIntervalState(state, { field: 'end', value: '17:00' })
    expect(state.durationEpoch).toBe(before + 1)

    const afterEnd = state.durationEpoch
    state = reduceIntervalState(state, { field: 'duration', minutes: 60, invalid: false })
    expect(state.durationEpoch).toBe(afterEnd)
  })

  it('keeps an invalid duration flag until the field becomes machine-filled', () => {
    let state = createIntervalState({ start: '15:10' })
    state = reduceIntervalState(state, { field: 'duration', minutes: null, invalid: true })
    expect(state.durationInvalid).toBe(true)

    state = reduceIntervalState(state, { field: 'end', value: '16:25' })
    expect(state.durationInvalid).toBe(false)
    expect(state.durationMinutes).toBe(75)
  })
})

describe('time entry dialog helpers', () => {
  it('shifts a calendar date across a month boundary', () => {
    expect(shiftIsoDate('2026-07-31', 1)).toBe('2026-08-01')
  })

  it('composes a wall clock into an instant and adds a day when it crossed midnight', () => {
    const sameDay = combineDateAndClock('2026-07-20', '23:00')
    const nextDay = combineDateAndClock('2026-07-20', '01:00', 1)
    expect(sameDay).not.toBeNull()
    expect(nextDay).not.toBeNull()
    expect(new Date(nextDay as string).getTime() - new Date(sameDay as string).getTime()).toBe(2 * 60 * 60 * 1000)
  })

  it('reads a clock from both a wall clock and a stored timestamp', () => {
    expect(clockFromApiValue('11:45')).toBe('11:45')
    expect(clockFromApiValue(new Date(2026, 6, 20, 9, 5).toISOString())).toBe('09:05')
    expect(clockFromApiValue(null)).toBe('')
  })

  it('labels a task with its customer and project', () => {
    const label = describeTaskOption(
      { id: 'a', title: 'Migracja koszyka B2B', timeProjectId: 'p' },
      {
        id: 'p',
        name: 'migracja B2B',
        customerName: 'Nordvik',
        hourlyRate: 320,
        currencyCode: 'PLN',
        billableByDefault: true,
      },
    )
    expect(label).toBe('Migracja koszyka B2B — Nordvik — migracja B2B')
  })

  it('reads a locked entry row', () => {
    const record = toTimeEntryRecord({
      id: 'e1',
      date: '2026-07-20',
      started_at: '2026-07-20T09:00:00.000Z',
      duration_minutes: 60,
      notes: 'Analiza',
      isLocked: true,
      lockedReportId: 'r1',
      updated_at: '2026-07-20T10:00:00.000Z',
      tags: [{ id: 'tag-1', label: 'rozwój' }],
    })
    expect(record?.isLocked).toBe(true)
    expect(record?.lockedReportId).toBe('r1')
    expect(record?.tagIds).toEqual(['tag-1'])
    expect(record?.description).toBe('Analiza')
  })
})

describe('task option references', () => {
  it('carries the reference through from the API row', () => {
    const option = toTaskOption({ id: 't1', title: 'Booking flow rebuild', reference: 'APOLLO-14' })
    expect(option?.reference).toBe('APOLLO-14')
  })

  it('leads the picker label with the reference', () => {
    // "APOLLO-14" is what people say to each other and what a report quotes; two
    // projects with a "Consulting / workshops" are indistinguishable without it.
    const option = toTaskOption({ id: 't1', title: 'Consulting / workshops', reference: 'HBH-3' })!
    const label = describeTaskOption(option, {
      id: 'p1',
      name: 'HBH',
      customerName: 'HBH',
      hourlyRate: null,
      currencyCode: null,
      billableByDefault: true,
    })
    expect(label).toBe('HBH-3 · Consulting / workshops — HBH — HBH')
  })

  it('falls back to the plain label when a task has no reference', () => {
    const option = toTaskOption({ id: 't1', title: 'Untracked' })!
    expect(describeTaskOption(option, null)).toBe('Untracked')
  })
})
