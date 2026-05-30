import type { FilterQuery } from '@mikro-orm/postgresql'
import { hasFeature } from '@open-mercato/shared/security/features'
import { CustomerInteraction } from '../data/entities'

/**
 * The ACL feature that grants admins the right to see private emails authored
 * by other users. Declared in `acl.ts` and default-granted to `admin` only.
 */
export const EMAIL_VIEW_PRIVATE_FEATURE = 'customers.email.view_private'

/**
 * Returns true when the caller can see ALL private email interactions (e.g. an
 * admin doing incident response or audit). Honours wildcards (`customers.*`, `*`).
 */
export function callerHasEmailViewPrivate(userFeatures: string[] | null | undefined): boolean {
  if (!Array.isArray(userFeatures) || userFeatures.length === 0) return false
  return hasFeature(userFeatures, EMAIL_VIEW_PRIVATE_FEATURE)
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
 *     `authorUserId` (channel owner) OR to callers with admin bypass.
 *
 * The function expects a kysely-style builder whose `.where()` accepts an
 * expression-builder callback. Returns the same builder for chaining.
 */
export function applyEmailVisibilityFilter<T extends { where: (...args: any[]) => T }>(
  query: T,
  opts: ApplyEmailVisibilityFilterOptions,
): T {
  if (callerHasEmailViewPrivate(opts.userFeatures)) return query
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
 * Resolve the caller's granted features (wildcard-aware downstream) so a
 * visibility filter can honour the `customers.email.view_private` admin bypass.
 * Returns `undefined` when there is no user or the RBAC service is unavailable —
 * callers MUST treat `undefined` as "no bypass" (fail closed).
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
 * Returns an empty fragment (no-op) for admins holding the view-private bypass.
 * Mirrors the kysely predicate exactly, including the legacy `visibility IS NULL`
 * passthrough so pre-existing CRM history is never hidden.
 */
export type EmailVisibilityMikroFilter = { $or?: FilterQuery<CustomerInteraction>[] }

export function buildEmailVisibilityMikroFilter(
  opts: ApplyEmailVisibilityFilterOptions,
): EmailVisibilityMikroFilter {
  if (callerHasEmailViewPrivate(opts.userFeatures)) return {}
  return {
    $or: [
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
      ...(opts.currentUserId ? [{ authorUserId: opts.currentUserId }] : []),
    ],
  }
}
