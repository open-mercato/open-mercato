import type { FilterQuery } from '@mikro-orm/postgresql'
import { hasFeature } from '@open-mercato/shared/security/features'
import { CustomerInteraction } from '../data/entities'

/**
 * The ACL feature that grants admins the right to see private emails authored
 * by other users. Declared in `acl.ts` but granted to NO role in v1 (reserved
 * for the v2 oversight feature — see `callerHasEmailViewPrivate`).
 */
export const EMAIL_VIEW_PRIVATE_FEATURE = 'customers.email.view_private'

/**
 * Returns true when the caller holds the admin override to see ALL private email
 * interactions. Honours wildcards (`customers.*`, `*`).
 *
 * RESERVED FOR v2 — NOT wired in v1. The v1 model is strict owner-only with no
 * admin bypass: the visibility filters and `canChangeEmailVisibility` ignore
 * caller features, and `customers.email.view_private` is granted to no role.
 * Kept (with {@link EMAIL_VIEW_PRIVATE_FEATURE}) so v2 oversight can opt back in
 * without re-introducing the helper. Do NOT wire this into a read path without
 * an explicit v2 spec.
 */
export function callerHasEmailViewPrivate(userFeatures: string[] | null | undefined): boolean {
  if (!Array.isArray(userFeatures) || userFeatures.length === 0) return false
  return hasFeature(userFeatures, EMAIL_VIEW_PRIVATE_FEATURE)
}

/**
 * Authorization predicate for CHANGING an email interaction's visibility.
 *
 * Personal mailbox privacy (v1: strict owner-only): ONLY the interaction's
 * author may flip their own email between private/shared — there is no admin
 * bypass. Non-email rows and no-op changes are always allowed. Mirrors the gate
 * in the dedicated `PATCH .../visibility` route so the generic interaction-update
 * path cannot bypass the privacy control. `userFeatures` is reserved for v2.
 */
export function canChangeEmailVisibility(opts: {
  interactionType: string
  currentVisibility: string | null | undefined
  nextVisibility: string | null | undefined
  authorUserId: string | null | undefined
  actorUserId: string | null | undefined
  userFeatures: string[] | null | undefined
}): boolean {
  if (opts.interactionType !== 'email') return true
  if ((opts.nextVisibility ?? null) === (opts.currentVisibility ?? null)) return true
  return Boolean(opts.actorUserId) && opts.authorUserId === opts.actorUserId
}

export interface ApplyEmailVisibilityFilterOptions {
  currentUserId: string | null
  userFeatures: string[] | null | undefined
}

/**
 * Adds a `WHERE` predicate to a kysely query so that:
 *   - Non-email interactions (calls, meetings, tasks) pass through unchanged.
 *   - Email interactions with `visibility = 'shared'` are visible to all.
 *   - Email interactions with `visibility = 'private'` are visible ONLY to the
 *     `authorUserId` (channel owner).
 *
 * Personal mailbox privacy (v1: strict owner-only) — there is NO admin bypass:
 * a private email is hidden from everyone except its author, including
 * admins/superadmins. `opts.userFeatures` is retained for signature stability
 * and reserved for the v2 admin-oversight feature.
 *
 * The function expects a kysely-style builder whose `.where()` accepts an
 * expression-builder callback. Returns the same builder for chaining.
 */
export function applyEmailVisibilityFilter<T extends { where: (...args: any[]) => T }>(
  query: T,
  opts: ApplyEmailVisibilityFilterOptions,
): T {
  const currentUserId = opts.currentUserId
  // A row is hidden ONLY when it is an email explicitly marked `private` and the
  // caller is not its author. Everything else stays visible, including:
  //   - non-email interactions (calls, meetings, tasks),
  //   - emails marked `shared`,
  //   - legacy/unset rows where `visibility IS NULL` (e.g. email-log entries
  //     created before per-email visibility shipped) — these must remain
  //     visible to avoid silently hiding pre-existing CRM history.
  return query.where((eb: any) =>
    eb.or([
      eb('interaction_type', '!=', 'email'),
      eb('visibility', 'is', null),
      eb('visibility', '!=', 'private'),
      currentUserId
        ? eb('author_user_id', '=', currentUserId)
        : eb.val(false),
    ]),
  )
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[] | undefined>
}

/**
 * Resolve the caller's granted features (wildcard-aware downstream) so a v2
 * visibility filter could honour the `customers.email.view_private` admin
 * override. Returns `undefined` when there is no user or the RBAC service is
 * unavailable — callers MUST treat `undefined` as "no bypass" (fail closed).
 *
 * RESERVED FOR v2 — NOT called by any v1 read path. v1 is strict owner-only, so
 * the read routes pass `userFeatures: undefined` to the filters rather than
 * resolving features here (which would be a wasted RBAC round-trip). Re-wire
 * only under an explicit v2 oversight spec.
 */
export async function resolveCallerEmailFeatures(
  container: { resolve: (name: string) => unknown },
  userId: string | null,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string[] | undefined> {
  if (!userId) return undefined
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return undefined
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return undefined
  }
}

/**
 * MikroORM equivalent of {@link applyEmailVisibilityFilter}. Returns a
 * `FilterQuery` fragment to merge (implicit AND) into a `CustomerInteraction`
 * where-clause so private email rows are excluded for non-owner, non-admin
 * callers on MikroORM read paths (`findWithDecryption`/`em.find`/`em.count`).
 *
 * Mirrors the kysely predicate exactly, including the legacy `visibility IS NULL`
 * passthrough so pre-existing CRM history is never hidden. Personal mailbox
 * privacy (v1: strict owner-only): no admin bypass — a private email is hidden
 * from everyone except its author. `opts.userFeatures` is reserved for v2.
 */
export type EmailVisibilityMikroFilter = { $or?: FilterQuery<CustomerInteraction>[] }

export function buildEmailVisibilityMikroFilter(
  opts: ApplyEmailVisibilityFilterOptions,
): EmailVisibilityMikroFilter {
  return {
    $or: [
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
      ...(opts.currentUserId ? [{ authorUserId: opts.currentUserId }] : []),
    ],
  }
}
