import {
  assertEntryEditable,
  assertEntryPostable,
  assertJournalEntryRules,
  assertPeriodReopenable,
  buildReversalLines,
  buildTrialBalance,
  evaluatePeriodPosting,
  fromMinorUnits,
  isTrialBalanceBalanced,
  sumJournalLines,
  toMinorUnits,
  type JournalLineDraft,
} from '../glService'
import { FinancialRuleError } from '../errors'

const balanced: JournalLineDraft[] = [
  { accountId: 'a1', debitAmount: '100.00', creditAmount: '0' },
  { accountId: 'a2', debitAmount: '0', creditAmount: '100.00' },
]

describe('minor-unit money handling', () => {
  it('round-trips whole and fractional amounts at the 4-decimal scale', () => {
    expect(toMinorUnits('0')).toBe(0n)
    expect(toMinorUnits('1')).toBe(10_000n)
    expect(toMinorUnits('100.25')).toBe(1_002_500n)
    expect(fromMinorUnits(1_002_500n)).toBe('100.2500')
    expect(fromMinorUnits(-1_002_500n)).toBe('-100.2500')
  })

  it('keeps the decimal the caller wrote instead of its binary approximation', () => {
    expect(fromMinorUnits(toMinorUnits('1.005'))).toBe('1.0050')
    expect(toMinorUnits(1.005)).toBe(10_050n)
  })

  it('rejects a malformed or exponential amount', () => {
    expect(() => toMinorUnits('1,15')).toThrow(FinancialRuleError)
    expect(() => toMinorUnits('')).toThrow(FinancialRuleError)
    expect(() => toMinorUnits('1e3')).toThrow(FinancialRuleError)
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(FinancialRuleError)
  })
})

describe('entry invariants', () => {
  it('accepts a balanced two-line entry', () => {
    expect(() => assertJournalEntryRules(balanced)).not.toThrow()
    expect(sumJournalLines(balanced)).toEqual({ debit: 1_000_000n, credit: 1_000_000n })
  })

  it('refuses fewer than two lines', () => {
    expect(() => assertJournalEntryRules([balanced[0]])).toThrow(
      expect.objectContaining({ code: 'entry_requires_two_lines' }),
    )
  })

  it('refuses a line that carries both a debit and a credit, or neither', () => {
    expect(() =>
      assertJournalEntryRules([
        { accountId: 'a1', debitAmount: '10', creditAmount: '10' },
        { accountId: 'a2', debitAmount: '0', creditAmount: '0' },
      ]),
    ).toThrow(expect.objectContaining({ code: 'entry_line_single_sided' }))
  })

  it('refuses a negative amount', () => {
    expect(() =>
      assertJournalEntryRules([
        { accountId: 'a1', debitAmount: '-10', creditAmount: '0' },
        { accountId: 'a2', debitAmount: '0', creditAmount: '10' },
      ]),
    ).toThrow(expect.objectContaining({ code: 'negative_amount' }))
  })

  it('refuses an entry off balance by a single minor unit', () => {
    expect(() =>
      assertJournalEntryRules([
        { accountId: 'a1', debitAmount: '100.0001', creditAmount: '0' },
        { accountId: 'a2', debitAmount: '0', creditAmount: '100.0000' },
      ]),
    ).toThrow(expect.objectContaining({ code: 'entry_unbalanced' }))
  })
})

describe('immutability and period gating', () => {
  it('allows editing and posting only a draft', () => {
    expect(() => assertEntryEditable('draft')).not.toThrow()
    expect(() => assertEntryPostable('draft')).not.toThrow()
    expect(() => assertEntryEditable('posted')).toThrow(expect.objectContaining({ code: 'entry_immutable' }))
    expect(() => assertEntryPostable('posted')).toThrow(expect.objectContaining({ code: 'entry_not_draft' }))
  })

  it('posts into an open period, gates a soft-closed one, never a hard-closed one', () => {
    expect(evaluatePeriodPosting('open', false)).toEqual({ allowed: true })
    expect(evaluatePeriodPosting('soft_closed', false)).toEqual({ allowed: false, code: 'period_closed' })
    expect(evaluatePeriodPosting('soft_closed', true)).toEqual({ allowed: true })
    expect(evaluatePeriodPosting('hard_closed', true)).toEqual({ allowed: false, code: 'period_hard_closed' })
  })

  it('reopens only a soft-closed period', () => {
    expect(() => assertPeriodReopenable('soft_closed')).not.toThrow()
    expect(() => assertPeriodReopenable('hard_closed')).toThrow(
      expect.objectContaining({ code: 'period_not_reopenable' }),
    )
  })
})

describe('reversal and trial balance', () => {
  it('mirrors an entry by swapping debits and credits', () => {
    expect(buildReversalLines(balanced)).toEqual([
      { accountId: 'a1', debitAmount: '0', creditAmount: '100.00', description: null, taxCode: null },
      { accountId: 'a2', debitAmount: '100.00', creditAmount: '0', description: null, taxCode: null },
    ])
  })

  it('aggregates the trial balance per account and nets to zero when reversed', () => {
    const rows = [
      { accountId: 'a1', debitAmount: '100', creditAmount: '0' },
      { accountId: 'a2', debitAmount: '0', creditAmount: '100' },
      { accountId: 'a1', debitAmount: '0', creditAmount: '100' },
      { accountId: 'a2', debitAmount: '100', creditAmount: '0' },
    ]
    const lines = buildTrialBalance(rows)
    expect(lines).toEqual([
      { accountId: 'a1', debit: '100.0000', credit: '100.0000' },
      { accountId: 'a2', debit: '100.0000', credit: '100.0000' },
    ])
    expect(isTrialBalanceBalanced(lines)).toBe(true)
  })
})
