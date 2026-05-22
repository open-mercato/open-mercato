import type { EntityManager } from '@mikro-orm/postgresql'

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
 * inside a database transaction (`em.begin()` / `em.commit()` /
 * `em.rollback()`) for all-or-nothing semantics. The outer `em`
 * stays bound to the transaction, so phases that close over `em`
 * participate in the same transaction.
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
  options?: { transaction?: boolean },
): Promise<void> {
  if (phases.length === 0) return

  const runPhasesAndFlush = async () => {
    for (const phase of phases) {
      await phase()
    }
    await em.flush()
  }

  if (options?.transaction) {
    await em.begin()
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
    return
  }

  await runPhasesAndFlush()
}
