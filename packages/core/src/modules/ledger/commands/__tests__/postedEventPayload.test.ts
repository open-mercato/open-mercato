// Unit tests for the line currency fields in the `ledger.journal_entry.posted`
// payload (#5663, OQ-2 in "Decisions on the review of 2026-10-26"): both
// emitters, `postJournalEntry` and `reverseJournalEntry`, send each line's
// `currencyId`, `exchangeRate` and `amountCurrency` next to `debit`/`credit`,
// and the command results carry the same line shape.
export {}

import { FiscalPeriod, JournalEntry, JournalEntryLine, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { buildFakeCtx, buildFakeEm } from './support/fakeEntityManager'

const registerCommand = jest.fn()
const mockLogError = jest.fn()
const mockReportError = jest.fn()
const queueError = new Error('queue unavailable')

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  return {
    ...actual,
    createLogger: (namespace: string) => namespace === 'ledger:posting'
      ? { error: mockLogError }
      : actual.createLogger(namespace),
  }
})

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/telemetry/runtime'),
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const emitLedgerEvent = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitLedgerEvent,
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const EXPENSE = '33333333-3333-4333-8333-333333333333'
const PAYABLE = '44444444-4444-4444-8444-444444444444'
const PLN = '55555555-5555-4555-8555-555555555555'
const EUR = '66666666-6666-4666-8666-666666666666'
const ORIGINAL_ENTRY_ID = '77777777-7777-4777-8777-777777777777'

type PostedLine = {
  id: string
  accountId: string
  debit: string
  credit: string
  currencyId: string
  exchangeRate: string
  amountCurrency: string
}
type Handler = {
  execute: (input: unknown, ctx: unknown) => Promise<{ journalEntryId: string; lines: PostedLine[] }>
}

function loadCommand(modulePath: string, id: string): Handler {
  let command: unknown
  jest.isolateModules(() => {
    require(modulePath)
    command = registerCommand.mock.calls.find(([candidate]) => candidate.id === id)?.[0]
  })
  if (!command) throw new Error(`${id} was not registered`)
  return command as Handler
}

function seedReferences(em: ReturnType<typeof buildFakeEm>) {
  em.seed(FiscalPeriod, {
    id: 'period-open',
    organizationId: ORG,
    tenantId: TENANT,
    startDate: new Date('2026-02-01'),
    endDate: new Date('2026-05-31'),
    isLocked: false,
    deletedAt: null,
  })
  em.seed(Currency, { id: PLN, organizationId: ORG, tenantId: TENANT, isBase: true, decimalPlaces: 2, deletedAt: null })
  em.seed(Currency, { id: EUR, organizationId: ORG, tenantId: TENANT, isBase: false, decimalPlaces: 2, deletedAt: null })
  em.seed(LedgerAccount, { id: EXPENSE, organizationId: ORG, tenantId: TENANT, currencyId: null, deletedAt: null })
  em.seed(LedgerAccount, { id: PAYABLE, organizationId: ORG, tenantId: TENANT, currencyId: null, deletedAt: null })
}

const publicationCases = [
  { mode: 'after commit', callerTransaction: false, enqueueFails: false },
  { mode: 'when enqueue fails after commit', callerTransaction: false, enqueueFails: true },
  { mode: 'inside a caller transaction', callerTransaction: true, enqueueFails: false },
]

function expectPublication(callerTransaction: boolean, enqueueFails: boolean, journalEntryId: string, lines: PostedLine[]) {
  if (enqueueFails) {
    const attributes = { journalEntryId, tenantId: TENANT, organizationId: ORG }
    expect(mockLogError).toHaveBeenCalledWith('Failed to enqueue committed journal entry', { err: queueError, ...attributes })
    expect(mockReportError).toHaveBeenCalledWith(queueError, { module: 'ledger', code: 'ledger.posted_event_enqueue_failed', attributes })
  } else {
    expect(mockReportError).not.toHaveBeenCalled()
  }
  if (callerTransaction) {
    expect(emitLedgerEvent).not.toHaveBeenCalled()
    return
  }
  expect(emitLedgerEvent).toHaveBeenCalledTimes(1)
  expect(emitLedgerEvent).toHaveBeenCalledWith(
    'ledger.journal_entry.posted',
    expect.objectContaining({ journalEntryId, lines }),
    { persistent: true },
  )
}

