// OM-13 unit tests for `ledger.postJournalEntry` — scope per the Jira
// ticket: balanced-vs-unbalanced posting, rejection in a locked fiscal
// period, and sequenceNumber correctness under concurrency. Follows
// `currencies/commands/__tests__/scope.test.ts` /
// `currencies.atomicity.test.ts`'s own conventions: `registerCommand` and
// `resolveTranslations` are mocked, the command itself is loaded via
// `jest.isolateModules` + inspecting `registerCommand.mock.calls`, and the
// command is exercised through its real `execute()` against a fake
// EntityManager (`support/fakeEntityManager.ts`) — not a reimplementation
// of its logic.
export {}

import { FiscalPeriod } from '../../data/entities'
import { buildFakeCtx, buildFakeEm } from './support/fakeEntityManager'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
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
    description: 'OM-13 unit test entry',
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

describe('ledger.postJournalEntry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('posts a balanced entry into an open covering fiscal period', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
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

  it('translates a deferred balance-trigger violation at commit into a readable error', async () => {
    const command = loadPostJournalEntry()
    const triggerError = new Error(
      'journal_entry_line: unbalanced journal entry deadbeef (debit 100.0000 <> credit 90.0000)',
    )
    const em = buildFakeEm({ throwOnNextFlush: triggerError })
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(command.execute(balancedInput(), ctx)).rejects.toMatchObject({
      status: 500,
      body: { error: expect.stringMatching(/rejected at commit/i) },
    })
  })

  it('allocates strictly sequential, non-duplicate sequence numbers under concurrent posting', async () => {
    const command = loadPostJournalEntry()
    const em = buildFakeEm()
    seedOpenPeriod(em, '2026-02-01', '2026-02-28')
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
    const connection = em.getConnection.mock.results[0]?.value as { execute: jest.Mock }
    expect(connection.execute.mock.calls).toHaveLength(CONCURRENT_POSTS)
    for (const call of connection.execute.mock.calls) {
      const sql = call[0] as string
      expect(sql).toMatch(/insert into journal_entry_sequence/i)
      expect(sql).toMatch(/on conflict/i)
      expect(sql).toMatch(/returning/i)
    }
  })
})
