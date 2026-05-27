import { hasFeature } from '@open-mercato/shared/security/features'

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
  return query.where((eb: any) =>
    eb.or([
      eb('interaction_type', '!=', 'email'),
      eb('visibility', '=', 'shared'),
      eb.and([
        eb('visibility', '=', 'private'),
        currentUserId
          ? eb('author_user_id', '=', currentUserId)
          : eb.val(false),
      ]),
    ]),
  )
}
