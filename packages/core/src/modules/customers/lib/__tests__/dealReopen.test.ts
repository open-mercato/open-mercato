import { isDealClosedForReopen } from '../dealReopen'

describe('isDealClosedForReopen', () => {
  it.each(['win', ' Won ', 'lost', 'loose', 'Closed'])('accepts terminal status %s', (status) => {
    expect(isDealClosedForReopen({ status, closureOutcome: null })).toBe(true)
  })

  it.each(['open', 'qualification', null])('excludes active status %s without an outcome', (status) => {
    expect(isDealClosedForReopen({ status, closureOutcome: null })).toBe(false)
  })

  it.each(['won', 'lost'])('recognizes a stored %s outcome even with a custom status', (closureOutcome) => {
    expect(isDealClosedForReopen({ status: 'review', closureOutcome })).toBe(true)
  })
})
