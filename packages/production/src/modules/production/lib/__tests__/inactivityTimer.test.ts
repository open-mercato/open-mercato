export {}

import { createInactivityTimer, DEFAULT_INACTIVITY_TIMEOUT_MINUTES } from '../inactivityTimer.js'

describe('createInactivityTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('fires onTimeout after timeoutMs of no activity', () => {
    const onTimeout = jest.fn()
    createInactivityTimer({ timeoutMs: 1000, onTimeout })
    jest.advanceTimersByTime(999)
    expect(onTimeout).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('resets the timer when registerActivity is called', () => {
    const onTimeout = jest.fn()
    const timer = createInactivityTimer({ timeoutMs: 1000, onTimeout })
    jest.advanceTimersByTime(900)
    timer.registerActivity()
    jest.advanceTimersByTime(900)
    expect(onTimeout).not.toHaveBeenCalled()
    jest.advanceTimersByTime(100)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('never fires after stop() is called', () => {
    const onTimeout = jest.fn()
    const timer = createInactivityTimer({ timeoutMs: 1000, onTimeout })
    timer.stop()
    jest.advanceTimersByTime(5000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('exposes a 15-minute default timeout constant', () => {
    expect(DEFAULT_INACTIVITY_TIMEOUT_MINUTES).toBe(15)
  })
})
