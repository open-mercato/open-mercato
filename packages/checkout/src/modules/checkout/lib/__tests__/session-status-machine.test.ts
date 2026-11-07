import {
  assertValidCheckoutSessionTransition,
  isValidCheckoutSessionTransition,
  VALID_CHECKOUT_SESSION_TRANSITIONS,
} from '../session-status-machine'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

describe('checkout session status machine (C20/C24 skeleton)', () => {
  it('allows every documented legal transition', () => {
    for (const [from, tos] of Object.entries(VALID_CHECKOUT_SESSION_TRANSITIONS)) {
      for (const to of tos) {
        expect(isValidCheckoutSessionTransition(from as any, to as any)).toBe(true)
        expect(() => assertValidCheckoutSessionTransition(from as any, to as any)).not.toThrow()
      }
    }
  })

  it('allows a same-state transition as an idempotent no-op', () => {
    expect(isValidCheckoutSessionTransition('open', 'open')).toBe(true)
    expect(() => assertValidCheckoutSessionTransition('submitting', 'submitting')).not.toThrow()
  })

  it('refuses an illegal transition with a structured 409', () => {
    expect(isValidCheckoutSessionTransition('completed', 'open')).toBe(false)
    try {
      assertValidCheckoutSessionTransition('completed', 'open')
      throw new Error('expected assertValidCheckoutSessionTransition to throw')
    } catch (error) {
      expect(isCrudHttpError(error)).toBe(true)
      if (isCrudHttpError(error)) {
        expect(error.status).toBe(409)
        expect(error.body).toMatchObject({
          code: 'invalid_session_transition',
          currentStatus: 'completed',
          requestedStatus: 'open',
        })
      }
    }
  })

  it('refuses a transition out of every terminal state', () => {
    for (const terminal of ['completed', 'failed', 'canceled', 'expired'] as const) {
      expect(VALID_CHECKOUT_SESSION_TRANSITIONS[terminal]).toEqual([])
      expect(isValidCheckoutSessionTransition(terminal, 'open')).toBe(false)
    }
  })

  it('refuses skipping straight from open to awaiting_payment or completed', () => {
    expect(isValidCheckoutSessionTransition('open', 'awaiting_payment')).toBe(false)
    expect(isValidCheckoutSessionTransition('open', 'completed')).toBe(false)
  })
})
