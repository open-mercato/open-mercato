import { mapAutopayStatus, interpretAutopayTransactionStatus, type AutopayTransactionRecord } from '../lib/status-map'

function tx(overrides: Partial<AutopayTransactionRecord>): AutopayTransactionRecord {
  return {
    orderID: 'order-1',
    remoteID: 'remote-1',
    amount: '11.11',
    currency: 'PLN',
    paymentDate: '20010101111111',
    paymentStatus: 'PENDING',
    ...overrides,
  }
}

describe('mapAutopayStatus', () => {
  it('maps the three base-flow statuses', () => {
    expect(mapAutopayStatus('PENDING')).toBe('pending')
    expect(mapAutopayStatus('SUCCESS')).toBe('captured')
    expect(mapAutopayStatus('FAILURE')).toBe('failed')
  })

  it('never guesses an unrecognized status into success', () => {
    expect(mapAutopayStatus('ON_HOLD')).toBe('unknown')
    expect(mapAutopayStatus('CONFIRMED')).toBe('unknown')
    expect(mapAutopayStatus('anything-else')).toBe('unknown')
  })
})

describe('interpretAutopayTransactionStatus', () => {
  it('reports captured for exactly one SUCCESS', () => {
    const result = interpretAutopayTransactionStatus([
      tx({ paymentStatus: 'PENDING', remoteID: 'r1' }),
      tx({ paymentStatus: 'SUCCESS', remoteID: 'r2', amount: '25.00' }),
    ])
    expect(result.status).toBe('captured')
    expect(result.amountReceived).toBe(25)
    expect(result.matchedRemoteId).toBe('r2')
    expect(result.anomaly).toBeUndefined()
  })

  it('flags an overpaid anomaly for more than one SUCCESS instead of silently picking one', () => {
    const result = interpretAutopayTransactionStatus([
      tx({ paymentStatus: 'SUCCESS', remoteID: 'r1' }),
      tx({ paymentStatus: 'SUCCESS', remoteID: 'r2' }),
    ])
    expect(result.status).toBe('captured')
    expect(result.anomaly).toBe('overpaid')
  })

  it('reports pending when a PENDING exists and no SUCCESS does', () => {
    const result = interpretAutopayTransactionStatus([
      tx({ paymentStatus: 'PENDING' }),
      tx({ paymentStatus: 'FAILURE' }),
    ])
    expect(result.status).toBe('pending')
  })

  it('reports failed when only FAILURE transactions exist', () => {
    const result = interpretAutopayTransactionStatus([tx({ paymentStatus: 'FAILURE' })])
    expect(result.status).toBe('failed')
  })

  it('reports unknown when no transaction is found', () => {
    const result = interpretAutopayTransactionStatus([])
    expect(result.status).toBe('unknown')
  })
})
