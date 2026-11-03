import { computeAutopayHash } from '../lib/hash'

describe('computeAutopayHash', () => {
  it('reproduces the documented session-initiation example', () => {
    // Docs § "Bezpieczeństwo transakcji" — ServiceID=2, OrderID=100, Amount=1.50, sharedKey=2test2
    const hash = computeAutopayHash(['2', '100', '1.50'], '2test2')
    expect(hash).toBe('2ab52e6918c6ad3b69a8228a2ab815f11ad58533eeed963dd990df8d8c3709d1')
  })

  it('reproduces the documented return-redirect example (shorter hash, no Amount)', () => {
    // Docs § "Bezpieczeństwo transakcji" — ServiceID=2, OrderID=100, sharedKey=2test2
    const hash = computeAutopayHash(['2', '100'], '2test2')
    expect(hash).toBe('254eac9980db56f425acf8a9df715cbd6f56de3c410b05f05016630f7d30a4ed')
  })

  it('reproduces the documented ITN example', () => {
    // Docs § "Powiadomienia natychmiastowe (ITN)" — serviceID=1, sharedKey=1test1
    const hash = computeAutopayHash(
      ['1', '11', '91', '11.11', 'PLN', '1', '20010101111111', 'SUCCESS', 'AUTHORIZED'],
      '1test1',
    )
    expect(hash).toBe('a103bfe581a938e9ad78238cfc674ffafdd6ec70cb6825e7ed5c41787671efe4')
  })

  it('drops empty/null/undefined fields without leaving a placeholder separator', () => {
    const withGaps = computeAutopayHash(['2', undefined, '100', null, '1.50', ''], '2test2')
    const withoutGaps = computeAutopayHash(['2', '100', '1.50'], '2test2')
    expect(withGaps).toBe(withoutGaps)
  })

  it('supports sha512 when configured per Service', () => {
    const sha256 = computeAutopayHash(['2', '100', '1.50'], '2test2', 'sha256')
    const sha512 = computeAutopayHash(['2', '100', '1.50'], '2test2', 'sha512')
    expect(sha512).not.toBe(sha256)
    expect(sha512).toHaveLength(128)
  })
})
