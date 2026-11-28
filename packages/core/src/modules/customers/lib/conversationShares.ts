import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerEmailConversationShare, CustomerInteraction } from '../data/entities'

const logger = createLogger('customers')

/**
 * Upper bound on how many share grants are folded into a single read predicate.
 *
 * Person-scoped reads pass at most a handful of grants, so this only bites on the
 * unscoped surfaces (`/interactions`, `/activities`). Truncation is LOGGED rather
 * than silent: dropping a grant hides email the caller is entitled to see, which
 * is a visible-but-safe failure, and the log is what makes it diagnosable.
 */
export const SHARE_ARM_MAX = 500

/**
 * One "owner O shared their conversation with Person P" grant, reduced to the two
 * columns the read predicate matches on.
 */
export type ConversationShareGrant = {
  personEntityId: string
  ownerUserId: string
}

export type ConversationShareScope = {
  tenantId: string
  organizationId: string | null
}

type ShareRow = {
  id: string
  ownerUserId: string
  sharedByUserId: string
  createdAt: Date
  updatedAt?: Date | null
  personEntity?: { id: string } | null
}

function scopeWhere(scope: ConversationShareScope): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId: scope.tenantId, deletedAt: null }
  if (scope.organizationId) where.organizationId = scope.organizationId
  return where
}

/**
 * Live share rows for one Person, in scope. Used by the Person-page read paths and
 * by the share route's GET so the UI can render "shared by <name>".
 */
export async function listSharesForPerson(
  em: EntityManager,
  scope: ConversationShareScope,
  personId: string,
): Promise<ShareRow[]> {
  if (!personId) return []
  const found = (await em.find(
    CustomerEmailConversationShare,
    { ...scopeWhere(scope), personEntity: personId } as never,
    { orderBy: { createdAt: 'asc' } },
  )) as unknown as ShareRow[]
  return Array.isArray(found) ? found : []
}

/**
 * The grants that widen what `viewerUserId` may read, across all Persons in scope.
 *
 * Own shares are excluded: a caller already sees their own private email via the
 * author arm of the visibility predicate, so including them would only inflate the
 * predicate. Returns `[]` for an anonymous/API-key caller, which keeps those
 * callers on today's strict behaviour (fail closed).
 */
export async function listGrantsForViewer(
  em: EntityManager,
  scope: ConversationShareScope,
  viewerUserId: string | null,
): Promise<ConversationShareGrant[]> {
  if (!viewerUserId || viewerUserId.startsWith('api_key:')) return []

  const found = (await em.find(
    CustomerEmailConversationShare,
    { ...scopeWhere(scope), ownerUserId: { $ne: viewerUserId } } as never,
    { orderBy: { createdAt: 'asc' }, limit: SHARE_ARM_MAX + 1 },
  )) as unknown as ShareRow[]
  const rows = Array.isArray(found) ? found : []

  if (rows.length > SHARE_ARM_MAX) {
    logger.warn(
      '[internal] email conversation share grants truncated for read predicate',
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        limit: SHARE_ARM_MAX,
        dropped: rows.length - SHARE_ARM_MAX,
      },
    )
  }

  return toGrants(rows.slice(0, SHARE_ARM_MAX))
}

/**
 * Person-scoped variant of {@link listGrantsForViewer}: the grants that widen what
 * `viewerUserId` may read for ONE Person. Cheaper and unbounded-safe, so the
 * Person page never hits the cap.
 */
export async function listGrantsForViewerOnPerson(
  em: EntityManager,
  scope: ConversationShareScope,
  viewerUserId: string | null,
  personId: string,
): Promise<ConversationShareGrant[]> {
  if (!viewerUserId || viewerUserId.startsWith('api_key:') || !personId) return []
  const rows = (await em.find(CustomerEmailConversationShare, {
    ...scopeWhere(scope),
    personEntity: personId,
    ownerUserId: { $ne: viewerUserId },
  } as never)) as unknown as ShareRow[]
  return toGrants(rows)
}

