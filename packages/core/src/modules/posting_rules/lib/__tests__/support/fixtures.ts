// Shared fixtures for the posting_rules unit tests: a small in-memory fake
// `EntityManager` (equality plus `$in`, `$ne`, `$gte`, `$lte`, `$or`) and seed
// helpers for the configuration commands. The engine's fixtures (fake command
// bus, journal entry and reclassification seeds) ship with the engine (PR-B).
export {}

import { LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../../../ledger/data/entities'
import { CostCenter, DefaultAccountPostingRule, PostingRulesSettings } from '../../../data/entities'
import { UNALLOCATED_COST_CENTER_CODE } from '../../seedDefaults'

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
