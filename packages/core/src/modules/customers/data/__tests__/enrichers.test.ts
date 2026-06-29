import { buildPipelineState } from '../enrichers'

const DAY_MS = 24 * 60 * 60 * 1000

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

function todayFloor(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

describe('buildPipelineState', () => {
  const NOW = new Date('2026-05-13T12:00:00Z')
  const TODAY = todayFloor(NOW)

  describe('openActivitiesCount', () => {
    it('returns 0 when deal has no interactions', () => {
      const state = buildPipelineState(
        { id: 'deal-1' },
        new Map(),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.openActivitiesCount).toBe(0)
    })

    it('returns the count from the open-interaction map', () => {
      const state = buildPipelineState(
        { id: 'deal-1' },
        new Map([['deal-1', 7]]),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.openActivitiesCount).toBe(7)
    })
  })

  describe('daysInCurrentStage', () => {
    it('uses the latest transition timestamp when present', () => {
      const transitionedAt = new Date(NOW.getTime() - 10 * DAY_MS)
      const state = buildPipelineState(
        { id: 'deal-1', created_at: isoDaysAgo(NOW, 60) },
        new Map(),
        new Map([['deal-1', transitionedAt]]),
        14,
        NOW,
        TODAY,
      )
      expect(state.daysInCurrentStage).toBe(10)
    })

    it('falls back to created_at when no transitions exist', () => {
      const state = buildPipelineState(
        { id: 'deal-1', created_at: isoDaysAgo(NOW, 5) },
        new Map(),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.daysInCurrentStage).toBe(5)
    })

    it('returns 0 when neither transition nor created_at is available', () => {
      const state = buildPipelineState(
        { id: 'deal-1' },
        new Map(),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.daysInCurrentStage).toBe(0)
    })

    it('clamps negative diffs to 0 (future-dated transition)', () => {
      const futureTransition = new Date(NOW.getTime() + 5 * DAY_MS)
      const state = buildPipelineState(
        { id: 'deal-1' },
        new Map(),
        new Map([['deal-1', futureTransition]]),
        14,
        NOW,
        TODAY,
      )
      expect(state.daysInCurrentStage).toBe(0)
    })
  })

  describe('isOverdue', () => {
    it('is true when status=open and expected_close_at is before today', () => {
      const state = buildPipelineState(
        {
          id: 'deal-1',
          status: 'open',
          expected_close_at: isoDaysAgo(NOW, 1),
        },
        new Map(),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.isOverdue).toBe(true)
    })

    it('is false when status is not open (won)', () => {
      const state = buildPipelineState(
        {
          id: 'deal-1',
          status: 'won',
          expected_close_at: isoDaysAgo(NOW, 30),
        },
        new Map(),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.isOverdue).toBe(false)
    })

    it('is false when no expected_close_at is set', () => {
      const state = buildPipelineState(
        { id: 'deal-1', status: 'open' },
        new Map(),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.isOverdue).toBe(false)
    })

    it('is false when expected_close_at is in the future', () => {
      const future = new Date(NOW.getTime() + 30 * DAY_MS).toISOString()
      const state = buildPipelineState(
        { id: 'deal-1', status: 'open', expected_close_at: future },
        new Map(),
        new Map(),
        14,
        NOW,
        TODAY,
      )
      expect(state.isOverdue).toBe(false)
    })
  })

  describe('isStuck', () => {
    it('is true when daysInCurrentStage exceeds the threshold', () => {
      const transitionedAt = new Date(NOW.getTime() - 30 * DAY_MS)
      const state = buildPipelineState(
        { id: 'deal-1' },
        new Map(),
        new Map([['deal-1', transitionedAt]]),
        14,
        NOW,
        TODAY,
      )
      expect(state.isStuck).toBe(true)
    })

    it('is false at the threshold boundary (inclusive)', () => {
      const transitionedAt = new Date(NOW.getTime() - 14 * DAY_MS)
      const state = buildPipelineState(
        { id: 'deal-1' },
        new Map(),
        new Map([['deal-1', transitionedAt]]),
        14,
        NOW,
        TODAY,
      )
      expect(state.isStuck).toBe(false)
    })

    it('is false when daysInCurrentStage is below the threshold', () => {
      const transitionedAt = new Date(NOW.getTime() - 7 * DAY_MS)
      const state = buildPipelineState(
        { id: 'deal-1' },
        new Map(),
        new Map([['deal-1', transitionedAt]]),
        14,
        NOW,
        TODAY,
      )
      expect(state.isStuck).toBe(false)
    })
  })

  describe('integrated state', () => {
    it('combines stuck + overdue + activity count for a single deal', () => {
      const transitionedAt = new Date(NOW.getTime() - 21 * DAY_MS)
      const state = buildPipelineState(
        {
          id: 'deal-1',
          status: 'open',
          expected_close_at: isoDaysAgo(NOW, 3),
        },
        new Map([['deal-1', 4]]),
        new Map([['deal-1', transitionedAt]]),
        14,
        NOW,
        TODAY,
      )
      expect(state).toEqual({
        openActivitiesCount: 4,
        daysInCurrentStage: 21,
        isStuck: true,
        isOverdue: true,
      })
    })
  })
})
