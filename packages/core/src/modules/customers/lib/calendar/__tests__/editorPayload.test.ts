import {
  buildInteractionPayload,
  buildRecurrenceRule,
  computeDurationMinutes,
  createDefaultFormState,
  defaultRepeatDaysForDateInput,
  editorKindOfInteractionType,
  parseItemToFormState,
  priorityFromNumber,
  PRIORITY_NUMBER,
  type EditorFormState,
} from '../editorPayload'
import { mapInteractionToCalendarItem } from '../mapItem'
import { makePayload } from './fixtures'
import type { CalendarInteractionPayload, CalendarItem } from '../../../components/calendar/types'

function makeState(overrides: Partial<EditorFormState> = {}): EditorFormState {
  return {
    ...createDefaultFormState(new Date(2026, 5, 12, 0, 0, 0), new Date(2026, 5, 12, 14, 12, 0)),
    title: 'Q2 Marketing Strategy Sync',
    relatedTo: { id: '11111111-1111-4111-8111-111111111111', kind: 'person', label: 'Sarah Mitchell' },
    ...overrides,
  }
}

function itemFromPayload(payload: Record<string, unknown>, id = 'item-1'): CalendarItem {
  const mapped = mapInteractionToCalendarItem(
    makePayload({
      id,
      interactionType: payload.interactionType as string,
      title: (payload.title as string) ?? null,
      status: (payload.status as string) ?? 'planned',
      scheduledAt: payload.scheduledAt as string,
      durationMinutes: (payload.durationMinutes as number | null) ?? null,
      allDay: (payload.allDay as boolean | null) ?? null,
      location: (payload.location as string | null) ?? null,
      participants: (payload.participants as CalendarInteractionPayload['participants']) ?? null,
      recurrenceRule: (payload.recurrenceRule as string | null) ?? null,
      recurrenceEnd: (payload.recurrenceEnd as string | null) ?? null,
      ownerUserId: (payload.ownerUserId as string | null) ?? null,
      entityId: (payload.entityId as string | null) ?? null,
      dealId: (payload.dealId as string | null) ?? null,
      body: (payload.body as string | null) ?? null,
      priority: (payload.priority as number | null) ?? null,
    } as Partial<CalendarInteractionPayload> & { id: string }),
    {},
  )
  if (!mapped) throw new Error('[internal] fixture payload did not map to a calendar item')
  return mapped
}

describe('editorKindOfInteractionType', () => {
  it('maps known interaction types onto editor kinds and defaults to meeting', () => {
    expect(editorKindOfInteractionType('video-call')).toBe('call')
    expect(editorKindOfInteractionType('webinar')).toBe('event')
    expect(editorKindOfInteractionType('todo')).toBe('task')
    expect(editorKindOfInteractionType('custom-type')).toBe('meeting')
  })
})

describe('createDefaultFormState', () => {
  it('starts at the next full hour on the default date with a 90 minute duration', () => {
    const state = createDefaultFormState(new Date(2026, 5, 20), new Date(2026, 5, 12, 14, 12, 0))
    expect(state.date).toBe('2026-06-20')
    expect(state.startTime).toBe('15:00')
    expect(state.endDate).toBe('2026-06-20')
    expect(state.endTime).toBe('16:30')
    expect(state.kind).toBe('meeting')
    expect(state.status).toBe('planned')
  })
})

