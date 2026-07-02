import { mapProviderStatusToAccessState } from '../lib/access-state'

describe('mapProviderStatusToAccessState', () => {
  it('maps active and trialing to granted', () => {
    expect(mapProviderStatusToAccessState('active')).toBe('granted')
    expect(mapProviderStatusToAccessState('trialing')).toBe('granted')
  })

  it('maps past_due to grace', () => {
    expect(mapProviderStatusToAccessState('past_due')).toBe('grace')
  })

  it('maps incomplete to pending', () => {
    expect(mapProviderStatusToAccessState('incomplete')).toBe('pending')
  })

  it('maps cancelled/unpaid/incomplete_expired to blocked', () => {
    expect(mapProviderStatusToAccessState('canceled')).toBe('blocked')
    expect(mapProviderStatusToAccessState('cancelled')).toBe('blocked')
    expect(mapProviderStatusToAccessState('unpaid')).toBe('blocked')
    expect(mapProviderStatusToAccessState('incomplete_expired')).toBe('blocked')
  })

  it('defaults to pending for unknown statuses', () => {
    expect(mapProviderStatusToAccessState('weird_status')).toBe('pending')
    expect(mapProviderStatusToAccessState(null)).toBe('pending')
    expect(mapProviderStatusToAccessState('')).toBe('pending')
  })
})
