import { findConflicts } from '../conflicts'
import { makeCalendarItem } from './fixtures'

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 5, 11, hours, minutes, 0)
}

describe('findConflicts', () => {
  it('flags overlapping items sharing an owner in both directions', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'first', start: at(10), end: at(11), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'second', start: at(10, 30), end: at(11, 30), ownerUserId: 'owner-a' }),
    ])
    expect(conflicts.get('first')).toEqual(['second'])
    expect(conflicts.get('second')).toEqual(['first'])
  })

  it('flags overlapping items sharing a participant', () => {
    const conflicts = findConflicts([
      makeCalendarItem({
        id: 'first',
        start: at(9),
        end: at(10),
        participants: [{ userId: 'user-1' }, { userId: 'user-2' }],
      }),
      makeCalendarItem({
        id: 'second',
        start: at(9, 15),
        end: at(9, 45),
        participants: [{ userId: 'user-2' }],
      }),
    ])
    expect(conflicts.get('first')).toEqual(['second'])
    expect(conflicts.get('second')).toEqual(['first'])
  })

  it('ignores overlapping items without a shared actor', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'first', start: at(10), end: at(11), ownerUserId: 'owner-a', participants: [{ userId: 'user-1' }] }),
      makeCalendarItem({ id: 'second', start: at(10), end: at(11), ownerUserId: 'owner-b', participants: [{ userId: 'user-2' }] }),
    ])
    expect(conflicts.size).toBe(0)
  })

  it('does not treat two items with null owners as sharing an owner', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'first', start: at(10), end: at(11), ownerUserId: null }),
      makeCalendarItem({ id: 'second', start: at(10), end: at(11), ownerUserId: null }),
    ])
    expect(conflicts.size).toBe(0)
  })

  it('excludes canceled items from conflict detection', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'first', start: at(10), end: at(11), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'second', start: at(10, 30), end: at(11, 30), ownerUserId: 'owner-a', status: 'canceled' }),
    ])
    expect(conflicts.size).toBe(0)
  })

  it('treats touching intervals as non-overlapping', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'first', start: at(10), end: at(11), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'second', start: at(11), end: at(12), ownerUserId: 'owner-a' }),
    ])
    expect(conflicts.size).toBe(0)
  })

  it('collects every overlapping counterpart in a three-way overlap', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'first', start: at(9), end: at(11), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'second', start: at(10), end: at(12), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'third', start: at(10, 30), end: at(13), ownerUserId: 'owner-a' }),
    ])
    expect(conflicts.get('first')?.sort()).toEqual(['second', 'third'])
    expect(conflicts.get('second')?.sort()).toEqual(['first', 'third'])
    expect(conflicts.get('third')?.sort()).toEqual(['first', 'second'])
  })

  it('only pairs items whose intervals actually overlap in a sorted sweep', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'morning', start: at(9), end: at(10), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'noon', start: at(12), end: at(13), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'noon-overlap', start: at(12, 30), end: at(13, 30), ownerUserId: 'owner-a' }),
    ])
    expect(conflicts.get('morning')).toBeUndefined()
    expect(conflicts.get('noon')).toEqual(['noon-overlap'])
    expect(conflicts.get('noon-overlap')).toEqual(['noon'])
  })

  it('mixes owner-based and participant-based sharing across the same window', () => {
    const conflicts = findConflicts([
      makeCalendarItem({ id: 'owner-pair-a', start: at(9), end: at(10), ownerUserId: 'owner-a' }),
      makeCalendarItem({ id: 'owner-pair-b', start: at(9, 30), end: at(10, 30), ownerUserId: 'owner-a' }),
      makeCalendarItem({
        id: 'participant-pair',
        start: at(9, 45),
        end: at(10, 15),
        ownerUserId: 'owner-b',
        participants: [{ userId: 'user-9' }],
      }),
    ])
    expect(conflicts.get('owner-pair-a')).toEqual(['owner-pair-b'])
    expect(conflicts.get('owner-pair-b')).toEqual(['owner-pair-a'])
    expect(conflicts.get('participant-pair')).toBeUndefined()
  })
})

describe('findConflicts scope', () => {
  const me = 'user-me'

  it('"mine" flags an overlap where the current user owns both events', () => {
    const conflicts = findConflicts(
      [
        makeCalendarItem({ id: 'a', start: at(10), end: at(11), ownerUserId: me }),
        makeCalendarItem({ id: 'b', start: at(10, 30), end: at(11, 30), ownerUserId: me }),
      ],
      { scope: 'mine', currentUserId: me },
    )
    expect(conflicts.get('a')).toEqual(['b'])
    expect(conflicts.get('b')).toEqual(['a'])
  })

  it('"mine" flags an overlap where the current user participates in both events', () => {
    const conflicts = findConflicts(
      [
        makeCalendarItem({ id: 'a', start: at(10), end: at(11), ownerUserId: 'owner-x', participants: [{ userId: me }, { userId: 'p1' }] }),
        makeCalendarItem({ id: 'b', start: at(10, 30), end: at(11, 30), ownerUserId: 'owner-y', participants: [{ userId: me }] }),
      ],
      { scope: 'mine', currentUserId: me },
    )
    expect(conflicts.get('a')).toEqual(['b'])
  })

  it('"mine" hides a clash between colleagues the current user is not part of', () => {
    const conflicts = findConflicts(
      [
        makeCalendarItem({ id: 'a', start: at(10), end: at(11), ownerUserId: 'owner-x' }),
        makeCalendarItem({ id: 'b', start: at(10, 30), end: at(11, 30), ownerUserId: 'owner-x' }),
      ],
      { scope: 'mine', currentUserId: me },
    )
    expect(conflicts.size).toBe(0)
  })

  it('"mine" hides an overlap where the current user is in only one of the two events', () => {
    const conflicts = findConflicts(
      [
        makeCalendarItem({ id: 'a', start: at(10), end: at(11), ownerUserId: 'owner-x', participants: [{ userId: me }, { userId: 'shared' }] }),
        makeCalendarItem({ id: 'b', start: at(10, 30), end: at(11, 30), ownerUserId: 'owner-y', participants: [{ userId: 'shared' }] }),
      ],
      { scope: 'mine', currentUserId: me },
    )
    expect(conflicts.size).toBe(0)
  })

  it('"all" flags an actor-sharing overlap even when the current user is in neither', () => {
    const conflicts = findConflicts(
      [
        makeCalendarItem({ id: 'a', start: at(10), end: at(11), ownerUserId: 'owner-x' }),
        makeCalendarItem({ id: 'b', start: at(10, 30), end: at(11, 30), ownerUserId: 'owner-x' }),
      ],
      { scope: 'all', currentUserId: me },
    )
    expect(conflicts.get('a')).toEqual(['b'])
  })

  it('"mine" with no current user degrades to org-wide detection', () => {
    const conflicts = findConflicts(
      [
        makeCalendarItem({ id: 'a', start: at(10), end: at(11), ownerUserId: 'owner-x' }),
        makeCalendarItem({ id: 'b', start: at(10, 30), end: at(11, 30), ownerUserId: 'owner-x' }),
      ],
      { scope: 'mine', currentUserId: null },
    )
    expect(conflicts.get('a')).toEqual(['b'])
  })
})
