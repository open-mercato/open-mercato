// Support helpers shared by every `ledger` BDD step-definition file
// (OM-174). See `../README.md` for why this exists and what it does and
// does not verify.
//
// `FakeEntityManager` is a minimal, hand-written stand-in for MikroORM's
// `EntityManager`, covering only the calls the ledger commands under test
// actually make: `find` / `findOne` / `count` / `create` / `persist` /
// `flush` / `fork` / `begin` / `commit` / `rollback`, plus the one raw-SQL
// escape hatch `commands/postJournalEntry.ts`'s `claimNextSequenceNumber`
// uses for the `journal_entry_sequence` table. It is modeled directly on
// `currencies/commands/__tests__/scope.test.ts`'s own `buildEm()` helper —
// same shape, same intent (exercise the real command against a fake
// persistence layer) — but written as plain closures over a `Map` instead
// of `jest.fn()` mocks, since Cucumber has no bundled mocking library.
import { randomUUID } from 'crypto'
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
   * Test setup only — pre-sets `journal_entry_sequence.next_value` for a
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

  fork(): FakeEntityManager {
    return this
  }

  getConnection() {
    return {
      execute: async (sql: string, params: unknown[]): Promise<{ next_value: string }[]> => {
        if (!sql.includes('journal_entry_sequence')) {
          throw new Error(`FakeEntityManager.getConnection().execute(): unhandled raw SQL — ${sql}`)
        }
        const [organizationId, tenantId] = params as [string, string]
        const key = `${organizationId}:${tenantId}`
        const current = this.sequenceCounters.get(key) ?? 1
        this.sequenceCounters.set(key, current + 1)
        return [{ next_value: String(current) }]
      },
    }
  }
}

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
    selectedOrganizationId: ORG_ID,
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
