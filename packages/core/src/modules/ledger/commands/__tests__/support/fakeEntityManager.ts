// Shared fake `EntityManager` for OM-13's ledger command unit tests
// (postJournalEntry / reverseJournalEntry / fiscalPeriods). Modeled on
// `currencies/commands/__tests__/scope.test.ts` and
// `currencies.atomicity.test.ts`'s own hand-rolled `buildEm()` helpers —
// same intent (`jest.fn()`-wrapped in-memory persistence so a real command
// handler can be exercised end to end) — factored into one shared file
// here because three command files under test need overlapping behavior
// (`findOne`/`create`/`persist`/`flush`/`fork`/`transactional`, plus the
// one raw-SQL call `postJournalEntry.ts` makes for
// `journal_entry_sequence`), where the currencies tests each only needed
// their own single command file's narrower surface.
export {}

type FakeRecord = Record<string, unknown>
type WhereCondition = Record<string, unknown>

function toTime(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(value as string).getTime()
}

function matchesWhere(record: FakeRecord, where: WhereCondition): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true
    const value = record[key]
    if (condition === null) return value === null || value === undefined
    if (condition instanceof Date) return toTime(value) === toTime(condition)
    if (typeof condition === 'object') {
      const c = condition as Record<string, unknown>
      if ('$in' in c) return (c.$in as unknown[]).includes(value)
      if ('$ne' in c) return value !== c.$ne
      let ok = true
      if ('$lte' in c) ok = ok && toTime(value) <= toTime(c.$lte)
      if ('$gte' in c) ok = ok && toTime(value) >= toTime(c.$gte)
      if ('$lt' in c) ok = ok && toTime(value) < toTime(c.$lt)
      if ('$gt' in c) ok = ok && toTime(value) > toTime(c.$gt)
      return ok
    }
    return value === condition
  })
}

export type FakeEm = {
  tables: Map<string, FakeRecord[]>
  seed: (entityClass: { name: string }, record: FakeRecord) => FakeRecord
  seedSequenceCounter: (scope: { organizationId: string; tenantId: string }, nextValue: number) => void
  findOne: jest.Mock
  find: jest.Mock
  count: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  begin: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
  fork: jest.Mock
  transactional: jest.Mock
  getConnection: jest.Mock
  execute: jest.Mock
}

/**
 * `flushBehavior` lets a test make the NEXT `flush()` call throw a
 * given error (once), then behave normally again — used to test
 * `postJournalEntry.ts`'s `isBalanceTriggerViolation()` translation of the
 * deferred `journal_entry_line_balanced` constraint trigger's commit-time
 * Postgres exception.
 */
export function buildFakeEm(opts: { throwOnNextFlush?: unknown } = {}): FakeEm {
  const tables = new Map<string, FakeRecord[]>()
  const sequenceCounters = new Map<string, number>()
  let pendingFlushError = opts.throwOnNextFlush

  function tableFor(entityClass: { name: string }): FakeRecord[] {
    const key = entityClass.name
    if (!tables.has(key)) tables.set(key, [])
    return tables.get(key)!
  }

  const connectionExecute = jest.fn(async (sql: string, params: unknown[]) => {
    if (!sql.includes('journal_entry_sequence')) {
      throw new Error(`buildFakeEm: unhandled raw SQL — ${sql}`)
    }
    const [organizationId, tenantId] = params as [string, string]
    const key = `${organizationId}:${tenantId}`
    const current = sequenceCounters.get(key) ?? 1
    sequenceCounters.set(key, current + 1)
    return [{ next_value: String(current) }]
  })

  const em: FakeEm = {
    tables,
    seed: (entityClass, record) => {
      tableFor(entityClass).push(record)
      return record
    },
    seedSequenceCounter: (scope, nextValue) => {
      sequenceCounters.set(`${scope.organizationId}:${scope.tenantId}`, nextValue)
    },
    findOne: jest.fn(async (entityClass: { name: string }, where: WhereCondition) => {
      return tableFor(entityClass).find((record) => matchesWhere(record, where)) ?? null
    }),
    find: jest.fn(async (entityClass: { name: string }, where: WhereCondition) => {
      return tableFor(entityClass).filter((record) => matchesWhere(record, where))
    }),
    count: jest.fn(async (entityClass: { name: string }, where: WhereCondition) => {
      return tableFor(entityClass).filter((record) => matchesWhere(record, where)).length
    }),
    create: jest.fn((entityClass: { name: string }, payload: FakeRecord) => {
      const record = { ...payload }
      tableFor(entityClass).push(record)
      return record
    }),
    persist: jest.fn(() => undefined),
    flush: jest.fn(async () => {
      if (pendingFlushError) {
        const err = pendingFlushError
        pendingFlushError = undefined
        throw err
      }
    }),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    fork: jest.fn(() => em),
    // `postJournalEntry.ts`'s `withPostingTransaction` calls
    // `rootEm.transactional(cb)` when the caller (a route handler, in
    // production) did not already supply `ctx.transactionalEm`. Stubbed as
    // a direct passthrough on the same fake `em` — enough to exercise the
    // real branching logic in `withPostingTransaction` without needing a
    // real MikroORM transaction.
    transactional: jest.fn(async (cb: (trx: FakeEm) => unknown) => cb(em)),
    // A single shared `execute` mock across every `getConnection()` call —
    // NOT a fresh one per call — so a test can inspect
    // `connectionExecute.mock.calls` and see every raw-SQL call made
    // across N concurrent `postJournalEntry` invocations, not just the
    // first one's.
    getConnection: jest.fn(() => ({ execute: connectionExecute })),
    // `postJournalEntry.ts`'s `claimNextSequenceNumber` calls
    // `em.execute(...)` directly (PR #6340 review's M2 fix — joins the
    // active transaction, which `em.getConnection().execute(...)` does
    // not). Same underlying mock as `getConnection().execute` above, so
    // a test can assert on whichever call path the code under test
    // actually takes.
    execute: connectionExecute,
  }
  return em
}

export function buildFakeCtx(em: FakeEm, opts: { organizationId: string; tenantId: string; request?: Request | null }) {
  const dataEngine = { markOrmEntityChange: jest.fn(), emitEvent: jest.fn() }
  return {
    ctx: {
      container: {
        resolve: jest.fn((token: string) => {
          if (token === 'em') return em
          if (token === 'dataEngine') return dataEngine
          return undefined
        }),
      },
      auth: { sub: 'user-1', tenantId: opts.tenantId, orgId: opts.organizationId, isSuperAdmin: false },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      request: opts.request ?? null,
    },
    dataEngine,
  }
}

/** Builds a `Request` carrying the optimistic-lock expected-updated-at header. */
export function requestWithExpectedUpdatedAt(expected: string): Request {
  return new Request('https://example.invalid/', {
    headers: { 'x-om-ext-optimistic-lock-expected-updated-at': expected },
  })
}
