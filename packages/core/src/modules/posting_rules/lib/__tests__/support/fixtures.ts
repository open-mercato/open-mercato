// Shared fixtures for the posting_rules unit tests: a small in-memory fake
// `EntityManager` (equality plus the handful of operators the engine and the
// finder use: `$in`, `$ne`, `$gte`, `$lte`, `$or`), a fake `commandBus` that
// persists what `ledger.postJournalEntry` would, and seed helpers.
//
// The fake `em` deliberately mimics the two things the engine relies on for
// idempotency: `fork().transactional(cb)` hands the callback a *distinct*
// transaction object (so a test can tell the transaction from the root em),
// and `execute(sql, params)` is the advisory-lock call. Both write to
// `em.log`, together with the fake command bus ('post', 'tag') and the
// `emitLedgerEvent` mock the tests install ('emit'), so a test can assert the
// order lock -> post -> commit -> emit -> tag.
export {}

import {
  JournalEntry,
  JournalEntryLine,
  LedgerAccount,
  LedgerAccountGroup,
  LedgerAccountType,
} from '../../../../ledger/data/entities'
import { JournalEntryLineDimension } from '../../../../journal_entry_line_dimension/data/entities'
import { CostCenter, DefaultAccountPostingRule, PostingRulesSettings } from '../../../data/entities'
import { UNALLOCATED_COST_CENTER_CODE } from '../../seedDefaults'
import { RECLASSIFICATION_REFERENCE_TYPE, type ReclassifyCandidate, type ReclassifyDeps } from '../../reclassify'

export type FakeRecord = Record<string, unknown>

function toTime(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(value as string).getTime()
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true
  if (condition === null) return value === null || value === undefined
  if (condition instanceof Date) return toTime(value) === toTime(condition)
  if (typeof condition === 'object') {
    const c = condition as Record<string, unknown>
    let ok = true
    if ('$in' in c) ok = ok && (c.$in as unknown[]).includes(value)
    if ('$ne' in c) ok = ok && value !== c.$ne
    if ('$gte' in c) ok = ok && toTime(value) >= toTime(c.$gte)
    if ('$lte' in c) ok = ok && toTime(value) <= toTime(c.$lte)
    return ok
  }
  return value === condition
}

export function matchesWhere(record: FakeRecord, where: FakeRecord): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$or') return (condition as FakeRecord[]).some((alternative) => matchesWhere(record, alternative))
    return matchesCondition(record[key], condition)
  })
}

export function buildFakeEm() {
  const tables = new Map<string, FakeRecord[]>()
  const log: string[] = []
  function tableFor(entityClass: { name: string }): FakeRecord[] {
    if (!tables.has(entityClass.name)) tables.set(entityClass.name, [])
    return tables.get(entityClass.name)!
  }
  const em: any = {
    log,
    lastTransaction: null as unknown,
    seed: (entityClass: { name: string }, record: FakeRecord) => {
      tableFor(entityClass).push(record)
      return record
    },
    rows: (entityClass: { name: string }) => tableFor(entityClass),
    findOne: jest.fn(async (entityClass: { name: string }, where: FakeRecord) => {
      return tableFor(entityClass).find((record) => matchesWhere(record, where)) ?? null
    }),
    find: jest.fn(async (entityClass: { name: string }, where: FakeRecord) => {
      return tableFor(entityClass).filter((record) => matchesWhere(record, where))
    }),
    execute: jest.fn(async (_sql: string, params: unknown[] = []) => {
      log.push(`lock:${String(params[0])}`)
      return []
    }),
    fork: jest.fn(() => em),
    transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => {
      // A distinct object that reads through to the same tables.
      const transaction = Object.create(em)
      em.lastTransaction = transaction
      const result = await callback(transaction)
      log.push('commit')
      return result
    }),
  }
  return em as {
    log: string[]
    lastTransaction: unknown
    seed: (entityClass: { name: string }, record: FakeRecord) => FakeRecord
    rows: (entityClass: { name: string }) => FakeRecord[]
    findOne: jest.Mock
    find: jest.Mock
    execute: jest.Mock
    fork: jest.Mock
    transactional: jest.Mock
  }
}

export type FakeEm = ReturnType<typeof buildFakeEm>

export const ORG = '11111111-1111-4111-8111-111111111111'
export const TENANT = '22222222-2222-4222-8222-222222222222'
export const SCOPE = { organizationId: ORG, tenantId: TENANT }

