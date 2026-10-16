// Unit tests for `PostingRulesEngineSubscriber`: delivery is persistent, the
// payload alone decides what is skipped, every zespół 4 line of an entry is
// reclassified, errors a retry cannot fix are logged and swallowed, and
// transient ones are thrown (after the remaining lines were tried) so that
// persistent delivery retries them.
export {}

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import handle, { metadata } from '../postingRulesEngineSubscriber'
import { PostingRulesSettings } from '../../data/entities'
import { RECLASSIFICATION_REFERENCE_TYPE } from '../../lib/reclassify'
import {
  CLEARING_ACCOUNT_ID,
  OTHER_ACCOUNT_ID,
  ORG,
  RULE_DEFAULT_COST_CENTER_ID,
  SECOND_SOURCE_ACCOUNT_ID,
  SECOND_TARGET_ACCOUNT_ID,
  SOURCE_ACCOUNT_ID,
  TARGET_ACCOUNT_ID,
  TENANT,
  buildContainer,
  buildFakeCommandBus,
  buildFakeEm,
  seedCostCenter,
  seedEntry,
  seedNonZespol4Account,
  seedRule,
  seedSentinelCostCenter,
  seedSettings,
  seedZespol4Account,
} from '../../lib/__tests__/support/fixtures'

jest.mock('../../../ledger/events', () => ({ emitLedgerEvent: jest.fn(async () => undefined) }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const warn = jest.fn()
  return { createLogger: () => ({ child: () => ({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() }) }), __warn: warn }
})
const loggerWarn: jest.Mock = require('@open-mercato/shared/lib/logger').__warn

function setup() {
  const em = buildFakeEm()
  const bus = buildFakeCommandBus(em)
  const container = buildContainer(em, bus)
  seedZespol4Account(em, SOURCE_ACCOUNT_ID)
  seedZespol4Account(em, SECOND_SOURCE_ACCOUNT_ID)
  seedNonZespol4Account(em, OTHER_ACCOUNT_ID)
  seedSettings(em)
  seedSentinelCostCenter(em)
  seedCostCenter(em, RULE_DEFAULT_COST_CENTER_ID)
  seedRule(em)
  seedRule(em, { id: 'rule-2', sourceAccountId: SECOND_SOURCE_ACCOUNT_ID, targetAccountId: SECOND_TARGET_ACCOUNT_ID })
  loggerWarn.mockClear()
  return { em, bus, container }
}

function seedPostedEntry(em: ReturnType<typeof buildFakeEm>, overrides: Record<string, unknown> = {}) {
  seedEntry(
    em,
    'entry-1',
    [
      { id: 'line-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00', amountCurrency: '23.14' },
      { id: 'line-2', accountId: SECOND_SOURCE_ACCOUNT_ID, debit: '40.00' },
      { id: 'line-3', accountId: OTHER_ACCOUNT_ID, credit: '140.00' },
    ],
    { currencyId: 'EUR', exchangeRate: '4.3210', ...overrides },
  )
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    journalEntryId: 'entry-1',
    sequenceNumber: 7,
    type: 'NORMAL',
    operationDate: '2026-09-01',
    organizationId: ORG,
    tenantId: TENANT,
    referenceType: null,
    referenceId: null,
    lines: [
      { id: 'line-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00', credit: '0' },
      { id: 'line-2', accountId: SECOND_SOURCE_ACCOUNT_ID, debit: '40.00', credit: '0' },
      { id: 'line-3', accountId: OTHER_ACCOUNT_ID, debit: '0', credit: '140.00' },
    ],
    ...overrides,
  }
}

