import {
  DEFAULT_INACTIVITY_WINDOW_HOURS,
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  resolveCartInactivityWindowMs,
  resolveCartLockTimeoutMs,
} from '../sweepConfig'

beforeEach(() => {
  delete process.env.CART_INACTIVITY_WINDOW_HOURS
  delete process.env.CART_LOCK_TIMEOUT_MINUTES
})

describe('resolveCartInactivityWindowMs', () => {
  it('defaults to 24 hours when unset', () => {
    expect(resolveCartInactivityWindowMs()).toBe(DEFAULT_INACTIVITY_WINDOW_HOURS * 60 * 60 * 1000)
  })

  it('honors a valid CART_INACTIVITY_WINDOW_HOURS override', () => {
    process.env.CART_INACTIVITY_WINDOW_HOURS = '6'
    expect(resolveCartInactivityWindowMs()).toBe(6 * 60 * 60 * 1000)
  })

  it.each(['0', '-3', 'not-a-number'])('falls back to the default for CART_INACTIVITY_WINDOW_HOURS=%s', (value) => {
    process.env.CART_INACTIVITY_WINDOW_HOURS = value
    expect(resolveCartInactivityWindowMs()).toBe(DEFAULT_INACTIVITY_WINDOW_HOURS * 60 * 60 * 1000)
  })
})

describe('resolveCartLockTimeoutMs', () => {
  it('defaults to 30 minutes when unset', () => {
    expect(resolveCartLockTimeoutMs()).toBe(DEFAULT_LOCK_TIMEOUT_MINUTES * 60 * 1000)
  })

  it('honors a valid CART_LOCK_TIMEOUT_MINUTES override', () => {
    process.env.CART_LOCK_TIMEOUT_MINUTES = '15'
    expect(resolveCartLockTimeoutMs()).toBe(15 * 60 * 1000)
  })

  it.each(['0', '-1', 'garbage'])('falls back to the default for CART_LOCK_TIMEOUT_MINUTES=%s', (value) => {
    process.env.CART_LOCK_TIMEOUT_MINUTES = value
    expect(resolveCartLockTimeoutMs()).toBe(DEFAULT_LOCK_TIMEOUT_MINUTES * 60 * 1000)
  })
})
