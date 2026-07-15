import type { EntityManager } from '@mikro-orm/postgresql'
import type { IsolationLevel } from '@mikro-orm/core'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'commands' })

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
   * Optional label for diagnostics. Surfaced in the commit-boundary guard's
   * dev warning when a pending change set had to be flushed defensively, so the
   * offending command is identifiable.
   */
  label?: string
}

type UnitOfWorkProbe = {
  computeChangeSets?: () => void
  getChangeSets?: () => ReadonlyArray<unknown>
}

type FlushGuardEntityManager = {
  flush: () => Promise<void>
  getUnitOfWork?: () => UnitOfWorkProbe | undefined
}

/**
 * Commit-boundary safety net.
 *
 * After every phase has run and flushed, this asserts the UnitOfWork holds NO
 * pending change sets before the transaction commits. If it still does — a phase
 * mutated a managed entity AFTER its own per-phase flush boundary (the exact
 * shape that silently drops a scalar UPDATE under MikroORM v7) — the guard
 * flushes those changes defensively so the write can never be lost, and warns in
 * non-production so the latent ordering bug gets fixed at the source.
 *
 * Detection is best-effort and fail-safe: it only issues the extra flush when it
 * can PROVE the UnitOfWork is dirty (`computeChangeSets()` → `getChangeSets()`
 * non-empty). On EntityManagers that don't expose a UnitOfWork (partial/mock EMs
 * in unit tests) it does nothing — the per-phase flushes already ran — so it
 * never double-flushes a clean unit of work and never changes flush counts for
 * callers that were already correct.
 */
async function flushPendingChangesGuard(
  em: FlushGuardEntityManager,
  label?: string,
): Promise<void> {
  let pendingCount = -1
  try {
    const uow = typeof em.getUnitOfWork === 'function' ? em.getUnitOfWork() : undefined
    if (uow && typeof uow.computeChangeSets === 'function' && typeof uow.getChangeSets === 'function') {
      uow.computeChangeSets()
      pendingCount = uow.getChangeSets().length
    }
  } catch {
    // Probing the UnitOfWork must never break a command; fall back to "unknown".
    pendingCount = -1
  }

  if (pendingCount > 0) {
    await em.flush()
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('withAtomicFlush: pending change-sets remained at the commit boundary and were flushed defensively — a phase mutated a managed entity after its flush boundary; split the mutation and any dependent read/sync into separate phases', { label: label ?? null, pendingCount })
    }
  }
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
  //
  // Commit-boundary guarantee: after the last phase flush, `flushPendingChangesGuard`
  // re-checks the UnitOfWork and flushes once more if ANY pending change set remains
  // (a phase mutated state after its boundary). The transaction therefore can never
  // commit with unflushed work — if a per-phase flush was missed "for some reason",
  // the guard catches it inside the same transaction and warns in dev.
  const runPhasesAndFlush = async () => {
    for (const phase of phases) {
      await phase()
      await em.flush()
    }
    await flushPendingChangesGuard(em as unknown as FlushGuardEntityManager, options?.label)
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
