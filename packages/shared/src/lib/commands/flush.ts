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

  // SPEC-018: the phases ARE flush boundaries — flush AFTER EACH phase, not once
  // at the end. A phase's scalar mutations must be persisted before the NEXT
  // phase runs any query (em.find / findOne / nativeUpdate / a sync helper);
  // otherwise the interleaved read resets MikroORM v7's identity-map changeset
  // and the pending scalar UPDATE is silently dropped (the #2453 family). This
  // is the framework-level guarantee that lets commands keep mutations and the
  // reads that depend on them in separate phases without hand-rolled flushes.
  //
  // Atomicity is preserved: when `transaction: true` (or an ambient transaction
  // is joined), each `em.flush()` only emits SQL inside the open transaction —
  // the single commit/rollback below still spans every phase, so a later-phase
  // failure rolls back all earlier phases. Without a transaction the helper
  // keeps its documented "each phase flushes independently" behavior.
  const runPhasesAndFlush = async () => {
    for (const phase of phases) {
      await phase()
      await em.flush()
    }
  }

  if (!options?.transaction) {
    await runPhasesAndFlush()
    return
  }

  // Re-entrancy guard: never open a nested transaction with raw begin/commit.
  // If a transaction is already active on this EntityManager, join it — the
  // outermost caller owns commit/rollback. A phase error propagates and rolls
  // back the whole enclosing transaction.
  //
  // Guard the probe: real MikroORM EntityManagers always implement
  // `isInTransaction()`, but partial / mock EMs may not. A missing method is
  // treated as "not in a transaction", so this call opens its own top-level
  // transaction via the begin/commit path below (which those EMs do support).
  const isInTransaction = (em as { isInTransaction?: () => boolean }).isInTransaction
  if (typeof isInTransaction === 'function' && isInTransaction.call(em)) {
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
