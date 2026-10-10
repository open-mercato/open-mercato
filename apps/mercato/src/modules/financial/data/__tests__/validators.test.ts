import { createJournalEntrySchema, createPeriodSchema, journalLineInputSchema } from '../validators'

const baseEntry = {
  entryNumber: 'JE-1',
  entryDate: '2026-10-09',
  postingDate: '2026-10-09',
  periodId: '11111111-1111-4111-8111-111111111111',
  description: 'Opening entry',
  currencyCode: 'SAR',
  lines: [
    { accountId: '22222222-2222-4222-8222-222222222222', debitAmount: '100.00' },
    { accountId: '33333333-3333-4333-8333-333333333333', creditAmount: '100.00' },
  ],
}

describe('journal entry validator', () => {
  it('accepts a balanced entry and defaults the missing side to zero', () => {
    const parsed = createJournalEntrySchema.parse(baseEntry)
    expect(parsed.lines).toHaveLength(2)
    expect(parsed.entryNumber).toBe('JE-1')
  })

  it('rejects an unbalanced entry with the rule code on the lines path', () => {
    const result = createJournalEntrySchema.safeParse({
      ...baseEntry,
      lines: [
        { accountId: baseEntry.lines[0].accountId, debitAmount: '100.00' },
        { accountId: baseEntry.lines[1].accountId, creditAmount: '99.99' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((candidate) => candidate.path.join('.') === 'lines')
      expect(issue?.message).toBe('entry_unbalanced')
    }
  })

  it('rejects a line that carries neither a debit nor a credit', () => {
    const result = createJournalEntrySchema.safeParse({
      ...baseEntry,
      lines: [
        { accountId: baseEntry.lines[0].accountId, debitAmount: '100.00' },
        { accountId: baseEntry.lines[1].accountId },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((candidate) => candidate.message === 'entry_line_single_sided')).toBe(true)
    }
  })

  it('requires a currency of exactly three characters', () => {
    expect(journalLineInputSchema.safeParse({ accountId: baseEntry.lines[0].accountId, debitAmount: '1' }).success).toBe(true)
    expect(createJournalEntrySchema.safeParse({ ...baseEntry, currencyCode: 'SARI' }).success).toBe(false)
  })
})

describe('period validator', () => {
  it('refuses an end date before the start date', () => {
    const result = createPeriodSchema.safeParse({
      fiscalYear: 2026,
      periodNumber: 1,
      periodName: 'January 2026',
      startDate: '2026-01-31',
      endDate: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('accepts an ordered period', () => {
    expect(
      createPeriodSchema.safeParse({
        fiscalYear: 2026,
        periodNumber: 1,
        periodName: 'January 2026',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      }).success,
    ).toBe(true)
  })
})
