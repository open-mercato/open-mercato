import { resolveTimerActionError } from '../timerErrors'

// Regression for issue #3507 (BUG-001): a rejected timer start/stop must
// surface the localized message the server already returned (e.g. the 409
// "another timer is already running" reason) instead of always falling back to
// a generic, English-only string.
describe('resolveTimerActionError', () => {
  const FALLBACK = 'Nie udało się uruchomić licznika czasu'

  it('returns the server message when the error carries an HTTP status', () => {
    // Shape produced by raiseCrudError: an Error whose message is the parsed,
    // already-localized server message plus a numeric `status`.
    const serverMessage = 'Inny licznik czasu jest już uruchomiony.'
    const err = Object.assign(new Error(serverMessage), { status: 409 })
    expect(resolveTimerActionError(err, FALLBACK)).toBe(serverMessage)
  })

  it('reads the server message from a structured error body with status', () => {
    const err = { status: 409, error: 'Inny licznik czasu jest już uruchomiony.' }
    expect(resolveTimerActionError(err, FALLBACK)).toBe('Inny licznik czasu jest już uruchomiony.')
  })

  it('falls back when the server response carried no usable message', () => {
    const err = Object.assign(new Error('   '), { status: 400 })
    expect(resolveTimerActionError(err, FALLBACK)).toBe(FALLBACK)
  })

  it('falls back for transport errors that never reached the server (no status)', () => {
    const err = new Error('Failed to fetch')
    expect(resolveTimerActionError(err, FALLBACK)).toBe(FALLBACK)
  })

  it('falls back for non-error rejections', () => {
    expect(resolveTimerActionError(undefined, FALLBACK)).toBe(FALLBACK)
    expect(resolveTimerActionError('boom', FALLBACK)).toBe(FALLBACK)
  })
})