describe('ledger.journal_entry.posted', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it.each(publicationCases)('publishes a posting with its currency details $mode', async ({ callerTransaction, enqueueFails }) => {
    const command = loadCommand('../postJournalEntry', 'ledger.postJournalEntry')
    const em = buildFakeEm()
    seedReferences(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    if (enqueueFails) emitLedgerEvent.mockRejectedValueOnce(queueError)
    const result = await command.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        operationDate: '2026-02-15',
        description: 'EUR invoice',
        currencyId: EUR,
        exchangeRate: '4.25000000',
        lines: [
          { accountId: EXPENSE, currencyId: PLN, debit: '425.00' },
          { accountId: PAYABLE, credit: '425.00', amountCurrency: '100.0000' },
        ],
      },
      callerTransaction ? { ...ctx, transactionalEm: em } : ctx,
    )

    const { lines } = result
    await Promise.resolve()
    expectPublication(callerTransaction, enqueueFails, result.journalEntryId, lines)
    expect(em.transactional).toHaveBeenCalledTimes(callerTransaction ? 0 : 1)
    expect(lines).toHaveLength(2)
    expect(lines.find((line) => line.accountId === EXPENSE)).toMatchObject({
      debit: '425.00',
      currencyId: PLN,
      exchangeRate: '1',
      amountCurrency: '425.00',
    })
    expect(lines.find((line) => line.accountId === PAYABLE)).toMatchObject({
      credit: '425.00',
      currencyId: EUR,
      exchangeRate: '4.25000000',
      amountCurrency: '100.0000',
    })
  })

  it.each(publicationCases)('publishes a reversal with its original currency details $mode', async ({ callerTransaction, enqueueFails }) => {
    const command = loadCommand('../reverseJournalEntry', 'ledger.reverseJournalEntry')
    const em = buildFakeEm()
    seedReferences(em)
    em.seed(JournalEntry, {
      id: ORIGINAL_ENTRY_ID,
      organizationId: ORG,
      tenantId: TENANT,
      sequenceNumber: 1,
      postedAt: new Date('2026-02-15T00:00:00Z'),
      operationDate: new Date('2026-02-15'),
      documentType: null,
      documentNumber: null,
      documentDate: null,
      description: 'EUR invoice',
      type: 'NORMAL',
      currencyId: EUR,
      exchangeRate: '4.25000000',
      referenceType: null,
      referenceId: null,
    })
    em.seed(JournalEntryLine, {
      id: 'line-expense',
      organizationId: ORG,
      tenantId: TENANT,
      journalEntryId: ORIGINAL_ENTRY_ID,
      accountId: EXPENSE,
      debit: '425.00',
      credit: '0',
      currencyId: PLN,
      exchangeRate: '1',
      amountCurrency: '425.00',
      contractorSnapshot: null,
    })
    em.seed(JournalEntryLine, {
      id: 'line-payable',
      organizationId: ORG,
      tenantId: TENANT,
      journalEntryId: ORIGINAL_ENTRY_ID,
      accountId: PAYABLE,
      debit: '0',
      credit: '425.00',
      currencyId: EUR,
      exchangeRate: '4.25000000',
      amountCurrency: '100.0000',
      contractorSnapshot: null,
    })
    em.seedSequenceCounter({ organizationId: ORG, tenantId: TENANT }, 2)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    if (enqueueFails) emitLedgerEvent.mockRejectedValueOnce(queueError)
    const result = await command.execute(
      { organizationId: ORG, tenantId: TENANT, journalEntryId: ORIGINAL_ENTRY_ID, operationDate: '2026-03-10' },
      callerTransaction ? { ...ctx, transactionalEm: em } : ctx,
    )

    const { lines } = result
    await Promise.resolve()
    expectPublication(callerTransaction, enqueueFails, result.journalEntryId, lines)
    expect(em.transactional).toHaveBeenCalledTimes(callerTransaction ? 0 : 1)
    expect(lines).toHaveLength(2)
    expect(lines.find((line) => line.accountId === EXPENSE)).toMatchObject({
      debit: '0',
      credit: '425.00',
      currencyId: PLN,
      exchangeRate: '1',
      amountCurrency: '425.00',
    })
    expect(lines.find((line) => line.accountId === PAYABLE)).toMatchObject({
      debit: '425.00',
      credit: '0',
      currencyId: EUR,
      exchangeRate: '4.25000000',
      amountCurrency: '100.0000',
    })
  })
})
