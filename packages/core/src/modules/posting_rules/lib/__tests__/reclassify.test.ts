// Unit tests for `reclassifyLine` (lib/reclassify.ts) — the shared
// "reclassify one line" helper used by both the real-time subscriber and
// `reconcileCostRing`'s repair sweep.
//
// **Disclosed scope**: per the spec's Testing Strategy, this exercises the
// paths judged highest-risk/highest-value within the time available —
// Invariant 3 (never react to the engine's own output), zespół-4 detection,
// the MPK (cost centre) priority hybrid's all three paths (explicit tag >
// rule default > sentinel), and the two "cannot resolve where to post"
// rejections (missing clearing account, missing target account). The
// contra-side (reversal/mirror) path (`findOriginalReclassification` and
// its mirror-posting logic) is NOT covered here and is left as a disclosed
// gap — it needs its own fixture set (an original reclassification entry
// plus its own reversal) that didn't fit this pass's time budget.
export {}

import {
  LedgerAccount,
  LedgerAccountGroup,
  LedgerAccountType,
} from '../../../ledger/data/entities'
import { JournalEntryLineDimension } from '../../../journal_entry_line_dimension/data/entities'
import { CostCenter, DefaultAccountPostingRule, PostingRulesSettings } from '../../data/entities'
import { UNALLOCATED_COST_CENTER_CODE } from '../seedDefaults'
import { reclassifyLine, RECLASSIFICATION_REFERENCE_TYPE, type ReclassifyCandidate, type ReclassifyDeps } from '../reclassify'

// ---------------------------------------------------------------------------
// A small, hand-rolled fake `EntityManager` — narrower than
// `ledger/commands/__tests__/support/fakeEntityManager.ts` (that file's own
// `transactional`/`flush`/raw-SQL surface is for command handlers; this file
// under test only ever calls `em.findOne`/`em.find`, both plain equality
// lookups keyed by entity class name).
// ---------------------------------------------------------------------------

type FakeRecord = Record<string, unknown>

function matchesWhere(record: FakeRecord, where: FakeRecord): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true
    const value = record[key]
    if (condition === null) return value === null || value === undefined
    return value === condition
  })
}

function buildFakeEm() {
  const tables = new Map<string, FakeRecord[]>()
  function tableFor(entityClass: { name: string }): FakeRecord[] {
    const key = entityClass.name
    if (!tables.has(key)) tables.set(key, [])
    return tables.get(key)!
  }
  return {
    seed: (entityClass: { name: string }, record: FakeRecord) => {
      tableFor(entityClass).push(record)
      return record
    },
    findOne: jest.fn(async (entityClass: { name: string }, where: FakeRecord) => {
      return tableFor(entityClass).find((record) => matchesWhere(record, where)) ?? null
    }),
    find: jest.fn(async (entityClass: { name: string }, where: FakeRecord) => {
      return tableFor(entityClass).filter((record) => matchesWhere(record, where))
    }),
  }
}

type FakeEm = ReturnType<typeof buildFakeEm>

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const SCOPE = { organizationId: ORG, tenantId: TENANT }

const SOURCE_ACCOUNT_ID = 'acc-source-4xx'
const OTHER_ACCOUNT_ID = 'acc-other-2xx'
const TARGET_ACCOUNT_ID = 'acc-target-5xx'
const CLEARING_ACCOUNT_ID = 'acc-clearing-490'
const UNALLOCATED_TARGET_ACCOUNT_ID = 'acc-unallocated-target'
const SENTINEL_COST_CENTER_ID = 'cc-sentinel'
const RULE_DEFAULT_COST_CENTER_ID = 'cc-rule-default'
const EXPLICIT_COST_CENTER_ID = 'cc-explicit'

const translate = (_key: string, fallback?: string) => fallback ?? _key

function seedZespol4Account(em: FakeEm, accountId: string) {
  em.seed(LedgerAccount, { id: accountId, organizationId: ORG, tenantId: TENANT, accountTypeId: 'type-4' })
  em.seed(LedgerAccountType, {
    id: 'type-4',
    organizationId: ORG,
    tenantId: TENANT,
    accountGroupId: 'group-4',
    normalBalance: 'DEBIT',
  })
  em.seed(LedgerAccountGroup, { id: 'group-4', organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '4' })
}

function seedNonZespol4Account(em: FakeEm, accountId: string) {
  em.seed(LedgerAccount, { id: accountId, organizationId: ORG, tenantId: TENANT, accountTypeId: 'type-2' })
  em.seed(LedgerAccountType, {
    id: 'type-2',
    organizationId: ORG,
    tenantId: TENANT,
    accountGroupId: 'group-2',
    normalBalance: 'DEBIT',
  })
  em.seed(LedgerAccountGroup, { id: 'group-2', organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '2' })
}

