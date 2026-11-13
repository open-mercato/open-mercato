import { mapTpayStatus } from '../lib/status-map'

describe('mapTpayStatus', () => {
  it.each([
    ['pending', 'pending'],
    ['paid', 'captured'],
    ['correct', 'captured'],
    ['refund', 'refunded'],
    ['canceled', 'cancelled'],
  ])('maps %s to %s', (providerStatus, unified) => {
    expect(mapTpayStatus(providerStatus)).toBe(unified)
  })

  it.each(['', 'PAID', 'chargeback', 'toString', '__proto__', 'constructor'])(
    'maps unrecognized status %p to unknown',
    (providerStatus) => {
      expect(mapTpayStatus(providerStatus)).toBe('unknown')
    },
  )

  it('maps a missing status to unknown', () => {
    expect(mapTpayStatus(undefined)).toBe('unknown')
    expect(mapTpayStatus(null)).toBe('unknown')
  })
})