describe('buildInteractionPayload — meeting', () => {
  it('produces a create payload with computed duration and planned status', () => {
    const state = makeState({ description: 'Align on Q2 mix.', location: 'https://meet.google.com/abc-defg-hij' })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.id).toBeUndefined()
    expect(payload.entityId).toBe('11111111-1111-4111-8111-111111111111')
    expect(payload.interactionType).toBe('meeting')
    expect(payload.status).toBe('planned')
    expect(payload.durationMinutes).toBe(90)
    expect(payload.allDay).toBe(false)
    expect(payload.location).toBe('https://meet.google.com/abc-defg-hij')
    expect(payload.body).toBe('Align on Q2 mix.')
    expect(payload.scheduledAt).toBe(new Date('2026-06-12T15:00:00').toISOString())
    expect(payload.recurrenceRule).toBeNull()
    expect(payload).not.toHaveProperty('priority')
    expect(payload).not.toHaveProperty('ownerUserId')
  })

  it('round-trips through the calendar item mapping', () => {
    const state = makeState({
      category: 'meeting',
      participants: [
        { userId: '22222222-2222-4222-8222-222222222222', name: 'Anna Kowalska', email: 'anna@acme.test', isCustomer: false },
        { userId: '33333333-3333-4333-8333-333333333333', name: 'Globex Corp · J. Diaz', isCustomer: true },
      ],
      description: 'Budget split and launch calendar.',
    })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    const parsed = parseItemToFormState(itemFromPayload(payload))
    expect(parsed.kind).toBe('meeting')
    expect(parsed.title).toBe(state.title)
    expect(parsed.date).toBe(state.date)
    expect(parsed.startTime).toBe(state.startTime)
    expect(parsed.endDate).toBe(state.endDate)
    expect(parsed.endTime).toBe(state.endTime)
    expect(parsed.description).toBe('Budget split and launch calendar.')
    expect(parsed.participants).toEqual([
      { userId: '22222222-2222-4222-8222-222222222222', name: 'Anna Kowalska', email: 'anna@acme.test', isCustomer: false },
      { userId: '33333333-3333-4333-8333-333333333333', name: 'Globex Corp · J. Diaz', email: undefined, isCustomer: true },
    ])
    expect(parsed.relatedTo?.id).toBe(state.relatedTo?.id)
    expect(parsed.status).toBe('planned')
  })
})

describe('buildInteractionPayload — recurrence', () => {
  it('builds a weekly BYDAY rule from monday-first day flags', () => {
    const state = makeState({
      repeatFreq: 'weekly',
      repeatDays: [true, false, true, false, false, false, false],
    })
    expect(buildRecurrenceRule(state)).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })

  it('falls back to the start weekday when no day pill is active', () => {
    const state = makeState({ repeatFreq: 'weekly', repeatDays: [false, false, false, false, false, false, false] })
    expect(buildRecurrenceRule(state)).toBe('FREQ=WEEKLY;BYDAY=FR')
  })

  it('derives the default weekly day pill from the start date input, not from today', () => {
    expect(defaultRepeatDaysForDateInput('2026-06-09')).toEqual([
      false, true, false, false, false, false, false,
    ])
    const movedToTuesday = makeState({
      date: '2026-06-09',
      repeatFreq: 'weekly',
      repeatDays: defaultRepeatDaysForDateInput('2026-06-09'),
    })
    expect(buildRecurrenceRule(movedToTuesday)).toBe('FREQ=WEEKLY;BYDAY=TU')
  })

  it('appends COUNT for the After end mode and round-trips it', () => {
    const state = makeState({
      repeatFreq: 'weekly',
      repeatDays: [true, false, true, false, false, false, false],
      repeatEndType: 'count',
      repeatCount: 6,
    })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6')
    const parsed = parseItemToFormState(itemFromPayload(payload))
    expect(parsed.repeatFreq).toBe('weekly')
    expect(parsed.repeatDays).toEqual([true, false, true, false, false, false, false])
    expect(parsed.repeatEndType).toBe('count')
    expect(parsed.repeatCount).toBe(6)
  })

  it('appends UNTIL for the On date end mode and round-trips the date', () => {
    const until = '2020-08-31'
    const state = makeState({
      repeatFreq: 'weekly',
      repeatDays: [false, true, false, false, false, false, false],
      repeatEndType: 'date',
      repeatUntilDate: until,
    })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=TU;UNTIL=20200831T235959Z')
    expect(payload.recurrenceEnd).toBe(new Date(until).toISOString())
    const parsed = parseItemToFormState(itemFromPayload(payload))
    expect(parsed.repeatEndType).toBe('date')
    expect(parsed.repeatUntilDate).toBe(until)
  })

  it('supports the daily frequency within the platform parser subset', () => {
    const state = makeState({ repeatFreq: 'daily' })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.recurrenceRule).toBe('FREQ=DAILY')
    const parsed = parseItemToFormState(itemFromPayload(payload))
    expect(parsed.repeatFreq).toBe('daily')
  })
})