function seedSentinelCostCenter(em: FakeEm) {
  em.seed(CostCenter, {
    id: SENTINEL_COST_CENTER_ID,
    organizationId: ORG,
    tenantId: TENANT,
    code: UNALLOCATED_COST_CENTER_CODE,
    name: 'Unallocated',
    isActive: true,
    deletedAt: null,
  })
}

function seedSettings(em: FakeEm, overrides: Partial<FakeRecord> = {}) {
  em.seed(PostingRulesSettings, {
    id: 'settings-1',
    organizationId: ORG,
    tenantId: TENANT,
    clearingAccountId: CLEARING_ACCOUNT_ID,
    unallocatedCostAccountId: null,
    ...overrides,
  })
}

function buildCandidate(overrides: Partial<ReclassifyCandidate['entry']> = {}, lineOverrides: Partial<ReclassifyCandidate['line']> = {}): ReclassifyCandidate {
  return {
    entry: {
      id: 'entry-1',
      operationDate: '2026-09-01',
      currencyId: 'PLN',
      type: 'NORMAL',
      referenceType: null,
      referenceId: null,
      ...overrides,
    },
    line: {
      id: 'line-1',
      accountId: SOURCE_ACCOUNT_ID,
      debit: '100.00',
      credit: '0',
      ...lineOverrides,
    },
  }
}

/**
 * A fake `commandBus` whose `execute` echoes `ledger.postJournalEntry`'s
 * real two-line result shape (see `postJournalEntry.ts`'s own
 * `PostJournalEntryResult`) and records every
 * `journal_entry_line_dimension.setJournalEntryLineDimension` call so a
 * test can assert exactly which cost centre id got tagged — the MPK
 * priority hybrid's whole observable effect from this helper's point of
 * view. Both commands are wrapped in `{ result, logEntry }`
 * (`CommandExecuteResult<T>`), matching the real `CommandBus.execute`
 * contract (`packages/shared/src/lib/commands/command-bus.ts`).
 */
function buildFakeCommandBus() {
  let nextEntryId = 1
  const setDimensionCalls: Array<{ journalEntryLineId: string; dimensionIds: string[] }> = []
  const execute = jest.fn(async (commandId: string, options: { input: FakeRecord }) => {
    if (commandId === 'ledger.postJournalEntry') {
      const input = options.input as { lines: Array<{ accountId: string; debit?: string; credit?: string }> }
      const journalEntryId = `je-${nextEntryId++}`
      return {
        result: {
          journalEntryId,
          sequenceNumber: nextEntryId,
          lines: input.lines.map((line, index) => ({
            id: `${journalEntryId}-line-${index}`,
            accountId: line.accountId,
            debit: line.debit ?? '0',
            credit: line.credit ?? '0',
          })),
        },
        logEntry: null,
      }
    }
    if (commandId === 'journal_entry_line_dimension.setJournalEntryLineDimension') {
      const input = options.input as { journalEntryLineId: string; dimensionIds: string[] }
      setDimensionCalls.push({ journalEntryLineId: input.journalEntryLineId, dimensionIds: input.dimensionIds })
      return { result: undefined, logEntry: null }
    }
    throw new Error(`buildFakeCommandBus: unhandled command — ${commandId}`)
  })
  return { execute, setDimensionCalls }
}

function buildDeps(em: FakeEm, commandBus: ReturnType<typeof buildFakeCommandBus>): ReclassifyDeps {
  const container = { resolve: jest.fn((token: string) => (token === 'commandBus' ? commandBus : undefined)) }
  return { container: container as any, em: em as any, scope: SCOPE, translate }
}

