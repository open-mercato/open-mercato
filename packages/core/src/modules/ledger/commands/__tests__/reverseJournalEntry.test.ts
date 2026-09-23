// OM-13 unit tests for `ledger.reverseJournalEntry` — scope per the Jira
// ticket: "poprawność powiązania storna (`reverseJournalEntry` ->
// referenceType/referenceId)". Also covers the design decision the spec
// documents ("a reversal exists to move a correction into an open
// period"): the fiscal-period-lock check inside the shared
// `runPostJournalEntry` core must be evaluated against the REVERSAL's own
// `operationDate`, not the original entry's.
export {}

import { FiscalPeriod, JournalEntry, JournalEntryLine, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { buildFakeCtx, buildFakeEm } from './support/fakeEntityManager'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      if (!fallback) return _key
      if (!vars) return fallback
      return Object.entries(vars).reduce((text, [k, v]) => text.replaceAll(`\${${k}}`, String(v)), fallback)
    },
  }),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const CASH_ACCOUNT = '33333333-3333-4333-8333-333333333333'
const REVENUE_ACCOUNT = '44444444-4444-4444-8444-444444444444'
const CURRENCY = '55555555-5555-4555-8555-555555555555'
const ORIGINAL_ENTRY_ID = '66666666-6666-4666-8666-666666666666'

type ReverseJournalEntryHandler = {
  execute: (input: unknown, ctx: unknown) => Promise<{ journalEntryId: string; sequenceNumber: number }>
}

function loadReverseJournalEntry(): ReverseJournalEntryHandler {
  let command: unknown
  jest.isolateModules(() => {
    // Requiring `../reverseJournalEntry` also requires `./postJournalEntry`
    // transitively (it reuses `runPostJournalEntry`/`withPostingTransaction`
    // directly, not through `commandRegistry`), which registers
    // `ledger.postJournalEntry` too — harmless here, this test only looks
    // up `ledger.reverseJournalEntry`.
    require('../reverseJournalEntry')
    command = registerCommand.mock.calls.find(([candidate]) => candidate.id === 'ledger.reverseJournalEntry')?.[0]
  })
  if (!command) throw new Error('ledger.reverseJournalEntry was not registered')
  return command as ReverseJournalEntryHandler
}

