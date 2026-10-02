// Support helpers shared by every `ledger` BDD step-definition file
// See `../README.md` for why this exists and what it does and
// does not verify.
//
// `FakeEntityManager` is a minimal, hand-written stand-in for MikroORM's
// `EntityManager`, covering only the calls the ledger commands under test
// actually make: `find` / `findOne` / `count` / `create` / `persist` /
// `flush` / `fork` / `begin` / `commit` / `rollback`, plus the one raw-SQL
// escape hatch `commands/postJournalEntry.ts`'s `claimNextSequenceNumber`
// uses for the `journal_entry_sequences` table. It is modeled directly on
// `currencies/commands/__tests__/scope.test.ts`'s own `buildEm()` helper —
// same shape, same intent (exercise the real command against a fake
// persistence layer) — but written as plain closures over a `Map` instead
// of `jest.fn()` mocks, since Cucumber has no bundled mocking library.
import { randomUUID } from 'crypto'
import { Before } from '@cucumber/cucumber'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands'

export type FakeRecord = Record<string, unknown>
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

/**
 * Fixed identifiers reused across every scenario, matching the style
 * `scope.test.ts` uses for its own `ACTOR_ORG`/`ACTOR_TENANT` constants —
 * readable, stable UUIDs rather than freshly randomized ones per run, so a
 * failing scenario's assertion output is easy to eyeball.
 */
export const ORG_ID = '11111111-1111-4111-8111-111111111111'
export const TENANT_ID = '22222222-2222-4222-8222-222222222222'

export class FakeEntityManager {
  private tables = new Map<string, FakeRecord[]>()
  private sequenceCounters = new Map<string, number>()

  private tableFor(entityClass: { name: string }): FakeRecord[] {
    const key = entityClass.name
    if (!this.tables.has(key)) this.tables.set(key, [])
    return this.tables.get(key)!
  }

  /** Test setup only — seeds a row directly, bypassing `create`/`persist`. */
  seed(entityClass: { name: string }, record: FakeRecord): FakeRecord {
    this.tableFor(entityClass).push(record)
    return record
  }

  /**
   * Test setup only — pre-sets `journal_entry_sequences.next_value` for a
   * scope, so a scenario that seeds an already-"posted" original entry
   * (e.g. for a reversal scenario) doesn't collide with the sequence
   * number a real `postJournalEntry` call allocates next.
   */
  seedSequenceCounter(scope: { organizationId: string; tenantId: string }, nextValue: number): void {
    this.sequenceCounters.set(`${scope.organizationId}:${scope.tenantId}`, nextValue)
  }

  async find(entityClass: { name: string }, where: WhereCondition): Promise<FakeRecord[]> {
    return this.tableFor(entityClass).filter((record) => matchesWhere(record, where))
  }

  async findOne(entityClass: { name: string }, where: WhereCondition): Promise<FakeRecord | null> {
    return this.tableFor(entityClass).find((record) => matchesWhere(record, where)) ?? null
  }

  async count(entityClass: { name: string }, where: WhereCondition): Promise<number> {
    return this.tableFor(entityClass).filter((record) => matchesWhere(record, where)).length
  }

  create(entityClass: { name: string }, payload: FakeRecord): FakeRecord {
    const record = { ...payload }
    this.tableFor(entityClass).push(record)
    return record
  }

  // MikroORM's `persist` only stages a change for the next flush; `create`
  // above already inserts the row into its table, so there is nothing
  // further to stage here — this exists purely so command code that calls
  // `em.persist(x)` (every command in this module does) has something to
  // call.
  persist(_record: FakeRecord): void {}

  async flush(): Promise<void> {}
  async begin(): Promise<void> {}
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}

  // PR #6340 review, n2: `deleteLedgerAccount` now wraps its lock+check+write
  // in `em.transactional(cb)` (mirroring `toggleFiscalPeriodLock`'s own
  // shape), and this fake previously had no such method at all — calling it
  // threw a raw `TypeError`, which propagated as a rejection but without the
  // `CrudHttpError` shape (`.status`) the `delete_blocking.feature` scenario
  // asserts on. This fake has no real transaction semantics to begin with
  // (every table mutation already lands immediately, see `persist`'s own
  // doc comment), so — matching the equivalent stub in the Jest unit
  // suite's own fake EntityManager (`__tests__/support/fakeEntityManager.ts`)
  // — this just runs the callback against the same fake instance and
  // propagates whatever it throws or returns.
  async transactional<T>(cb: (trx: FakeEntityManager) => Promise<T> | T): Promise<T> {
    return cb(this)
  }

  fork(): FakeEntityManager {
    return this
  }

  /**
   * `claimNextSequenceNumber` (postJournalEntry.ts) calls `em.execute(...)`
   * directly — never `em.getConnection().execute(...)` — specifically so
   * the statement joins the caller's transaction context (PR #6340 review
   * M2). This fake mirrors that exact call shape; `getConnection().execute`
   * below is kept only because it was the original (pre-M2) call site and
   * nothing has needed it removed.
   */
  async execute<T = unknown>(sql: string, params: unknown[]): Promise<T> {
    return this.rawExecute(sql, params) as Promise<T>
  }

  private async rawExecute(sql: string, params: unknown[]): Promise<{ next_value: string }[]> {
    // `SET CONSTRAINTS ... IMMEDIATE` (postJournalEntry.ts, PR #6340 review
    // m5) forces Postgres's deferred balance-check trigger to run before
    // commit — this fake has no triggers at all, so it's a safe no-op here.
    if (sql.toLowerCase().includes('set constraints')) return []
    if (!sql.includes('journal_entry_sequence')) {
      throw new Error(`FakeEntityManager.execute(): unhandled raw SQL — ${sql}`)
    }
    const [organizationId, tenantId] = params as [string, string]
    const key = `${organizationId}:${tenantId}`
    const current = this.sequenceCounters.get(key) ?? 1
    this.sequenceCounters.set(key, current + 1)
    return [{ next_value: String(current) }]
  }

  getConnection() {
    return { execute: (sql: string, params: unknown[]) => this.rawExecute(sql, params) }
  }
}

