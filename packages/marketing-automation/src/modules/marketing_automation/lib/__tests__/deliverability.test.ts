import {
  FAILURE_RATE_THRESHOLD,
  MINIMUM_ATTEMPTS,
  evaluateBreaker,
} from '../engine/deliverability'

describe('evaluateBreaker', () => {
  it('trips when most attempts are being refused', () => {
    const decision = evaluateBreaker({ sent: 10, failed: 30 })
    expect(decision).toEqual({ trip: true, failureRate: 0.75, attempts: 40 })
  })

  it('never trips on a small sample, however bad it looks', () => {
    /**
     * Three failures out of three is a bad afternoon, not a trend — and a guardrail that pauses working
     * campaigns gets switched off, at which point it is not a guardrail.
     */
    expect(evaluateBreaker({ sent: 0, failed: 3 })).toEqual({ trip: false, reason: 'too_few_attempts' })
    expect(evaluateBreaker({ sent: 0, failed: MINIMUM_ATTEMPTS - 1 })).toEqual({ trip: false, reason: 'too_few_attempts' })
  })

  it('trips at exactly the minimum sample once the rate is breached', () => {
    const failed = Math.ceil(MINIMUM_ATTEMPTS * FAILURE_RATE_THRESHOLD)
    const decision = evaluateBreaker({ sent: MINIMUM_ATTEMPTS - failed, failed })
    expect(decision.trip).toBe(true)
  })

  it('leaves a campaign alone while failures are within tolerance', () => {
    // Some failures are normal: a dead mailbox, a full inbox, a typo in an address.
    expect(evaluateBreaker({ sent: 95, failed: 5 })).toEqual({ trip: false, reason: 'within_tolerance' })
  })

  it('reports the rate it decided on, rounded for the message a person reads', () => {
    // The minimum and threshold are OPTIONS, not part of the window — passing them inside the window is how
    // this test first claimed a breach that could not happen.
    const decision = evaluateBreaker({ sent: 2, failed: 1 }, { minimumAttempts: 3, threshold: 0.1 })
    expect(decision.trip).toBe(true)
    if (decision.trip) expect(decision.failureRate).toBe(0.33)
  })

  it('honours an overridden threshold and minimum', () => {
    expect(evaluateBreaker({ sent: 9, failed: 1 }, { minimumAttempts: 5, threshold: 0.05 }).trip).toBe(true)
    expect(evaluateBreaker({ sent: 9, failed: 1 }, { minimumAttempts: 5, threshold: 0.5 }).trip).toBe(false)
  })

  it('does not divide by zero on a campaign that attempted nothing', () => {
    expect(evaluateBreaker({ sent: 0, failed: 0 })).toEqual({ trip: false, reason: 'too_few_attempts' })
  })
})
