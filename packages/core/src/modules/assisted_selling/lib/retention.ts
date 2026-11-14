import type { EntityManager } from '@mikro-orm/postgresql'
import { AssistedSellingMessage, AssistedSellingParticipant, AssistedSellingProposal, AssistedSellingThread } from '../data/entities'

// Step 4.5 (§5.10, S7). "A route that stores text about a buyer must ship with retention and
// erasure." This Step shipped the three EVENT-DRIVEN erasure triggers only (`cart.cart.purged`,
// `customer_accounts.user.deleted`, `auth.user.deleted`) — the two TIME-based sweepers
// (`assisted-selling-idle-close`, `assisted-selling-retention`, keyed on
// `idle_close_days`/`conversation_retention_days`) were deferred to a later Step (see
// NOTIFY.md's Step 4.5 entry). Step 6.1 closes that gap: `lib/sweepers.ts#sweepRetention`
// calls `eraseAssistedSellingThread` below — the SAME erase routine §5.10 names for every
// trigger, event-driven or time-based — so none of the four ever drifts from the others.

/**
 * §5.10's "closed and erased immediately" / "the same routine" for the three erasure
 * triggers: hard-deletes the thread's messages and participants, clears `rejection_reason`
 * on its proposals (proposal METADATA — ids, statuses, amounts — survives, per §5.10's own
 * "commission reporting is unaffected"), and soft-deletes the thread itself (closing it
 * first, when not already closed).
 *
 * Idempotent on redelivery: a thread already erased (`deletedAt` set) is excluded by the
 * caller's own lookup before this ever runs, and this function's own first read repeats
 * that same `deletedAt: null` guard, so a second delivery for the same thread id is a no-op.
 */
export async function eraseAssistedSellingThread(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  threadId: string,
): Promise<boolean> {
  const thread = await em.findOne(AssistedSellingThread, { ...scope, id: threadId, deletedAt: null })
  if (!thread) return false

  const now = new Date()
  await em.nativeDelete(AssistedSellingMessage, { ...scope, threadId })
  await em.nativeDelete(AssistedSellingParticipant, { ...scope, threadId })
  await em.nativeUpdate(AssistedSellingProposal, { ...scope, threadId }, { rejectionReason: null, updatedAt: now })

  thread.status = 'closed'
  if (!thread.closedAt) thread.closedAt = now
  thread.deletedAt = now
  em.persist(thread)
  await em.flush()
  return true
}

/**
 * §5.10's staff-deletion row: "The rep's participant rows keep their id but their
 * `display_name` is replaced with a fixed label." Scoped by tenant (and organization, when
 * the caller has one) — never a bare `actorId` match across tenants. Idempotent by
 * construction: re-setting the same literal label twice is a no-op outcome, never an error.
 * Returns the number of rows touched (tests assert on this; callers do not need it).
 */
export async function anonymizeAssistedSellingRepParticipants(
  em: EntityManager,
  scope: { tenantId: string; organizationId?: string | null },
  actorId: string,
): Promise<number> {
  const where: Record<string, unknown> = {
    tenantId: scope.tenantId,
    actorType: 'rep',
    actorId,
    deletedAt: null,
  }
  if (scope.organizationId) where.organizationId = scope.organizationId

  const participants = await em.find(AssistedSellingParticipant, where)
  if (participants.length === 0) return 0

  const now = new Date()
  let touched = 0
  for (const participant of participants) {
    // §5.10's own fixed label, literal (a stored snapshot shown to the other party —
    // §5.2's existing convention for this column, not a thrown error or a toast).
    if (participant.displayName === 'Former team member') continue
    participant.displayName = 'Former team member'
    participant.updatedAt = now
    em.persist(participant)
    touched += 1
  }
  if (touched > 0) await em.flush()
  return touched
}
