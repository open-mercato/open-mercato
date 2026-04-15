import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Wraps multiple mutation phases in a single atomic flush.
 *
 * Prevents partial commits when a command mutates entities across
 * multiple phases (e.g., scalar mutations + relation syncs).
 * Each phase function runs sequentially; a single `em.flush()`
 * commits all changes at the end.
 *
 * When `options.transaction` is true, the entire operation runs
 * inside a database transaction for all-or-nothing semantics.
 *
 * Keep side-effect emissions (emitCrudSideEffects etc.) OUTSIDE
 * the withAtomicFlush block — they should only fire after commit.
 */
export async function withAtomicFlush(
  em: EntityManager,
  phases: Array<() => void | Promise<void>>,
  options?: { transaction?: boolean },
): Promise<void> {
  const run = async (innerEm: EntityManager) => {
    for (const phase of phases) {
      await phase()
    }
    await innerEm.flush()
  }

  if (options?.transaction) {
    await em.transactional(async () => {
      await run(em)
    })
  } else {
    await run(em)
  }
}