describe('buildInteractionPayload — all day', () => {
  it('schedules at local midnight with no duration and round-trips the flag', () => {
    const state = makeState({ allDay: true })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.time).toBe('00:00')
    expect(payload.scheduledAt).toBe(new Date('2026-06-12T00:00:00').toISOString())
    expect(payload.durationMinutes).toBeNull()
    expect(payload.allDay).toBe(true)
    const parsed = parseItemToFormState(itemFromPayload(payload))
    expect(parsed.allDay).toBe(true)
    expect(parsed.date).toBe('2026-06-12')
  })
})

describe('buildInteractionPayload — single date kinds', () => {
  it.each(['call', 'email', 'task'] as const)('%s sends no duration and keeps the single datetime', (kind) => {
    const state = makeState({ kind })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.durationMinutes).toBeNull()
    expect(payload.scheduledAt).toBe(new Date('2026-06-12T15:00:00').toISOString())
    const parsed = parseItemToFormState(itemFromPayload(payload))
    expect(parsed.kind).toBe(kind)
    expect(parsed.date).toBe('2026-06-12')
    expect(parsed.startTime).toBe('15:00')
  })

  it('note omits all-day, repeat, location and people entirely', () => {
    const state = makeState({
      kind: 'note',
      allDay: true,
      repeatFreq: 'weekly',
      location: 'somewhere',
      participants: [{ userId: '44444444-4444-4444-8444-444444444444', name: 'X', isCustomer: false }],
    })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.allDay).toBeNull()
    expect(payload.recurrenceRule).toBeNull()
    expect(payload.location).toBeNull()
    expect(payload.participants).toBeNull()
    expect(payload.time).toBe('15:00')
  })

  it('call sends the phone/link through location', () => {
    const state = makeState({ kind: 'call', location: '+48 600 123 456' })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.location).toBe('+48 600 123 456')
  })
})

describe('buildInteractionPayload — task', () => {
  it('maps assignee to ownerUserId and priority to the numeric scale', () => {
    const state = makeState({
      kind: 'task',
      assigneeUserId: '55555555-5555-4555-8555-555555555555',
      assigneeName: 'Anna Kowalska',
      priority: 'high',
    })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload.ownerUserId).toBe('55555555-5555-4555-8555-555555555555')
    expect(payload.priority).toBe(PRIORITY_NUMBER.high)
    expect(payload.participants).toBeNull()
    const parsed = parseItemToFormState(itemFromPayload(payload))
    expect(parsed.kind).toBe('task')
    expect(parsed.assigneeUserId).toBe('55555555-5555-4555-8555-555555555555')
    expect(parsed.priority).toBe('high')
  })

  it('keeps priority thresholds symmetric with the numeric mapping', () => {
    expect(priorityFromNumber(PRIORITY_NUMBER.low)).toBe('low')
    expect(priorityFromNumber(PRIORITY_NUMBER.medium)).toBe('medium')
    expect(priorityFromNumber(PRIORITY_NUMBER.high)).toBe('high')
    expect(priorityFromNumber(null)).toBe('medium')
  })
})

describe('buildInteractionPayload — edit mode', () => {
  it('includes the id, preserves status, and selects the explicit category as interaction type', () => {
    const state = makeState({ status: 'done', category: 'sales-call', kind: 'call' })
    const payload = buildInteractionPayload(state, { mode: 'edit', id: 'abc-123' })
    expect(payload.id).toBe('abc-123')
    expect(payload.status).toBe('done')
    expect(payload.interactionType).toBe('sales-call')
  })
})

describe('computeDurationMinutes', () => {
  it('returns null for non-positive ranges', () => {
    const state = makeState({ endDate: '2026-06-12', endTime: '15:00' })
    expect(computeDurationMinutes(state)).toBeNull()
  })

  it('spans midnight across end dates', () => {
    const state = makeState({ date: '2020-06-12', startTime: '23:00', endDate: '2020-06-13', endTime: '00:30' })
    expect(computeDurationMinutes(state)).toBe(90)
  })
})