export const SOURCE_ACCOUNT_ID = 'acc-source-4xx'
export const SECOND_SOURCE_ACCOUNT_ID = 'acc-source-4xx-b'
export const OTHER_ACCOUNT_ID = 'acc-other-2xx'
export const TARGET_ACCOUNT_ID = 'acc-target-5xx'
export const SECOND_TARGET_ACCOUNT_ID = 'acc-target-5xx-b'
export const CLEARING_ACCOUNT_ID = 'acc-clearing-490'
export const UNALLOCATED_TARGET_ACCOUNT_ID = 'acc-unallocated-target'
export const SENTINEL_COST_CENTER_ID = 'cc-sentinel'
export const RULE_DEFAULT_COST_CENTER_ID = 'cc-rule-default'
export const EXPLICIT_COST_CENTER_ID = 'cc-explicit'

export const translate = (key: string, fallback?: string) => fallback ?? key

export function seedZespol4Account(em: FakeEm, accountId: string) {
  em.seed(LedgerAccount, { id: accountId, organizationId: ORG, tenantId: TENANT, accountTypeId: 'type-4' })
  if (!em.rows(LedgerAccountType).some((row) => row.id === 'type-4')) {
    em.seed(LedgerAccountType, {
      id: 'type-4',
      organizationId: ORG,
      tenantId: TENANT,
      accountGroupId: 'group-4',
      normalBalance: 'DEBIT',
    })
    em.seed(LedgerAccountGroup, { id: 'group-4', organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '4' })
  }
}

export function seedNonZespol4Account(em: FakeEm, accountId: string) {
  em.seed(LedgerAccount, { id: accountId, organizationId: ORG, tenantId: TENANT, accountTypeId: 'type-2' })
  if (!em.rows(LedgerAccountType).some((row) => row.id === 'type-2')) {
    em.seed(LedgerAccountType, {
      id: 'type-2',
      organizationId: ORG,
      tenantId: TENANT,
      accountGroupId: 'group-2',
      normalBalance: 'DEBIT',
    })
    em.seed(LedgerAccountGroup, { id: 'group-2', organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '2' })
  }
}

export function seedCostCenter(em: FakeEm, id: string, overrides: FakeRecord = {}) {
  return em.seed(CostCenter, {
    id,
    organizationId: ORG,
    tenantId: TENANT,
    code: id,
    name: id,
    isActive: true,
    deletedAt: null,
    ...overrides,
  })
}

export function seedSentinelCostCenter(em: FakeEm) {
  seedCostCenter(em, SENTINEL_COST_CENTER_ID, { code: UNALLOCATED_COST_CENTER_CODE, name: 'Unallocated' })
}

export function seedSettings(em: FakeEm, overrides: FakeRecord = {}) {
  em.seed(PostingRulesSettings, {
    id: 'settings-1',
    organizationId: ORG,
    tenantId: TENANT,
    clearingAccountId: CLEARING_ACCOUNT_ID,
    unallocatedCostAccountId: null,
    ...overrides,
  })
}

export function seedRule(em: FakeEm, overrides: FakeRecord = {}) {
  em.seed(DefaultAccountPostingRule, {
    id: 'rule-1',
    organizationId: ORG,
    tenantId: TENANT,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    targetAccountId: TARGET_ACCOUNT_ID,
    defaultCostCenterId: RULE_DEFAULT_COST_CENTER_ID,
    ...overrides,
  })
}

export function seedEntry(
  em: FakeEm,
  entryId: string,
  lines: Array<{ id: string; accountId: string; debit?: string; credit?: string; amountCurrency?: string }>,
  overrides: FakeRecord = {},
) {
  em.seed(JournalEntry, {
    id: entryId,
    organizationId: ORG,
    tenantId: TENANT,
    type: 'NORMAL',
    operationDate: '2026-09-01',
    currencyId: 'PLN',
    exchangeRate: null,
    referenceType: null,
    referenceId: null,
    ...overrides,
  })
  for (const line of lines) {
    em.seed(JournalEntryLine, {
      journalEntryId: entryId,
      organizationId: ORG,
      tenantId: TENANT,
      debit: '0',
      credit: '0',
      amountCurrency: '0',
      ...line,
    })
  }
}

/** An existing engine reclassification keyed on `sourceLineId`: a debit line
 * on `targetAccountId`, a credit line on the clearing account, and (unless
 * `taggedCostCenterId` is `null`) a CostCenter tag on the target line. */
