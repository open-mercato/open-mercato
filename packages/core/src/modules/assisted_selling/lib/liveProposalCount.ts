import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * `live_proposal_count` is read by concurrent author/withdraw/accept/reauthor/expire paths
 * that each used to read-modify-write the in-memory entity value — a classic lost-update
 * race under concurrency (review finding). This issues a single atomic SQL update instead,
 * floored at zero the same way the in-memory `Math.max(0, ...)` guard was, and bumps
 * `updated_at` the same way the entity's own `onUpdate` hook would have, so optimistic-lock
 * callers (`assign`) keep seeing a fresh value after a concurrent count change.
 */
export async function applyLiveProposalCountDelta(
  em: EntityManager,
  thread: { id: string },
  delta: number,
): Promise<void> {
  await em.execute(
    `UPDATE assisted_selling_threads
        SET live_proposal_count = GREATEST(live_proposal_count + ?, 0),
            updated_at = now()
      WHERE id = ?`,
    [delta, thread.id],
  )
}
