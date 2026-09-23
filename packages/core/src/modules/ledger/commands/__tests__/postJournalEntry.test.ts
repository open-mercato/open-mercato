// Unit tests for `ledger.postJournalEntry` — scope: balanced-vs-unbalanced
// posting, rejection in a locked fiscal
// period, and sequenceNumber correctness under concurrency. Follows
// `currencies/commands/__tests__/scope.test.ts` /
// `currencies.atomicity.test.ts`'s own conventions: `registerCommand` and
// `resolveTranslations` are mocked, the command itself is loaded via
// `jest.isolateModules` + inspecting `registerCommand.mock.calls`, and the
// command is exercised through its real `execute()` against a fake
// EntityManager (`support/fakeEntityManager.ts`) — not a reimplementation
// of its logic.
export {}

import { FiscalPeriod, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { buildFakeCtx, buildFakeEm } from './support/fakeEntityManager'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    // Mirrors `createFallbackTranslator`'s real `{key}`/`{{key}}`
    // interpolation (packages/shared/src/lib/i18n/translate.ts) — needed
    // since M5's accountNotFound message interpolates `{ids}` into its
    // own fallback text rather than pre-baking the value via a JS
    // template literal.
    translate: (_key: string, fallback?: string, params?: Record<string, unknown>) => {
      const text = fallback ?? _key
      if (!params) return text
      return text.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_match: string, doubleKey?: string, singleKey?: string) => {
        const paramKey = doubleKey ?? singleKey
        return paramKey && paramKey in params ? String(params[paramKey]) : _match
      })
    },
  }),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const CASH_ACCOUNT = '33333333-3333-4333-8333-333333333333'
const REVENUE_ACCOUNT = '44444444-4444-4444-8444-444444444444'
const CURRENCY = '55555555-5555-4555-8555-555555555555'

type PostJournalEntryHandler = {
  execute: (input: unknown, ctx: unknown) => Promise<{ journalEntryId: string; sequenceNumber: number }>
}

function loadPostJournalEntry(): PostJournalEntryHandler {
  let command: unknown
  jest.isolateModules(() => {
    require('../postJournalEntry')
    command = registerCommand.mock.calls.find(([candidate]) => candidate.id === 'ledger.postJournalEntry')?.[0]
  })
  if (!command) throw new Error('ledger.postJournalEntry was not registered')
  return command as PostJournalEntryHandler
}

function balancedInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizationId: ORG,
    tenantId: TENANT,
    operationDate: '2026-02-15',
    description: 'Unit test entry',
    currencyId: CURRENCY,
    lines: [
      { accountId: CASH_ACCOUNT, debit: '100.0000' },
      { accountId: REVENUE_ACCOUNT, credit: '100.0000' },
    ],
    ...overrides,
  }
}

function seedOpenPeriod(em: ReturnType<typeof buildFakeEm>, start: string, end: string) {
  em.seed(FiscalPeriod, {
    id: 'period-open',
    organizationId: ORG,
    tenantId: TENANT,
    startDate: new Date(start),
    endDate: new Date(end),
    isLocked: false,
    deletedAt: null,
  })
}

function seedLockedPeriod(em: ReturnType<typeof buildFakeEm>, start: string, end: string) {
  em.seed(FiscalPeriod, {
    id: 'period-locked',
    organizationId: ORG,
    tenantId: TENANT,
    startDate: new Date(start),
    endDate: new Date(end),
    isLocked: true,
    deletedAt: null,
  })
}

/**
 * Seeds the `Currency` and `LedgerAccount` rows `balancedInput()`'s ids
 * reference — required since PR #6340 review's M5 fix
 * (`requireValidPostingReferences`) now rejects a post whose currency or
 * any line's account doesn't resolve to a real, scoped, non-deleted
 * record. Only the tests that exercise a real successful post need this;
 * the ones that reject earlier (zod validation, fiscal-period checks)
 * never reach `requireValidPostingReferences`.
 */
