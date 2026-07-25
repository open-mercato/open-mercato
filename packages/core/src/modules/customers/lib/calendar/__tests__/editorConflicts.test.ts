import { findEditorConflictItems } from '../conflicts'
import { createDefaultFormState, KIND_CONFIG, resolveSavedOwnerUserId } from '../editorPayload'
import { expandOccurrences } from '../recurrence'
import { makeCalendarItem, makePayload } from './fixtures'

function at(hour: number, minute = 0): Date {
  return new Date(2026, 5, 1, hour, minute, 0, 0)
}

function atDay(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 5, day, hour, minute, 0, 0)
}

function dailySeries(): ReturnType<typeof makeCalendarItem> {
  return makeCalendarItem({
    id: 'rec',
    start: atDay(1, 9),
    end: atDay(1, 9, 30),
    ownerUserId: 'owner-1',
    raw: makePayload({
      id: 'rec',
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
      scheduledAt: atDay(1, 9).toISOString(),
      durationMinutes: 30,
      ownerUserId: 'owner-1',
    }),
  })
}

describe('findEditorConflictItems', () => {
  it('flags an overlapping item that shares the owner', () => {
    const others = [makeCalendarItem({ id: 'a', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-1' })]
    const result = findEditorConflictItems(
      { start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [] },
      others,
      null,
    )
    expect(result.map((item) => item.id)).toEqual(['a'])
  })

  it('flags an overlapping item that shares a participant even when owners differ', () => {
    const others = [
      makeCalendarItem({
        id: 'b',
        start: at(9, 30),
        end: at(10, 30),
        ownerUserId: 'owner-2',
        participants: [{ userId: 'p-1', name: 'Pat' }],
      }),
    ]
    const result = findEditorConflictItems(
      { start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [{ userId: 'p-1' }] },
      others,
      null,
    )
    expect(result.map((item) => item.id)).toEqual(['b'])
  })

  it('does not flag an overlapping item with no shared owner or participant', () => {
    const others = [
      makeCalendarItem({ id: 'c', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-2', participants: [{ userId: 'p-9' }] }),
    ]
    expect(
      findEditorConflictItems(
        { start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [{ userId: 'p-1' }] },
        others,
        null,
      ),
    ).toEqual([])
  })

  it('does not flag a non-overlapping item even with a shared owner', () => {
    const others = [makeCalendarItem({ id: 'd', start: at(11), end: at(12), ownerUserId: 'owner-1' })]
    expect(
      findEditorConflictItems({ start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [] }, others, null),
    ).toEqual([])
  })

  it('excludes the edited record by id', () => {
    const others = [makeCalendarItem({ id: 'self', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-1' })]
    expect(
      findEditorConflictItems({ start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [] }, others, 'self'),
    ).toEqual([])
  })

  it('ignores canceled items', () => {
    const others = [
      makeCalendarItem({ id: 'cx', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-1', status: 'canceled' }),
    ]
    expect(
      findEditorConflictItems({ start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [] }, others, null),
    ).toEqual([])
  })

  it('does not warn when the edited draft itself is canceled (matches the grid excluding canceled)', () => {
    const others = [makeCalendarItem({ id: 'a', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-1' })]
    // Same overlap as the owner-match case, but the draft is canceled → no warning.
    expect(
      findEditorConflictItems(
        { start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [], status: 'canceled' },
        others,
        null,
      ),
    ).toEqual([])
  })

  it('still warns when the edited draft is done (only canceled is excluded, mirroring the grid)', () => {
    const others = [makeCalendarItem({ id: 'a', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-1' })]
    const result = findEditorConflictItems(
      { start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [], status: 'done' },
      others,
      null,
    )
    expect(result.map((item) => item.id)).toEqual(['a'])
  })

  it('detects a conflict against a recurring series occurrence (not just the series start)', () => {
    const occurrences = expandOccurrences(dailySeries(), { from: atDay(1, 0), to: atDay(3, 23, 59) })
    // A separate event overlapping the day-2 occurrence, sharing the owner.
    const result = findEditorConflictItems(
      { start: atDay(2, 9), end: atDay(2, 9, 30), ownerUserId: 'owner-1', participants: [] },
      occurrences,
      'other',
    )
    expect(result).toHaveLength(1)
    expect(result[0].start.getDate()).toBe(2)
  })

  it('does not flag an edited recurring series against its own occurrences (raw.id exclusion)', () => {
    const occurrences = expandOccurrences(dailySeries(), { from: atDay(1, 0), to: atDay(3, 23, 59) })
    // Editing the series itself → excludeId is the series raw id; every occurrence is dropped.
    const result = findEditorConflictItems(
      { start: atDay(1, 9), end: atDay(1, 9, 30), ownerUserId: 'owner-1', participants: [] },
      occurrences,
      'rec',
    )
    expect(result).toEqual([])
  })

  it('scope "mine" suppresses the warning when the current user is not in the draft', () => {
    // Draft owned by a colleague, overlapping that colleague's other meeting.
    const others = [makeCalendarItem({ id: 'a', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-1' })]
    const result = findEditorConflictItems(
      { start: at(9), end: at(10), ownerUserId: 'owner-1', participants: [] },
      others,
      null,
      { scope: 'mine', currentUserId: 'user-me' },
    )
    expect(result).toEqual([])
  })

  it('scope "mine" warns when the current user is an actor of both the draft and the candidate', () => {
    const others = [makeCalendarItem({ id: 'a', start: at(9, 30), end: at(10, 30), ownerUserId: 'user-me' })]
    const result = findEditorConflictItems(
      { start: at(9), end: at(10), ownerUserId: 'user-me', participants: [] },
      others,
      null,
      { scope: 'mine', currentUserId: 'user-me' },
    )
    expect(result.map((item) => item.id)).toEqual(['a'])
  })
})

describe('resolveSavedOwnerUserId', () => {
  it('uses the assignee as the owner for tasks (people === assignee)', () => {
    const form = { ...createDefaultFormState(), kind: 'task' as const, assigneeUserId: 'user-7' }
    // Edit flag is irrelevant for tasks — the assignee is always the saved owner.
    expect(resolveSavedOwnerUserId(KIND_CONFIG.task, form, false, null)).toBe('user-7')
    expect(resolveSavedOwnerUserId(KIND_CONFIG.task, form, true, 'stale-owner')).toBe('user-7')
  })

  it('returns null for a task with no assignee', () => {
    const form = { ...createDefaultFormState(), kind: 'task' as const, assigneeUserId: null }
    expect(resolveSavedOwnerUserId(KIND_CONFIG.task, form, false, null)).toBeNull()
  })

  it('saves a new non-task ownerless (matches buildInteractionPayload omitting ownerUserId on create)', () => {
    const form = createDefaultFormState()
    expect(resolveSavedOwnerUserId(KIND_CONFIG.meeting, form, false, null)).toBeNull()
  })

  it('preserves the existing owner when editing a non-task', () => {
    const form = createDefaultFormState()
    expect(resolveSavedOwnerUserId(KIND_CONFIG.meeting, form, true, 'existing-owner')).toBe('existing-owner')
  })
})
