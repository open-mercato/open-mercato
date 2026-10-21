/** @jest-environment node */
/**
 * Pins the bank CSV parser.
 *
 * A bank export is the one input an accountant cannot retype, so the parser's
 * failure mode must be a visible row error, not a silently shifted column or a
 * positive amount read as negative.
 */
import { parseBankStatementCsv } from '../bankReconciliation'

describe('bank statement CSV', () => {
  it('skips a header and reads signed amounts as direction', () => {
    const parsed = parseBankStatementCsv([
      'date,description,reference,amount',
      '2026-10-01,Transfer in,TRX-1,1000.00',
      '2026-10-02,Cheque out,CHQ-1,-250.50',
    ].join('\n'))
    expect(parsed.errors).toEqual([])
    expect(parsed.lines).toHaveLength(2)
    expect(parsed.lines[0]).toMatchObject({ transactionDate: '2026-10-01', direction: 'in', amount: '1000.00', reference: 'TRX-1' })
    expect(parsed.lines[1]).toMatchObject({ transactionDate: '2026-10-02', direction: 'out', amount: '250.50', reference: 'CHQ-1' })
  })

  it('handles a quoted description containing a comma', () => {
    const parsed = parseBankStatementCsv('2026-10-03,"Transfer, international",REF,10.00')
    expect(parsed.errors).toEqual([])
    expect(parsed.lines[0].description).toBe('Transfer, international')
  })

  it('reports invalid dates and amounts instead of dropping them silently', () => {
    const parsed = parseBankStatementCsv([
      '2026-10-01,Good,REF,10.00',
      'not-a-date,Bad,REF,10.00',
      '2026-10-02,Bad amount,REF,',
    ].join('\n'))
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.errors).toEqual([
      { lineNumber: 2, message: 'invalid_date' },
      { lineNumber: 3, message: 'invalid_amount' },
    ])
  })

  it('parses a headerless file', () => {
    const parsed = parseBankStatementCsv('2026-10-01,Transfer,REF,100')
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0].amount).toBe('100.00')
  })
})