// Test setup only — lets a step definition shared across feature files
// (e.g. "a fiscal period from {string} to {string} that is open", reused
// by both `fiscal_period_locking.feature` and
// `journal_entry_reversal.feature`) find whichever `FakeEntityManager` the
// running scenario's own first Given already created, regardless of which
// step-definition FILE that Given lives in — each file still keeps its own
// local `em` variable for its own subsequent steps, but that variable and
// the "active" one below are the same object, because every Given that
// creates a fresh em registers it here in the same call.
let activeEm: FakeEntityManager | null = null

export function setActiveEm(em: FakeEntityManager): FakeEntityManager {
  activeEm = em
  return em
}

/**
 * Returns the scenario's active `FakeEntityManager`, creating and
 * registering a fresh one if no earlier Given has set one up yet. This
 * lets one step definition work both as a scenario's first/only fixture
 * step (nothing active yet — starts a new fake store) and as a later step
 * layered onto an em an earlier Given in a different file already created
 * (something is already active — seeds into that one instead).
 */
export function activeEmOrNew(): FakeEntityManager {
  if (!activeEm) activeEm = new FakeEntityManager()
  return activeEm
}

// Same cross-file-sharing need as `activeEm` above, but for a single
// fixture id rather than the whole fake store: `delete_blocking.steps.ts`
// defines "a ledger account has a posted entry" once (Cucumber matches
// step text globally, so it isn't redefined in
// `account_type_immutability.steps.ts`, which also uses this exact
// Given for its own reclassification scenario) and needs to hand the
// seeded account's id to whichever file's When step runs next.
let activeLedgerAccountId: string | null = null

export function setActiveLedgerAccountId(id: string): string {
  activeLedgerAccountId = id
  return id
}

export function activeLedgerAccountIdOrThrow(): string {
  if (!activeLedgerAccountId) {
    throw new Error(
      'BDD world: no active ledger account id set — the step definition must run a ledger-account Given first.',
    )
  }
  return activeLedgerAccountId
}

// Without this, `activeEm` (a plain module-level variable) would survive
// from one scenario into the next in the same `cucumber-js` process — a
// scenario whose own first Given uses `activeEmOrNew()` (rather than
// `setActiveEm(new FakeEntityManager())`) could then silently inherit a
// previous scenario's fake store instead of starting isolated, which is
// exactly the kind of cross-scenario leakage BDD scenarios are supposed to
// be safe from.
Before(function () {
  activeEm = null
  activeLedgerAccountId = null
})

// `emitCrudSideEffects`'s only real dependency (see
// `packages/shared/src/lib/commands/helpers.ts`) — a synchronous call, no
// DB/network involved, so a no-op stub is enough. Not currently exercised
// by any wired-up scenario (see README, "Verification status"), kept here
// so `buildCommandContext` matches the shape every command expects.
const noopDataEngine = {
  markOrmEntityChange: () => undefined,
  emitEvent: () => undefined,
}

/**
 * Builds the fake `CommandRuntimeContext` every step definition passes to
 * a real command's `execute()`. `auth` is deliberately left `undefined`
 * and `organizationScope` deliberately left `undefined`: reading
 * `ensureTenantScope`/`ensureOrganizationScope` in
 * `packages/shared/src/lib/commands/scope.ts` shows both fall through to a
 * no-op when `ctx.auth` is falsy and `ctx.organizationScope` is falsy —
 * this is the same "system/worker context" branch those functions
 * document as load-bearing for scope-less callers, not a gap in this
 * fake. `transactionalEm` is set directly to the same fake EM so
 * `postJournalEntry.ts`'s `withPostingTransaction` takes its
 * caller-supplied-transaction branch and never calls the (unfakeable)
 * `EntityManager#transactional()`.
 */
export function buildCommandContext(em: FakeEntityManager): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return noopDataEngine
        return undefined
      },
    },
    transactionalEm: em as unknown as CommandRuntimeContext['transactionalEm'],
    auth: undefined,
    organizationScope: undefined,
    // Was `ORG_ID` — but `ensureOrganizationScope` only truly no-ops when
    // this is falsy; a fixed non-null value makes it compare every
    // command's real `input.organizationId` against this constant and
    // reject anything else with 403 Forbidden (found while wiring the
    // sequence-numbering scenarios, which correctly post under more than
    // one organization). `undefined` is what this comment always claimed
    // and what the Jest-side fake (`commands/__tests__/support/fakeEntityManager.ts`)
    // already uses for the same case.
    selectedOrganizationId: undefined,
    organizationIds: null,
    request: null,
  } as unknown as CommandRuntimeContext
}

/** Looks up a real, already-registered command handler and runs it. */
export async function executeCommand<TResult = unknown>(
  id: string,
  input: unknown,
  ctx: CommandRuntimeContext,
): Promise<TResult> {
  const command = commandRegistry.get(id)
  if (!command) {
    throw new Error(
      `BDD world: command "${id}" is not registered — the step definition must import its command module first.`,
    )
  }
  return command.execute(input, ctx) as Promise<TResult>
}

/** Captures a thrown error from an async call without losing its shape. */
export async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return null
  } catch (err) {
    return err
  }
}

export function newId(): string {
  return randomUUID()
}
