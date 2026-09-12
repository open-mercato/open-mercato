import {
  countPendingChanges,
  diffTeamSelection,
  formatProjectMinutes,
  resolveAssignmentState,
  resolveGraceDays,
  selectChangeCountKey,
  toDayIndex,
  toIsoDate,
  type AssignedMember,
} from '../projectTeamAssignment'

function member(overrides: Partial<AssignedMember> = {}): AssignedMember {
  return {
    membershipId: 'membership-1',
    staffMemberId: 'staff-1',
    role: 'Team Member',
    status: 'active',
    startDate: '2026-01-05',
    endDate: null,
    ...overrides,
  }
}

describe('toIsoDate / toDayIndex', () => {
  it('normalizes timestamps and Date instances to calendar days', () => {
    expect(toIsoDate('2026-05-31T22:00:00.000Z')).toBe('2026-05-31')
    expect(toIsoDate(new Date(2026, 4, 31))).toBe('2026-05-31')
    expect(toIsoDate('')).toBeNull()
    expect(toIsoDate(null)).toBeNull()
  })

  it('compares dates by whole days', () => {
    const earlier = toDayIndex('2026-05-31')
    const later = toDayIndex('2026-06-01')
    expect(earlier).not.toBeNull()
    expect(later).toBe((earlier as number) + 1)
  })
})

describe('resolveGraceDays', () => {
  it('falls back to the D-12 default for unusable values', () => {
    expect(resolveGraceDays(null)).toBe(14)
    expect(resolveGraceDays('7')).toBe(14)
    expect(resolveGraceDays(-1)).toBe(14)
    expect(resolveGraceDays(10_000)).toBe(14)
  })

  it('keeps a valid configured value', () => {
    expect(resolveGraceDays(0)).toBe(0)
    expect(resolveGraceDays(30)).toBe(30)
  })
})

describe('resolveAssignmentState', () => {
  const now = new Date(2026, 5, 20)

  it('treats an open-ended assignment as active', () => {
    expect(resolveAssignmentState({ startDate: '2026-01-05', endDate: null }, 14, now)).toBe('active')
  })

  it('keeps access inside the grace window after the end date', () => {
    expect(resolveAssignmentState({ startDate: '2026-01-05', endDate: '2026-06-10' }, 14, now)).toBe('active')
  })

  it('expires once the end date plus grace has passed', () => {
    expect(resolveAssignmentState({ startDate: '2026-01-05', endDate: '2026-06-05' }, 14, now)).toBe('expired')
    expect(resolveAssignmentState({ startDate: '2026-01-05', endDate: '2026-06-05' }, 0, now)).toBe('expired')
  })

  it('marks a future start as scheduled', () => {
    expect(resolveAssignmentState({ startDate: '2026-07-01', endDate: null }, 14, now)).toBe('scheduled')
  })
})

describe('diffTeamSelection', () => {
  it('reports additions, removals and end-date changes', () => {
    const assigned = [
      member({ membershipId: 'm-1', staffMemberId: 'anna' }),
      member({ membershipId: 'm-2', staffMemberId: 'paulina', endDate: '2026-09-30' }),
    ]
    const changes = diffTeamSelection(assigned, {
      selectedStaffMemberIds: new Set(['anna', 'tomasz']),
      endDateByStaffMemberId: new Map([
        ['anna', '2026-12-31'],
        ['paulina', '2026-09-30'],
      ]),
    })

    expect(changes.additions).toEqual(['tomasz'])
    expect(changes.removals.map((entry) => entry.membershipId)).toEqual(['m-2'])
    expect(changes.endDateUpdates).toEqual([{ member: assigned[0], endDate: '2026-12-31' }])
    expect(countPendingChanges(changes)).toBe(3)
  })

  it('ignores the locked Team Leader row in both directions', () => {
    const assigned = [member({ membershipId: 'm-tl', staffMemberId: 'marek' })]
    const changes = diffTeamSelection(
      assigned,
      { selectedStaffMemberIds: new Set<string>(), endDateByStaffMemberId: new Map() },
      new Set(['marek']),
    )
    expect(changes.additions).toEqual([])
    expect(changes.removals).toEqual([])
    expect(countPendingChanges(changes)).toBe(0)
  })

  it('does not treat an unchanged end date as a change', () => {
    const assigned = [member({ staffMemberId: 'anna', endDate: '2026-09-30' })]
    const changes = diffTeamSelection(assigned, {
      selectedStaffMemberIds: new Set(['anna']),
      endDateByStaffMemberId: new Map([['anna', '2026-09-30']]),
    })
    expect(countPendingChanges(changes)).toBe(0)
  })

  it('clearing an end date is an update, not a removal', () => {
    const assigned = [member({ staffMemberId: 'anna', endDate: '2026-09-30' })]
    const changes = diffTeamSelection(assigned, {
      selectedStaffMemberIds: new Set(['anna']),
      endDateByStaffMemberId: new Map([['anna', null]]),
    })
    expect(changes.removals).toEqual([])
    expect(changes.endDateUpdates).toEqual([{ member: assigned[0], endDate: null }])
  })
})

describe('selectChangeCountKey', () => {
  it('buckets counts into Polish plural forms', () => {
    expect(selectChangeCountKey(1)).toBe('one')
    expect(selectChangeCountKey(2)).toBe('few')
    expect(selectChangeCountKey(4)).toBe('few')
    expect(selectChangeCountKey(5)).toBe('many')
    expect(selectChangeCountKey(12)).toBe('many')
    expect(selectChangeCountKey(22)).toBe('few')
    expect(selectChangeCountKey(0)).toBe('many')
  })
})

describe('formatProjectMinutes', () => {
  it('renders the mockup clock format', () => {
    expect(formatProjectMinutes(4700)).toBe('78:20')
    expect(formatProjectMinutes(0)).toBe('0:00')
  })
})