export function seedReclassification(
  em: FakeEm,
  sourceLineId: string,
  options: { targetAccountId?: string; taggedCostCenterId?: string | null; amount?: string } = {},
) {
  const entryId = `reclass-of-${sourceLineId}`
  const amount = options.amount ?? '100.00'
  seedEntry(
    em,
    entryId,
    [
      { id: `${entryId}-target`, accountId: options.targetAccountId ?? TARGET_ACCOUNT_ID, debit: amount },
      { id: `${entryId}-clearing`, accountId: CLEARING_ACCOUNT_ID, credit: amount },
    ],
    { referenceType: RECLASSIFICATION_REFERENCE_TYPE, referenceId: sourceLineId },
  )
  if (options.taggedCostCenterId !== null) {
    em.seed(JournalEntryLineDimension, {
      id: `jeld-${entryId}`,
      organizationId: ORG,
      tenantId: TENANT,
      journalEntryLineId: `${entryId}-target`,
      dimensionType: 'CostCenter',
      dimensionId: options.taggedCostCenterId ?? EXPLICIT_COST_CENTER_ID,
    })
  }
  return { entryId, targetLineId: `${entryId}-target` }
}

export function buildCandidate(
  entryOverrides: Partial<ReclassifyCandidate['entry']> = {},
  lineOverrides: Partial<ReclassifyCandidate['line']> = {},
): ReclassifyCandidate {
  return {
    entry: {
      id: 'entry-1',
      operationDate: '2026-09-01',
      currencyId: 'PLN',
      type: 'NORMAL',
      referenceType: null,
      referenceId: null,
      ...entryOverrides,
    },
    line: { id: 'line-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00', credit: '0', ...lineOverrides },
  }
}

export type PostCall = { input: any; ctx: any }
export type TagCall = { journalEntryLineId: string; dimensionIds: string[]; ctx: any }

/**
 * A fake `commandBus` echoing the real two-line result shape of
 * `ledger.postJournalEntry` (wrapped in `{ result, logEntry }` like
 * `CommandBus.execute`) and persisting the entry and its lines into the fake
 * em — so a second pass sees the marker, as the real database would.
 * `setJournalEntryLineDimension` persists the tag. `failNext` makes the next
 * call of a command throw once.
 */
export function buildFakeCommandBus(em: FakeEm) {
  let nextEntryId = 1
  const postCalls: PostCall[] = []
  const tagCalls: TagCall[] = []
  const failures = new Map<string, unknown>()

  const execute = jest.fn(async (commandId: string, options: { input: any; ctx: any }) => {
    const pending = failures.get(commandId)
    if (pending) {
      failures.delete(commandId)
      throw pending
    }
    if (commandId === 'ledger.postJournalEntry') {
      em.log.push('post')
      postCalls.push({ input: options.input, ctx: options.ctx })
      const journalEntryId = `je-${nextEntryId++}`
      const lines = (options.input.lines as Array<{ accountId: string; debit?: string; credit?: string }>).map((line, index) => ({
        id: `${journalEntryId}-line-${index}`,
        accountId: line.accountId,
        debit: line.debit ?? '0',
        credit: line.credit ?? '0',
      }))
      seedEntry(em, journalEntryId, lines, {
        referenceType: options.input.referenceType,
        referenceId: options.input.referenceId,
      })
      return { result: { journalEntryId, sequenceNumber: nextEntryId, lines }, logEntry: null }
    }
    if (commandId === 'journal_entry_line_dimension.setJournalEntryLineDimension') {
      em.log.push('tag')
      const input = options.input as { journalEntryLineId: string; dimensionIds: string[] }
      tagCalls.push({ journalEntryLineId: input.journalEntryLineId, dimensionIds: input.dimensionIds, ctx: options.ctx })
      em.seed(JournalEntryLineDimension, {
        id: `jeld-${tagCalls.length}`,
        organizationId: ORG,
        tenantId: TENANT,
        journalEntryLineId: input.journalEntryLineId,
        dimensionType: 'CostCenter',
        dimensionId: input.dimensionIds[0],
      })
      return { result: undefined, logEntry: null }
    }
    throw new Error(`buildFakeCommandBus: unhandled command — ${commandId}`)
  })
  return {
    execute,
    postCalls,
    tagCalls,
    failNext: (commandId: string, error: unknown) => failures.set(commandId, error),
  }
}

export type FakeCommandBus = ReturnType<typeof buildFakeCommandBus>

export function buildContainer(em: FakeEm, bus: FakeCommandBus) {
  return {
    resolve: jest.fn((token: string) => {
      if (token === 'commandBus') return bus
      if (token === 'em') return em
      return undefined
    }),
  }
}

export function buildDeps(em: FakeEm, bus: FakeCommandBus): ReclassifyDeps {
  return { container: buildContainer(em, bus) as any, em: em as any, scope: SCOPE, translate }
}
