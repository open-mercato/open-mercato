/**
 * Step-through (spec section 8.2).
 *
 * The design constraint this file pins: step-through is an INSTANCE-level
 * PAUSED between steps using a RELEASE TOKEN, never a new step or instance
 * status. The token is what makes a replay of the execution loop safe.
 */

import {
  consumeStepThroughRelease,
  isStepThroughArmed,
  releaseStepThrough,
  shouldPauseForStepThrough,
} from '../step-through'

const armed = (releaseStepId: string | null = null) => ({
  metadata: { stepThrough: { enabled: true as const, releaseStepId } },
})

describe('isStepThroughArmed', () => {
  test('only an explicit enabled marker arms it', () => {
    expect(isStepThroughArmed(armed())).toBe(true)
    expect(isStepThroughArmed({ metadata: { stepThrough: null } })).toBe(false)
    expect(isStepThroughArmed({ metadata: {} })).toBe(false)
    expect(isStepThroughArmed({})).toBe(false)
    expect(isStepThroughArmed(null)).toBe(false)
  })
})

describe('shouldPauseForStepThrough', () => {
  test('a run that is not stepping never pauses', () => {
    expect(shouldPauseForStepThrough({ metadata: {} }, 'notify', 'AUTOMATED')).toBe(false)
  })

  test('pauses before an unreleased step', () => {
    expect(shouldPauseForStepThrough(armed(), 'notify', 'AUTOMATED')).toBe(true)
  })

  test('runs exactly the released step, and nothing else', () => {
    const instance = armed('notify')
    expect(shouldPauseForStepThrough(instance, 'notify', 'AUTOMATED')).toBe(false)
    expect(shouldPauseForStepThrough(instance, 'charge', 'AUTOMATED')).toBe(true)
  })

  test('END is exempt, so a finished step-through reads COMPLETED rather than parked', () => {
    expect(shouldPauseForStepThrough(armed(), 'end', 'END')).toBe(false)
  })

  test('a missing step id never pauses — there is nothing to release', () => {
    expect(shouldPauseForStepThrough(armed(), null, 'AUTOMATED')).toBe(false)
  })
})

describe('the release token is single-use', () => {
  test('releasing names exactly one step', () => {
    expect(releaseStepThrough('notify')).toEqual({ enabled: true, releaseStepId: 'notify' })
  })

  test('consuming it re-arms the pause, so a double Continue cannot run two steps', () => {
    const consumed = consumeStepThroughRelease()
    expect(consumed).toEqual({ enabled: true, releaseStepId: null })
    expect(shouldPauseForStepThrough({ metadata: { stepThrough: consumed } }, 'notify', 'AUTOMATED')).toBe(
      true,
    )
  })

  test('replaying the loop after a crash cannot run an unreleased step', () => {
    // The engine burns the token before running the released step, so a retry
    // of the same execution finds no release and parks again.
    const afterEntering = { metadata: { stepThrough: consumeStepThroughRelease() } }
    expect(shouldPauseForStepThrough(afterEntering, 'notify', 'AUTOMATED')).toBe(true)
  })
})