/**
 * Normalizes a share query result into grants, failing CLOSED on anything
 * unexpected.
 *
 * Grants only ever widen visibility, so the safe direction when a result is not
 * a usable row array is to return none: the caller falls back to the strict
 * owner-only view. Throwing here would take down an entire Person page over a
 * read that is purely additive.
 */
function toGrants(rows: ShareRow[] | null | undefined): ConversationShareGrant[] {
  if (!Array.isArray(rows)) return []
  const grants: ConversationShareGrant[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const personEntityId = row.personEntity?.id
    if (typeof personEntityId !== 'string' || !personEntityId) continue
    if (typeof row.ownerUserId !== 'string' || !row.ownerUserId) continue
    grants.push({ personEntityId, ownerUserId: row.ownerUserId })
  }
  return grants
}

/**
 * The caller's own live share row for a Person, or `null`. Drives the toggle state
 * and supplies `updatedAt` for the optimistic-lock header.
 */
export async function findOwnShare(
  em: EntityManager,
  scope: ConversationShareScope,
  ownerUserId: string,
  personId: string,
): Promise<ShareRow | null> {
  if (!ownerUserId || !personId) return null
  return (await em.findOne(CustomerEmailConversationShare, {
    ...scopeWhere(scope),
    personEntity: personId,
    ownerUserId,
  } as never)) as unknown as ShareRow | null
}

/**
 * Does the caller actually have a conversation to share — i.e. do they author at
 * least one PRIVATE email interaction for this Person?
 *
 * Gates the UI control and makes the write route reject a share that would grant
 * access to nothing. Counting only `private` rows is deliberate: a mailbox whose
 * mail is already `shared` has nothing to escalate.
 */
export async function canShareConversation(
  em: EntityManager,
  scope: ConversationShareScope,
  ownerUserId: string | null,
  personId: string,
): Promise<boolean> {
  if (!ownerUserId || ownerUserId.startsWith('api_key:') || !personId) return false
  const where: Record<string, unknown> = {
    entity: personId,
    tenantId: scope.tenantId,
    interactionType: 'email',
    visibility: 'private',
    authorUserId: ownerUserId,
    deletedAt: null,
  }
  if (scope.organizationId) where.organizationId = scope.organizationId
  const count = await em.count(CustomerInteraction, where as never)
  return count > 0
}

/**
 * Upper bound on shared-channel ids folded into a read predicate. A tenant with
 * more shared team mailboxes than this is implausible, but the cap keeps the
 * predicate bounded and truncation is logged rather than silent.
 */
export const SHARED_CHANNEL_ARM_MAX = 500

/**
 * Ids of channels marked as shared team mailboxes in this scope.
 *
 * Read by string class name, the same cross-module pattern
 * `personEmailThreads.ts` and `link-channel-message-handler.ts` already use, so
 * the customers module never imports the hub's entity classes.
 *
 * The caller's OWN channels are excluded: their mail already reaches them via the
 * author arm, so including them would only inflate the predicate. Returns `[]` for
 * an anonymous/API-key caller and on any error — every failure mode is
 * fail-closed, because these ids only ever widen visibility.
 */
export async function listSharedChannelIds(
  em: EntityManager,
  scope: ConversationShareScope,
  viewerUserId: string | null,
): Promise<string[]> {
  if (!viewerUserId || viewerUserId.startsWith('api_key:')) return []
  try {
    const where: Record<string, unknown> = {
      tenantId: scope.tenantId,
      visibility: 'shared',
      deletedAt: null,
    }
    if (scope.organizationId) where.organizationId = scope.organizationId
    const rows = (await em.find('CommunicationChannel' as never, where as never, {
      limit: SHARED_CHANNEL_ARM_MAX + 1,
    })) as unknown as Array<{ id?: string; userId?: string | null }>
    if (!Array.isArray(rows)) return []

    // Check truncation against the RAW row count, before own channels are filtered
    // out. Testing the filtered list would only warn when the caller happens to own
    // none of the overflow, which is the wrong condition.
    if (rows.length > SHARED_CHANNEL_ARM_MAX) {
      logger.warn('[internal] shared channel ids truncated for read predicate', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        limit: SHARED_CHANNEL_ARM_MAX,
        dropped: rows.length - SHARED_CHANNEL_ARM_MAX,
      })
    }

    const ids: string[] = []
    for (const row of rows.slice(0, SHARED_CHANNEL_ARM_MAX)) {
      if (!row || typeof row.id !== 'string' || !row.id) continue
      // Own channels add nothing — the author arm already admits their rows.
      if (row.userId === viewerUserId) continue
      ids.push(row.id)
    }
    return ids
  } catch {
    // Fail closed: no ids means the strict predicate, never a wider one.
    return []
  }
}

