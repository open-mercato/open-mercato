import {
  FINANCIAL_ACCOUNT_ENTITY_ID,
  FINANCIAL_ENTRY_ENTITY_ID,
  FINANCIAL_PERIOD_ENTITY_ID,
  closePeriodSchema,
  financialAccountEvents,
  financialEntryIndexer,
  postJournalEntrySchema,
  reopenPeriodSchema,
  reverseJournalEntrySchema,
} from '../ledger'

const id = '11111111-1111-4111-8111-111111111111'

describe('financial command surface', () => {
  it('declares stable entity ids', () => {
    expect(FINANCIAL_ACCOUNT_ENTITY_ID).toBe('financial:gl_account')
    expect(FINANCIAL_PERIOD_ENTITY_ID).toBe('financial:gl_period')
    expect(FINANCIAL_ENTRY_ENTITY_ID).toBe('financial:gl_journal_entry')
    expect(financialAccountEvents.module).toBe('financial')
    expect(financialEntryIndexer.entityType).toBe(FINANCIAL_ENTRY_ENTITY_ID)
  })

  it('parses the action payloads the routes forward', () => {
    expect(postJournalEntrySchema.parse({ id }).id).toBe(id)
    expect(reverseJournalEntrySchema.parse({ id, postingDate: '2026-10-10' }).postingDate).toBe('2026-10-10')
    expect(closePeriodSchema.parse({ id, target: 'soft_closed' }).target).toBe('soft_closed')
    expect(closePeriodSchema.safeParse({ id, target: 'open' }).success).toBe(false)
    expect(reopenPeriodSchema.parse({ id }).id).toBe(id)
  })

  it('rejects a non-uuid id in every action payload', () => {
    expect(postJournalEntrySchema.safeParse({ id: 'nope' }).success).toBe(false)
    expect(reverseJournalEntrySchema.safeParse({ id: 'nope' }).success).toBe(false)
    expect(closePeriodSchema.safeParse({ id: 'nope', target: 'hard_closed' }).success).toBe(false)
    expect(reopenPeriodSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })
})
