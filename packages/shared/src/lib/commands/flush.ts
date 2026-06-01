import type { EntityManager } from '@mikro-orm/postgresql'
import type { IsolationLevel } from '@mikro-orm/core'

/**
 * Options controlling how {@link withAtomicFlush} executes its phases.
 */
export type AtomicFlushOptions = {
  /**
   * When true, the whole sequence runs inside a database transaction for
   * all-or-nothing semantics. Default: false (a single `em.flush()` commits
   * all phases at the end — no transaction).
   */
  transaction?: boolean
  /**
   * Optional transaction isolation level, forwarded to `em.begin()`. Only
   * honoured when this call opens a new top-level transaction (i.e.
   * `transaction: true` and the EntityManager is not already inside a
   * transaction). Ignored when joining an ambient transaction.
   */
  isolationLevel?: IsolationLevel
  /**
   * Optional label for diagnostics. Currently informational only.
   */
  label?: string
}

/**
 * Wraps multiple mutation phases in a single atomic flush.
 *
 * Prevents partial commits when a command mutates entities across
 * multiple phases (e.g., scalar mutations + relation syncs).
 * Each phase function runs sequentially; a single `em.flush()`
 * commits all changes at the end on the same `EntityManager` the
 * phases mutate, so closures over `em` stay valid.
 *
 * When `options.transaction` is true, the whole sequence runs
 * inside a database transaction for all-or-nothing semantics.
 *
 * ## Re-entrancy / composability
 *
 * `withAtomicFlush({ transaction: true })` is safe to nest. If the
 * supplied `EntityManager` is **already inside a transaction**, this
 * call does NOT open a second one (raw `em.begin()` would clobber the
 * active `#transactionContext` and orphan the outer transaction — unlike
 * `em.transactional()`, MikroORM's `em.begin()` does not check
 * `isInTransaction()`). Instead it joins the ambient transaction: the
 * phases run and flush within it, and the outermost caller owns the final
 * `commit()` / `rollback()`. A phase error therefore rolls back the entire
 * enclosing transaction (all-or-nothing across the whole nest).
 *
 * This mirrors the contract every command relies on: each command forks
 * the request `EntityManager` first, so the common case opens a fresh
 * top-level transaction; nesting only happens when one transactional unit
 * is composed inside another on the same `em`.
 *
 * When `phases` is empty the call is a true no-op — no flush,
 * no transaction. Callers that need an explicit commit should
 * pass at least one phase.
 *
 * Keep side-effect emissions (`emitCrudSideEffects` etc.) OUTSIDE
 * the `withAtomicFlush` block — they should only fire after commit.
 */
export async function withAtomicFlush(
  em: EntityManager,
  phases: Array<() => void | Promise<void>>,
  options?: AtomicFlushOptions,
): Promise<void> {
  if (phases.length === 0) return

  const runPhasesAndFlush = async () => {
    for (const phase of phases) {
      await phase()
    }
    await em.flush()
  }

  if (!options?.transaction) {
    await runPhasesAndFlush()
    return
  }

  // Re-entrancy guard: never open a nested transaction with raw begin/commit.
  // If a transaction is already active on this EntityManager, join it — the
  // outermost caller owns commit/rollback. A phase error propagates and rolls
  // back the whole enclosing transaction.
  if (em.isInTransaction()) {
    await runPhasesAndFlush()
    return
  }

  await em.begin(options.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined)
  try {
    await runPhasesAndFlush()
    await em.commit()
  } catch (err) {
    try {
      await em.rollback()
    } catch {
      // rollback failure should not mask the original error; intentionally swallowed
    }
    throw err
  }
}