function seedOriginalEntry(em: ReturnType<typeof buildFakeEm>) {
  // The original's own period: open when it was posted, seeded here
  // already locked — the situation that makes a reversal (not a plain
  // edit) the only way to correct it.
  em.seed(FiscalPeriod, {
    id: 'period-original-now-locked',
    organizationId: ORG,
    tenantId: TENANT,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-31'),
    isLocked: true,
    deletedAt: null,
  })
  em.seed(JournalEntry, {
    id: ORIGINAL_ENTRY_ID,
    organizationId: ORG,
    tenantId: TENANT,
    sequenceNumber: 1,
    postedAt: new Date('2026-01-15T00:00:00Z'),
    operationDate: new Date('2026-01-15'),
    documentType: null,
    documentNumber: null,
    documentDate: null,
    description: 'Original entry (OM-13 fixture)',
    type: 'NORMAL',
    currencyId: CURRENCY,
    exchangeRate: null,
    referenceType: null,
    referenceId: null,
  })
  em.seed(JournalEntryLine, {
    id: 'line-cash',
    organizationId: ORG,
    tenantId: TENANT,
    journalEntryId: ORIGINAL_ENTRY_ID,
    accountId: CASH_ACCOUNT,
    debit: '100.00',
    credit: '0',
    amountCurrency: '100.00',
    contractorSnapshot: null,
  })
  em.seed(JournalEntryLine, {
    id: 'line-revenue',
    organizationId: ORG,
    tenantId: TENANT,
    journalEntryId: ORIGINAL_ENTRY_ID,
    accountId: REVENUE_ACCOUNT,
    debit: '0',
    credit: '100.00',
    amountCurrency: '100.00',
    contractorSnapshot: null,
  })
  em.seedSequenceCounter({ organizationId: ORG, tenantId: TENANT }, 2)
  // The reversal re-posts through the same `requireValidPostingReferences`
  // path as a fresh entry (PR #6340 review's M5 fix) — needs the original
  // entry's currency/accounts to resolve as real, scoped, non-deleted rows.
  em.seed(Currency, { id: CURRENCY, organizationId: ORG, tenantId: TENANT, deletedAt: null })
  em.seed(LedgerAccount, { id: CASH_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
  em.seed(LedgerAccount, { id: REVENUE_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
}

function seedOpenPeriod(em: ReturnType<typeof buildFakeEm>, id: string, start: string, end: string) {
  em.seed(FiscalPeriod, {
    id,
    organizationId: ORG,
    tenantId: TENANT,
    startDate: new Date(start),
    endDate: new Date(end),
    isLocked: false,
    deletedAt: null,
  })
}

describe('ledger.reverseJournalEntry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('reverses a posted entry into a still-open period, with inverted lines and correct reference linkage', async () => {
    const command = loadReverseJournalEntry()
    const em = buildFakeEm()
    seedOriginalEntry(em)
    seedOpenPeriod(em, 'period-may-open', '2026-05-01', '2026-05-31')
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    const result = await command.execute(
      { organizationId: ORG, tenantId: TENANT, journalEntryId: ORIGINAL_ENTRY_ID, operationDate: '2026-05-15' },
      ctx,
    )

    expect(result.sequenceNumber).toBe(2)
    expect(result.journalEntryId).not.toBe(ORIGINAL_ENTRY_ID)

    const reversalEntry = (em.tables.get('JournalEntry') ?? []).find((e) => e.id === result.journalEntryId)
    expect(reversalEntry).toMatchObject({
      type: 'REVERSAL',
      referenceType: 'journal_entry',
      referenceId: ORIGINAL_ENTRY_ID,
    })

    const reversalLines = (em.tables.get('JournalEntryLine') ?? []).filter(
      (line) => line.journalEntryId === result.journalEntryId,
    )
    expect(reversalLines).toHaveLength(2)
    const cashLine = reversalLines.find((line) => line.accountId === CASH_ACCOUNT)
    const revenueLine = reversalLines.find((line) => line.accountId === REVENUE_ACCOUNT)
    // Inverted relative to the original: cash was debited there, credited here.
    expect(cashLine).toMatchObject({ debit: '0', credit: '100.00' })
    expect(revenueLine).toMatchObject({ debit: '100.00', credit: '0' })
  })

  it('checks the fiscal-period lock against the REVERSAL\'s own operation date, not the original\'s', async () => {
    const command = loadReverseJournalEntry()
    const em = buildFakeEm()
    seedOriginalEntry(em) // original's own period ("period-original-now-locked") is locked
    // No period seeded for May at all this time — the reversal's own date
    // (2026-05-15) is covered by nothing.
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(
      command.execute(
        { organizationId: ORG, tenantId: TENANT, journalEntryId: ORIGINAL_ENTRY_ID, operationDate: '2026-05-15' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422, body: { error: expect.stringMatching(/no fiscal period/i) } })
  })

  it('rejects reversing into a period that is itself locked', async () => {
    const command = loadReverseJournalEntry()
    const em = buildFakeEm()
    seedOriginalEntry(em)
    em.seed(FiscalPeriod, {
      id: 'period-may-locked',
      organizationId: ORG,
      tenantId: TENANT,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-31'),
      isLocked: true,
      deletedAt: null,
    })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(
      command.execute(
        { organizationId: ORG, tenantId: TENANT, journalEntryId: ORIGINAL_ENTRY_ID, operationDate: '2026-05-15' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422, body: { error: expect.stringMatching(/locked/i) } })
  })

  it('rejects reversing a journal entry that does not exist', async () => {
    const command = loadReverseJournalEntry()
    const em = buildFakeEm()
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(
      command.execute(
        { organizationId: ORG, tenantId: TENANT, journalEntryId: '99999999-9999-4999-8999-999999999999', operationDate: '2026-05-15' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('defaults the reversal description to reference the original entry\'s sequence number when none is supplied', async () => {
    const command = loadReverseJournalEntry()
    const em = buildFakeEm()
    seedOriginalEntry(em)
    seedOpenPeriod(em, 'period-may-open', '2026-05-01', '2026-05-31')
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    const result = await command.execute(
      { organizationId: ORG, tenantId: TENANT, journalEntryId: ORIGINAL_ENTRY_ID, operationDate: '2026-05-15' },
      ctx,
    )

    const reversalEntry = (em.tables.get('JournalEntry') ?? []).find((e) => e.id === result.journalEntryId)
    expect(reversalEntry?.description).toBe('Reversal of journal entry #1')
  })
})
