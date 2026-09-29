import { MAX_PER_WEEK } from '../preferences'
import { MAX_PAUSE_DAYS } from '../engine/gates'

/**
 * The clamps, which is what the portal form leans on.
 *
 * The save path clamps rather than rejects on purpose: this is a customer-facing form, and answering somebody
 * who typed 40 with a validation error is a worse outcome than honouring the nearest sane number. The database
 * round-trip itself is covered by the integration spec.
 */
describe('preference limits', () => {
  it('caps a weekly ceiling at a number somebody could have meant', () => {
    expect(MAX_PER_WEEK).toBe(14)
  })

  it('caps a pause below the point where it is an unsubscribe with extra steps', () => {
    expect(MAX_PAUSE_DAYS).toBe(365)
  })
})