/** The CURRENT authority of a live `customer_interactions` row, for revocation checks. */
export type LiveInteractionAuthority = {
  visibility: string | null
  authorUserId: string | null
  channelId: string | null
  /**
   * The Person/Company this interaction CURRENTLY belongs to — an interaction
   * can be re-linked to a different parent after the audit entry describing
   * it was recorded, so this is the only `entityId` safe to use for matching
   * a conversation-share grant against a historical representation.
   */
  entityId: string | null
}

export const LIVE_INTERACTION_ARM_MAX = 500

/**
 * `CustomerInteraction.entity` is a ManyToOne reference (`entity_id` FK) — MikroORM
 * returns either the raw FK string or a `Reference`-shaped object exposing `.id`,
 * depending on hydration. Mirrors the same ternary `loadInteractionSnapshot` uses.
 */
function resolveEntityId(entityRef: unknown): string | null {
  if (typeof entityRef === 'string') return entityRef
  if (entityRef && typeof entityRef === 'object' && 'id' in (entityRef as Record<string, unknown>)) {
    const id = (entityRef as Record<string, unknown>).id
    return typeof id === 'string' ? id : null
  }
  return null
}

/**
 * Batched CURRENT (live) visibility/author/channel for a set of interaction ids,
 * scoped to tenant/organization. An email interaction's `visibility` can be
 * revoked (shared → private) after an audit entry already recorded the OLD
 * value in its stored snapshot — callers MUST use this live authority, never
 * the stored snapshot fields, to decide whether a historical audit
 * representation of that same interaction is visible today.
 *
 * Soft-deleted rows are excluded on purpose: a deleted interaction has no live
 * authority to resolve, so its id is simply absent from the returned map and
 * the caller's conservative historical fallback applies.
 *
 * Fails CLOSED: an empty map means every id falls back to that same
 * conservative path, never to the (unverifiable) stored visibility.
 */
export async function loadLiveInteractionAuthority(
  em: EntityManager,
  scope: ConversationShareScope,
  interactionIds: readonly string[],
): Promise<Map<string, LiveInteractionAuthority>> {
  const ids = Array.from(
    new Set(interactionIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  )
  if (!ids.length) return new Map()
  try {
    const map = new Map<string, LiveInteractionAuthority>()
    for (let offset = 0; offset < ids.length; offset += LIVE_INTERACTION_ARM_MAX) {
      const batchIds = ids.slice(offset, offset + LIVE_INTERACTION_ARM_MAX)
      const where: Record<string, unknown> = { id: { $in: batchIds }, tenantId: scope.tenantId, deletedAt: null }
      if (scope.organizationId) where.organizationId = scope.organizationId
      const rows = (await findWithDecryption(
        em,
        CustomerInteraction,
        where as never,
        { limit: batchIds.length },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )) as unknown as Array<{
        id: string
        visibility?: string | null
        authorUserId?: string | null
        channelId?: string | null
        entity?: unknown
      }>
      if (!Array.isArray(rows)) return new Map()
      for (const row of rows) {
        if (!row || typeof row.id !== 'string' || !row.id) continue
        map.set(row.id, {
          visibility: row.visibility ?? null,
          authorUserId: row.authorUserId ?? null,
          channelId: row.channelId ?? null,
          entityId: resolveEntityId(row.entity),
        })
      }
    }
    return map
  } catch (err) {
    logger.warn('[internal] failed to resolve live interaction authority; failing closed', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'customers',
      code: 'customers.live_interaction_authority_load_failed',
    })
    // Fail closed: an empty map routes every id through the caller's
    // conservative historical fallback, never through the stored snapshot.
    return new Map()
  }
}
