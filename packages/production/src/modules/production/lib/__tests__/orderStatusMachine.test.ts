export {}

import {
  ALLOWED_TRANSITIONS,
  CANCELLABLE_FROM,
  IllegalOrderTransitionError,
  assertOrderTransition,
  canCancelFromStatus,
  canTransitionOrderStatus,
  type ProductionOrderStatus,
} from '../orderStatusMachine'

const ALL_STATUSES: ProductionOrderStatus[] = [
  'draft',
  'planned',
  'released',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
]

describe('production order status machine', () => {
  describe('happy-path chain', () => {
    it('allows the full draft -> planned -> released -> in_progress -> completed -> closed chain', () => {
      expect(canTransitionOrderStatus('draft', 'planned')).toBe(true)
      expect(canTransitionOrderStatus('planned', 'released')).toBe(true)
      expect(canTransitionOrderStatus('released', 'in_progress')).toBe(true)
      expect(canTransitionOrderStatus('in_progress', 'completed')).toBe(true)
      expect(canTransitionOrderStatus('completed', 'closed')).toBe(true)
    })

    it('allows cancel from draft, planned, and released', () => {
      expect(canTransitionOrderStatus('draft', 'cancelled')).toBe(true)
      expect(canTransitionOrderStatus('planned', 'cancelled')).toBe(true)
      expect(canTransitionOrderStatus('released', 'cancelled')).toBe(true)
      expect(CANCELLABLE_FROM).toEqual(['draft', 'planned', 'released'])
      expect(canCancelFromStatus('draft')).toBe(true)
      expect(canCancelFromStatus('planned')).toBe(true)
      expect(canCancelFromStatus('released')).toBe(true)
      expect(canCancelFromStatus('in_progress')).toBe(false)
      expect(canCancelFromStatus('completed')).toBe(false)
      expect(canCancelFromStatus('closed')).toBe(false)
      expect(canCancelFromStatus('cancelled')).toBe(false)
    })
  })

  describe('exhaustive illegal-transition matrix', () => {
    // Build the full from x to matrix and assert every non-allowed pair is
    // rejected — the DoD's "in tym nielegalne przejscia" is not satisfied by
    // a handful of spot checks.
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const allowed = ALLOWED_TRANSITIONS[from].includes(to)
        if (allowed) continue
        it(`rejects ${from} -> ${to}`, () => {
          expect(canTransitionOrderStatus(from, to)).toBe(false)
          expect(() => assertOrderTransition(from, to)).toThrow(IllegalOrderTransitionError)
        })
      }
    }
  })

  describe('terminal statuses', () => {
    it('closed has no outbound transitions', () => {
      expect(ALLOWED_TRANSITIONS.closed).toEqual([])
    })

    it('cancelled has no outbound transitions', () => {
      expect(ALLOWED_TRANSITIONS.cancelled).toEqual([])
    })
  })

  describe('assertOrderTransition', () => {
    it('does not throw for an allowed transition', () => {
      expect(() => assertOrderTransition('draft', 'planned')).not.toThrow()
    })

    it('throws IllegalOrderTransitionError carrying from/to for an illegal transition', () => {
      try {
        assertOrderTransition('completed', 'in_progress')
        throw new Error('expected assertOrderTransition to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(IllegalOrderTransitionError)
        const typed = err as IllegalOrderTransitionError
        expect(typed.from).toBe('completed')
        expect(typed.to).toBe('in_progress')
      }
    })

    it('rejects skipping straight from draft to released', () => {
      expect(() => assertOrderTransition('draft', 'released')).toThrow(IllegalOrderTransitionError)
    })

    it('rejects re-entering an earlier status (in_progress -> planned)', () => {
      expect(() => assertOrderTransition('in_progress', 'planned')).toThrow(IllegalOrderTransitionError)
    })
  })
})
