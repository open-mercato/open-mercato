/** @jest-environment node */

import {
  VALID_CHECKOUT_TRANSITIONS,
  assertValidCheckoutStatusTransition,
  isValidCheckoutStatusTransition,
} from '../../lib/transaction-status-machine'

describe('VALID_CHECKOUT_TRANSITIONS', () => {
  it('pending can transition to processing, failed, cancelled, expired', () => {
    expect(VALID_CHECKOUT_TRANSITIONS.pending).toEqual(
      expect.arrayContaining(['processing', 'failed', 'cancelled', 'expired']),
    )
  })

  it('processing can transition to completed, failed, cancelled, expired', () => {
    expect(VALID_CHECKOUT_TRANSITIONS.processing).toEqual(
      expect.arrayContaining(['completed', 'failed', 'cancelled', 'expired']),
    )
  })

  it('terminal states have no allowed transitions', () => {
    expect(VALID_CHECKOUT_TRANSITIONS.completed).toHaveLength(0)
    expect(VALID_CHECKOUT_TRANSITIONS.failed).toHaveLength(0)
    expect(VALID_CHECKOUT_TRANSITIONS.cancelled).toHaveLength(0)
    expect(VALID_CHECKOUT_TRANSITIONS.expired).toHaveLength(0)
  })
})

describe('isValidCheckoutStatusTransition', () => {
  // --- Allowed transitions ---

  it('pending → processing is valid', () => {
    expect(isValidCheckoutStatusTransition('pending', 'processing')).toBe(true)
  })

  it('pending → failed is valid', () => {
    expect(isValidCheckoutStatusTransition('pending', 'failed')).toBe(true)
  })

  it('pending → cancelled is valid', () => {
    expect(isValidCheckoutStatusTransition('pending', 'cancelled')).toBe(true)
  })

  it('pending → expired is valid', () => {
    expect(isValidCheckoutStatusTransition('pending', 'expired')).toBe(true)
  })

  it('processing → completed is valid', () => {
    expect(isValidCheckoutStatusTransition('processing', 'completed')).toBe(true)
  })

  it('processing → failed is valid', () => {
    expect(isValidCheckoutStatusTransition('processing', 'failed')).toBe(true)
  })

  it('processing → cancelled is valid', () => {
    expect(isValidCheckoutStatusTransition('processing', 'cancelled')).toBe(true)
  })

  it('processing → expired is valid', () => {
    expect(isValidCheckoutStatusTransition('processing', 'expired')).toBe(true)
  })

  // --- Rejected regression transitions (the race condition targets) ---

  it('completed → processing is INVALID (regression guard)', () => {
    expect(isValidCheckoutStatusTransition('completed', 'processing')).toBe(false)
  })

  it('completed → failed is INVALID', () => {
    expect(isValidCheckoutStatusTransition('completed', 'failed')).toBe(false)
  })

  it('completed → pending is INVALID', () => {
    expect(isValidCheckoutStatusTransition('completed', 'pending')).toBe(false)
  })

  it('failed → processing is INVALID', () => {
    expect(isValidCheckoutStatusTransition('failed', 'processing')).toBe(false)
  })

  it('failed → completed is INVALID', () => {
    expect(isValidCheckoutStatusTransition('failed', 'completed')).toBe(false)
  })

  it('cancelled → processing is INVALID', () => {
    expect(isValidCheckoutStatusTransition('cancelled', 'processing')).toBe(false)
  })

  it('expired → processing is INVALID', () => {
    expect(isValidCheckoutStatusTransition('expired', 'processing')).toBe(false)
  })

  it('expired → completed is INVALID', () => {
    expect(isValidCheckoutStatusTransition('expired', 'completed')).toBe(false)
  })

  // --- Same-state transitions are allowed (idempotency support) ---

  it('pending → pending is valid', () => {
    expect(isValidCheckoutStatusTransition('pending', 'pending')).toBe(true)
  })

  it('processing → processing is valid', () => {
    expect(isValidCheckoutStatusTransition('processing', 'processing')).toBe(true)
  })

  it('completed → completed is valid', () => {
    expect(isValidCheckoutStatusTransition('completed', 'completed')).toBe(true)
  })
})

describe('assertValidCheckoutStatusTransition', () => {
  it('does not throw for a valid transition (pending → processing)', () => {
    expect(() => assertValidCheckoutStatusTransition('pending', 'processing')).not.toThrow()
  })

  it('does not throw for a valid transition (processing → completed)', () => {
    expect(() => assertValidCheckoutStatusTransition('processing', 'completed')).not.toThrow()
  })

  it('throws a 409 CrudHttpError for completed → processing', () => {
    expect.assertions(3)
    try {
      assertValidCheckoutStatusTransition('completed', 'processing')
    } catch (err) {
      const error = err as { status?: number; body?: Record<string, unknown> }
      expect(error.status).toBe(409)
      expect(error.body?.code).toBe('invalid_status_transition')
      expect(error.body?.currentStatus).toBe('completed')
    }
  })

  it('throws a 409 CrudHttpError for expired → completed', () => {
    expect.assertions(3)
    try {
      assertValidCheckoutStatusTransition('expired', 'completed')
    } catch (err) {
      const error = err as { status?: number; body?: Record<string, unknown> }
      expect(error.status).toBe(409)
      expect(error.body?.code).toBe('invalid_status_transition')
      expect(error.body?.requestedStatus).toBe('completed')
    }
  })

  it('does not throw for same-state transition (processing → processing)', () => {
    expect(() => assertValidCheckoutStatusTransition('processing', 'processing')).not.toThrow()
  })
})