describe('reclassifyLine — Invariant 3 (ignore own output)', () => {
  it('is a no-op for a line whose entry already carries the engine marker', async () => {
    const em = buildFakeEm()
    const commandBus = buildFakeCommandBus()
    const candidate = buildCandidate({ referenceType: RECLASSIFICATION_REFERENCE_TYPE })

    const result = await reclassifyLine(buildDeps(em, commandBus), candidate)

    expect(result).toEqual({ reclassified: false, reason: 'already_engine_output' })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})

describe('reclassifyLine — zespół-4 detection', () => {
  it('is a no-op for a line on a non-zespół-4 account', async () => {
    const em = buildFakeEm()
    seedNonZespol4Account(em, OTHER_ACCOUNT_ID)
    const commandBus = buildFakeCommandBus()
    const candidate = buildCandidate({}, { accountId: OTHER_ACCOUNT_ID })

    const result = await reclassifyLine(buildDeps(em, commandBus), candidate)

    expect(result).toEqual({ reclassified: false, reason: 'not_zespol_4' })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})

describe('reclassifyLine — rejections', () => {
  it('rejects with 422 when PostingRulesSettings.clearingAccountId is not configured', async () => {
    const em = buildFakeEm()
    seedZespol4Account(em, SOURCE_ACCOUNT_ID)
    seedSettings(em, { clearingAccountId: null })
    const commandBus = buildFakeCommandBus()

    await expect(reclassifyLine(buildDeps(em, commandBus), buildCandidate())).rejects.toMatchObject({ status: 422 })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('rejects with 422 when no rule matches and no unallocated-cost account is configured', async () => {
    const em = buildFakeEm()
    seedZespol4Account(em, SOURCE_ACCOUNT_ID)
    seedSettings(em) // clearingAccountId set, unallocatedCostAccountId left null, no DefaultAccountPostingRule seeded
    const commandBus = buildFakeCommandBus()

    await expect(reclassifyLine(buildDeps(em, commandBus), buildCandidate())).rejects.toMatchObject({ status: 422 })
  })
})

describe('reclassifyLine — MPK (cost centre) priority hybrid', () => {
  function seedRuleWithDefault(em: FakeEm) {
    em.seed(DefaultAccountPostingRule, {
      id: 'rule-1',
      organizationId: ORG,
      tenantId: TENANT,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      targetAccountId: TARGET_ACCOUNT_ID,
      defaultCostCenterId: RULE_DEFAULT_COST_CENTER_ID,
    })
  }

  it('path 1 — an explicit journal_entry_line_dimension tag outranks the rule default', async () => {
    const em = buildFakeEm()
    seedZespol4Account(em, SOURCE_ACCOUNT_ID)
    seedSettings(em)
    seedRuleWithDefault(em)
    seedSentinelCostCenter(em)
    em.seed(JournalEntryLineDimension, {
      id: 'jeld-1',
      organizationId: ORG,
      tenantId: TENANT,
      journalEntryLineId: 'line-1',
      dimensionType: 'CostCenter',
      dimensionId: EXPLICIT_COST_CENTER_ID,
    })
    const commandBus = buildFakeCommandBus()

    const result = await reclassifyLine(buildDeps(em, commandBus), buildCandidate())

    expect(result.reclassified).toBe(true)
    expect(commandBus.setDimensionCalls).toEqual([
      expect.objectContaining({ dimensionIds: [EXPLICIT_COST_CENTER_ID] }),
    ])
  })

  it('path 2 — falls back to the rule\'s own default cost centre when no explicit tag exists', async () => {
    const em = buildFakeEm()
    seedZespol4Account(em, SOURCE_ACCOUNT_ID)
    seedSettings(em)
    seedRuleWithDefault(em)
    seedSentinelCostCenter(em)
    const commandBus = buildFakeCommandBus()

    const result = await reclassifyLine(buildDeps(em, commandBus), buildCandidate())

    expect(result.reclassified).toBe(true)
    expect(commandBus.setDimensionCalls).toEqual([
      expect.objectContaining({ dimensionIds: [RULE_DEFAULT_COST_CENTER_ID] }),
    ])
  })

  it('path 3 — falls back to the seeded sentinel when neither an explicit tag nor a rule default exists', async () => {
    const em = buildFakeEm()
    seedZespol4Account(em, SOURCE_ACCOUNT_ID)
    seedSettings(em)
    seedSentinelCostCenter(em)
    em.seed(DefaultAccountPostingRule, {
      id: 'rule-1',
      organizationId: ORG,
      tenantId: TENANT,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      targetAccountId: TARGET_ACCOUNT_ID,
      defaultCostCenterId: null,
    })
    const commandBus = buildFakeCommandBus()

    const result = await reclassifyLine(buildDeps(em, commandBus), buildCandidate())

    expect(result.reclassified).toBe(true)
    expect(commandBus.setDimensionCalls).toEqual([
      expect.objectContaining({ dimensionIds: [SENTINEL_COST_CENTER_ID] }),
    ])
  })

  it('resolves the target account from PostingRulesSettings.unallocatedCostAccountId when no rule matches', async () => {
    const em = buildFakeEm()
    seedZespol4Account(em, SOURCE_ACCOUNT_ID)
    seedSettings(em, { unallocatedCostAccountId: UNALLOCATED_TARGET_ACCOUNT_ID })
    seedSentinelCostCenter(em)
    const commandBus = buildFakeCommandBus()

    const result = await reclassifyLine(buildDeps(em, commandBus), buildCandidate())

    expect(result.reclassified).toBe(true)
    // The post's debit line targets the settings-level fallback account,
    // not a per-rule one, since no `DefaultAccountPostingRule` was seeded.
    const postCall = commandBus.execute.mock.calls.find(([commandId]) => commandId === 'ledger.postJournalEntry')
    expect(postCall?.[1].input.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: UNALLOCATED_TARGET_ACCOUNT_ID, debit: '100.00' })]),
    )
    expect(commandBus.setDimensionCalls).toEqual([
      expect.objectContaining({ dimensionIds: [SENTINEL_COST_CENTER_ID] }),
    ])
  })
})
