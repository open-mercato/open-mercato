import { findVendorRecoveryMatches } from '../lib/vendorPolicyRecovery'

const claim = { id: 'claim-1', claimType: 'warranty', status: 'resolved', reasonCode: null, vendorName: 'Acme' }
const policy = { id: 'policy-1', vendorName: 'Acme', recoveryRatePct: '50', isActive: true }

function estimate(creditAmount: string, currencyDecimalPlaces?: number | null): string | null {
  const [match] = findVendorRecoveryMatches({
    claim,
    lines: [{ id: 'line-1', lineStatus: 'resolved', creditAmount }],
    policies: [policy],
    currencyDecimalPlaces,
  })
  return match?.estimatedRecovery ?? null
}

describe('vendor recovery estimate precision', () => {
  it('rounds to the claim currency decimals, not the approved amount precision', () => {
    expect(estimate('33.3333', 2)).toBe('16.67')
  })

  it('falls back to 2 decimals when the currency precision is unknown', () => {
    expect(estimate('33.3333')).toBe('16.67')
    expect(estimate('33.3333', null)).toBe('16.67')
  })

  it('keeps more decimals for a higher-precision currency', () => {
    expect(estimate('0.12345679', 8)).toBe('0.06172840')
  })

  it('rounds to whole units for a zero-decimal currency', () => {
    expect(estimate('1001', 0)).toBe('501')
  })
})