describe('PostingRulesEngineSubscriber', () => {
  it('is declared persistent, on ledger.journal_entry.posted', () => {
    expect(metadata).toMatchObject({ event: 'ledger.journal_entry.posted', persistent: true })
  })

  it('reclassifies every zespół 4 line of the entry, reading currency from the database (the payload carries none)', async () => {
    const { em, bus, container } = setup()
    seedPostedEntry(em)

    await handle(payload(), container as any)

    expect(bus.postCalls.map((call) => call.input.referenceId)).toEqual(['line-1', 'line-2'])
    expect(bus.postCalls[0].input).toMatchObject({ currencyId: 'EUR', exchangeRate: '4.3210' })
    expect(bus.postCalls[0].input.lines[0]).toMatchObject({ accountId: TARGET_ACCOUNT_ID, amountCurrency: '23.14' })
    expect(bus.postCalls[1].input.lines[0]).toMatchObject({ accountId: SECOND_TARGET_ACCOUNT_ID })
  })

  it('is idempotent: a redelivery of the same event posts nothing more', async () => {
    const { em, bus, container } = setup()
    seedPostedEntry(em)
    await handle(payload(), container as any)
    await handle(payload(), container as any)
    expect(bus.postCalls).toHaveLength(2)
  })

  it.each(['CLOSING', 'OPENING'])('skips a %s entry from the payload alone, without touching the database', async (type: string) => {
    const { bus, container } = setup()
    await handle(payload({ type }), container as any)
    expect(bus.execute).not.toHaveBeenCalled()
    expect(container.resolve).not.toHaveBeenCalledWith('em')
  })

  it('ignores the engine\'s own entries (Invariant 3)', async () => {
    const { bus, container } = setup()
    await handle(payload({ referenceType: RECLASSIFICATION_REFERENCE_TYPE, referenceId: 'line-1' }), container as any)
    expect(bus.execute).not.toHaveBeenCalled()
  })

  it('ignores a line on the clearing account', async () => {
    const { em, bus, container } = setup()
    seedZespol4Account(em, CLEARING_ACCOUNT_ID)
    seedEntry(em, 'entry-1', [
      { id: 'line-1', accountId: CLEARING_ACCOUNT_ID, debit: '100.00' },
      { id: 'line-3', accountId: OTHER_ACCOUNT_ID, credit: '100.00' },
    ])
    await handle(payload(), container as any)
    expect(bus.postCalls).toHaveLength(0)
  })

  it('logs and swallows an error a retry cannot fix (clearing account not configured), leaving the lines to the sweeper', async () => {
    const { em, bus, container } = setup()
    seedPostedEntry(em)
    em.rows(PostingRulesSettings)[0].clearingAccountId = null

    await expect(handle(payload(), container as any)).resolves.toBeUndefined()

    expect(bus.postCalls).toHaveLength(0)
    expect(loggerWarn).toHaveBeenCalledTimes(2)
    expect(loggerWarn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ journalEntryId: 'entry-1', lineId: 'line-1' }))
  })

  it('logs and swallows a locked-period rejection from the ledger', async () => {
    const { em, bus, container } = setup()
    seedPostedEntry(em)
    bus.failNext('ledger.postJournalEntry', new CrudHttpError(422, { error: 'period locked' }))

    await expect(handle(payload(), container as any)).resolves.toBeUndefined()

    expect(loggerWarn).toHaveBeenCalledTimes(1)
    expect(bus.postCalls.map((call) => call.input.referenceId)).toEqual(['line-2']) // the other line still went through
  })

  it('throws a transient error so delivery is retried — after the remaining lines were tried', async () => {
    const { em, bus, container } = setup()
    seedPostedEntry(em)
    bus.failNext('ledger.postJournalEntry', new Error('connection reset'))

    await expect(handle(payload(), container as any)).rejects.toThrow('connection reset')

    expect(bus.postCalls.map((call) => call.input.referenceId)).toEqual(['line-2'])
    expect(loggerWarn).not.toHaveBeenCalled()

    // The retry reclassifies only what is still missing.
    await handle(payload(), container as any)
    expect(bus.postCalls.map((call) => call.input.referenceId)).toEqual(['line-2', 'line-1'])
  })
})