function seedCurrencyAndAccounts(em: ReturnType<typeof buildFakeEm>) {
  em.seed(Currency, { id: CURRENCY, organizationId: ORG, tenantId: TENANT, deletedAt: null })
  em.seed(LedgerAccount, { id: CASH_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
  em.seed(LedgerAccount, { id: REVENUE_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
}

describe('ledger.postJournalEntry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('posts a balanced entry into an open covering fiscal period', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
    seedCurrencyAndAccounts(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    const result = await command.execute(balancedInput(), ctx)

    expect(result.sequenceNumber).toBe(1)
    expect(result.journalEntryId).toBeTruthy()
    expect(em.flush).toHaveBeenCalled()

    const persistedLines = em.tables.get('JournalEntryLine') ?? []
    expect(persistedLines).toHaveLength(2)
    const totalDebit = persistedLines.reduce((sum, line) => sum + Number(line.debit ?? '0'), 0)
    const totalCredit = persistedLines.reduce((sum, line) => sum + Number(line.credit ?? '0'), 0)
    expect(totalDebit).toBeCloseTo(totalCredit)
    expect(totalDebit).toBeCloseTo(100)
  })

  it('rejects an entry whose debits and credits do not sum to the same total, before touching any fiscal period', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    // Deliberately no FiscalPeriod seeded — proves the schema-level balance
    // check runs (and rejects) before the command ever reads a period.
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(
      command.execute(
        balancedInput({
          lines: [
            { accountId: CASH_ACCOUNT, debit: '100.00' },
            { accountId: REVENUE_ACCOUNT, credit: '90.00' },
          ],
        }),
        ctx,
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/not balanced/i) })]),
    })
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('rejects a line with neither debit nor credit populated', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(
      command.execute(
        balancedInput({
          lines: [
            { accountId: CASH_ACCOUNT },
            { accountId: REVENUE_ACCOUNT, credit: '100.00' },
          ],
        }),
        ctx,
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/exactly one side/i) }),
      ]),
    })
  })

  it('rejects posting into a locked fiscal period', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedLockedPeriod(em, '2026-02-01', '2026-02-28')
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(command.execute(balancedInput(), ctx)).rejects.toMatchObject({
      status: 422,
      body: { error: expect.stringMatching(/locked/i) },
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects posting when no fiscal period covers the operation date', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-01-01', '2026-01-31') // covers January, not the February posting date below
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(command.execute(balancedInput(), ctx)).rejects.toMatchObject({
      status: 422,
      body: { error: expect.stringMatching(/no fiscal period/i) },
    })
  })

  // PR #6340 review, M5 ("Coverage gaps"): the review flagged "no tests for
  // ... posting to an out-of-scope or deleted account" alongside the M5
  // finding itself — these three cover currencyId, a missing accountId,
  // and a soft-deleted accountId, and confirm the sequence allocator
  // (em.execute) is never reached, matching the fix's own doc comment
  // ("a request that fails this check never burns a sequence number").
  it('rejects posting when the currency does not exist for the organization', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
    em.seed(LedgerAccount, { id: CASH_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
    em.seed(LedgerAccount, { id: REVENUE_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
    // Deliberately no Currency seeded.
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(command.execute(balancedInput(), ctx)).rejects.toMatchObject({
      status: 422,
      body: { error: expect.stringMatching(/currency/i) },
    })
    expect(em.execute).not.toHaveBeenCalled()
  })

  it('rejects posting when a line references an account that does not exist for the organization', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
    em.seed(Currency, { id: CURRENCY, organizationId: ORG, tenantId: TENANT, deletedAt: null })
    em.seed(LedgerAccount, { id: CASH_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
    // REVENUE_ACCOUNT deliberately not seeded.
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(command.execute(balancedInput(), ctx)).rejects.toMatchObject({
      status: 422,
      body: { error: expect.stringMatching(new RegExp(REVENUE_ACCOUNT)) },
    })
    expect(em.execute).not.toHaveBeenCalled()
  })

  it('rejects posting when a line references a soft-deleted account', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
    em.seed(Currency, { id: CURRENCY, organizationId: ORG, tenantId: TENANT, deletedAt: null })
    em.seed(LedgerAccount, { id: CASH_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: null })
    // REVENUE_ACCOUNT exists, but soft-deleted — must be treated the same
    // as not existing, not silently accepted because a row is present.
    em.seed(LedgerAccount, { id: REVENUE_ACCOUNT, organizationId: ORG, tenantId: TENANT, deletedAt: new Date('2026-01-01') })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(command.execute(balancedInput(), ctx)).rejects.toMatchObject({
      status: 422,
      body: { error: expect.stringMatching(/account/i) },
    })
    expect(em.execute).not.toHaveBeenCalled()
  })

  it('translates a deferred balance-trigger violation at commit into a readable error', async () => {
    const command = loadPostJournalEntry()
    const triggerError = new Error(
      'journal_entry_line: unbalanced journal entry deadbeef (debit 100.0000 <> credit 90.0000)',
    )
    const em = buildFakeEm({ throwOnNextFlush: triggerError })
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
    seedCurrencyAndAccounts(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(command.execute(balancedInput(), ctx)).rejects.toMatchObject({
      status: 500,
      body: { error: expect.stringMatching(/rejected at commit/i) },
    })
  })

  // This exercises the fake EntityManager's `Promise.all` interleaving, which
  // resolves each call synchronously in turn — it cannot reproduce real
  // Postgres MVCC contention (PR #6340 review nit: "can't detect a race
  // because the fake is single-threaded", confirmed correct on inspection).
  // What it DOES prove, and the reason it stays: the allocator issues one
  // atomic `INSERT ... ON CONFLICT ... RETURNING` per call rather than a
  // separate SELECT-then-UPDATE, which is the actual property real Postgres
  // needs to serialize concurrent allocations without gaps or duplicates —
  // that guarantee itself was verified against a live Postgres 17 instance
  // (embedded-postgres, ad hoc, not part of this suite) as part of the m6/m8
  // verification for this PR. A real concurrent-connections test belongs in
  // its own PR: it would need a live-Postgres test harness this suite does
  // not have today, which is a tooling decision on the same footing as M8's
  // BDD harness — worth proposing separately, not smuggling in via a nit fix.
  it('allocates strictly sequential, non-duplicate sequence numbers under concurrent posting (fake EM, not a true concurrency test — see comment above)', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
    seedCurrencyAndAccounts(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    const CONCURRENT_POSTS = 5
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_POSTS }, () => command.execute(balancedInput(), ctx)),
    )

    const sequenceNumbers = results.map((r) => r.sequenceNumber).sort((a, b) => a - b)
    expect(sequenceNumbers).toEqual([1, 2, 3, 4, 5])

    // Guard against a future regression to a non-atomic
    // read-then-write for the sequence counter: the allocator must issue
    // a single `INSERT ... ON CONFLICT ... RETURNING` statement, not a
    // separate SELECT followed by an UPDATE — checked across every one of
    // the concurrent calls, not just the first.
    // `claimNextSequenceNumber` now calls `em.execute(...)` directly (PR
    // #6340 review's M2 fix), not `em.getConnection().execute(...)` — assert
    // on `em.execute` itself rather than a connection obtained via
    // `getConnection()`, which this path no longer calls.
    // Each successful post now also issues one `SET CONSTRAINTS ...
    // IMMEDIATE` call (PR #6340 review, m5) — filtered out below so this
    // assertion still targets only the sequence allocator's own calls.
    const sequenceCalls = em.execute.mock.calls.filter((call) => /insert into journal_entry_sequence/i.test(call[0] as string))
    expect(sequenceCalls).toHaveLength(CONCURRENT_POSTS)
    for (const call of sequenceCalls) {
      const sql = call[0] as string
      expect(sql).toMatch(/insert into journal_entry_sequence/i)
      expect(sql).toMatch(/on conflict/i)
      expect(sql).toMatch(/returning/i)
    }
    const constraintCalls = em.execute.mock.calls.filter((call) => /set constraints/i.test(call[0] as string))
    expect(constraintCalls).toHaveLength(CONCURRENT_POSTS)
  })
})
