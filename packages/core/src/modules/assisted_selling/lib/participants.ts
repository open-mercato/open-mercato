import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AssistedSellingParticipant } from '../data/entities'

// Step 4.4. Shared by `commands/threads.ts` (the opening rep participant) and
// `commands/proposals.ts` (the message author on an authored/re-authored proposal) so a rep
// gets exactly ONE `AssistedSellingParticipant` row per thread (`@Unique(['threadId',
// 'actorType', 'actorId'])`) regardless of which route first creates it.

/**
 * Review finding: this snapshot is shown to the OTHER party — including a token-only,
 * unauthenticated buyer (`api/storefront/thread/route.ts`'s own `participants.map(...
 * displayName: p.displayName)`) — and, per this file's own header comment, is written ONCE
 * and never re-derived. A fallback to the staff user's email therefore permanently leaked
 * their email to that audience whenever their `name` was blank. Falls back to a role label
 * instead — never an email, for either audience.
 */
export function resolveDisplayName(user: User | null): string {
  const name = user?.name?.trim()
  if (name) return name
  // `[internal]`-free by design, same precedent `buildAssistedSellingBuyerDisplayName` below
  // sets: a stored data snapshot shown to the other party, not a thrown error or a toast.
  return 'Rep'
}

/**
 * Finds the thread's existing `rep` participant for `actorId`, or builds (but does not
 * persist) a new one with an explicit, pre-generated id so callers can reference
 * `.id` before the enclosing `withAtomicFlush` phase actually flushes it.
 */
export async function resolveOrBuildRepParticipant(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string; threadId: string },
  actorId: string,
): Promise<{ participant: AssistedSellingParticipant; isNew: boolean }> {
  const existing = await em.findOne(AssistedSellingParticipant, {
    tenantId: scope.tenantId,
    threadId: scope.threadId,
    actorType: 'rep',
    actorId,
    deletedAt: null,
  })
  if (existing) return { participant: existing, isNew: false }

  // `User.name` is encrypted (auth:user) — this snapshot is written once into
  // `AssistedSellingParticipant.displayName` (itself encrypted) and never re-derived, so a
  // plain `em.findOne` here would permanently bake the ciphertext in as the "name".
  const user = await findOneWithDecryption(em, User, { id: actorId }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  const displayName = resolveDisplayName(user)
  const now = new Date()
  const participant = em.create(AssistedSellingParticipant, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    threadId: scope.threadId,
    actorType: 'rep' as const,
    actorId,
    displayName,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  return { participant, isNew: true }
}

// Step 4.5 (§6.2, S6). The buyer side of the same `resolveOrBuild*Participant` family —
// `POST /thread`/`POST /thread/messages` need the buyer's own `AssistedSellingParticipant`
// row the same way the staff routes need the rep's. `actorId` is `customerUserId` for an
// identified buyer, `null` for a guest (§5.2: "NULL only for a guest buyer") — the entity's
// own `(thread_id, actor_type, actor_id)` uniqueness is a partial index on `deleted_at`, not a
// true-NULL-distinct guarantee for a guest's repeated `null`, but a single buyer only ever
// holds one open thread on one basket (§5.1's own `(tenant_id, buyer_cart_id)` partial unique
// index), so the plain find-then-create below never races in practice.

/** `[internal]`-free by design (rev of the i18n hardcoded-string rule): this is a stored
 * data snapshot shown to the OTHER party (§5.2), not a thrown error or a toast — the same
 * class of literal text `resolveDisplayName` above already stores for a rep's real name. */
export function buildAssistedSellingBuyerDisplayName(customerUserId: string | null): string {
  return customerUserId ? 'Customer' : 'Guest'
}

export async function resolveOrBuildBuyerParticipant(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string; threadId: string },
  customerUserId: string | null,
): Promise<{ participant: AssistedSellingParticipant; isNew: boolean }> {
  const existing = await em.findOne(AssistedSellingParticipant, {
    tenantId: scope.tenantId,
    threadId: scope.threadId,
    actorType: 'buyer',
    actorId: customerUserId,
    deletedAt: null,
  })
  if (existing) return { participant: existing, isNew: false }

  const now = new Date()
  const participant = em.create(AssistedSellingParticipant, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    threadId: scope.threadId,
    actorType: 'buyer' as const,
    actorId: customerUserId,
    displayName: buildAssistedSellingBuyerDisplayName(customerUserId),
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  return { participant, isNew: true }
}
