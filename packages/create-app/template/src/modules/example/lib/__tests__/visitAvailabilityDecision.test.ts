import { requiresVisitAvailabilityCheck } from '../visitAvailabilityDecision'

const storedVisit = {
  id: 'visit-1',
  interaction_type: 'visit',
  status: 'planned',
  scheduled_at: '2026-10-05T10:00:00.000Z',
  duration_minutes: 60,
  participants: [{ userId: 'staff-1' }],
  linked_entities: [],
}

describe('requiresVisitAvailabilityCheck', () => {
  it('checks a planned Visit that is moved', () => {
    expect(requiresVisitAvailabilityCheck({
      updating: true,
      input: { id: 'visit-1', scheduledAt: '2026-10-05T12:00:00.000Z' },
      existing: storedVisit,
    })).toBe('continue')
  })

  it('skips a Visit that stays canceled, even when it is moved', () => {
    expect(requiresVisitAvailabilityCheck({
      updating: true,
      input: { id: 'visit-1', scheduledAt: '2026-10-05T12:00:00.000Z' },
      existing: { ...storedVisit, status: 'canceled' },
    })).toBe('skip')
  })

  it('skips a Visit that is canceled and moved in the same write', () => {
    expect(requiresVisitAvailabilityCheck({
      updating: true,
      input: { id: 'visit-1', status: 'canceled', scheduledAt: '2026-10-05T12:00:00.000Z', participants: [{ userId: 'staff-2' }] },
      existing: storedVisit,
    })).toBe('skip')
  })

  it('checks a canceled Visit that is reactivated', () => {
    expect(requiresVisitAvailabilityCheck({
      updating: true,
      input: { id: 'visit-1', status: 'planned' },
      existing: { ...storedVisit, status: 'canceled' },
    })).toBe('continue')
  })

  it('skips a Visit created already canceled and checks one created planned', () => {
    expect(requiresVisitAvailabilityCheck({ updating: false, input: { interactionType: 'visit', status: 'canceled' }, existing: null })).toBe('skip')
    expect(requiresVisitAvailabilityCheck({ updating: false, input: { interactionType: 'visit', status: 'planned' }, existing: null })).toBe('continue')
  })
})
