import type { FilterQuery } from '@mikro-orm/postgresql'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { CustomerInteraction } from '../data/entities'
import type { ConversationShareGrant } from './conversationShares'

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
  return authorizeFeatures([EMAIL_VIEW_PRIVATE_FEATURE], {
    grantedFeatures: userFeatures,
  })
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
  /**
   * Conversation shares that widen what this caller may read: each grant means
   * "the owner of this mailbox handed their email history with this Person to the
   * team" (`lib/conversationShares.ts`).
   *
   * OPTIONAL and fail-closed by design — omitting it (or passing `[]`) yields the
   * byte-identical strict owner-only predicate that shipped in v1, so a read path
   * that has not been taught about sharing can only ever under-share.
   */
  sharedConversations?: ConversationShareGrant[]
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
  const grants = opts.sharedConversations ?? []
  return query.where((eb: any) =>
    eb.or([
      eb('interaction_type', '!=', 'email'),
      eb('visibility', 'is', null),
      eb('visibility', '!=', 'private'),
      currentUserId
        ? eb('author_user_id', '=', currentUserId)
        : eb.val(false),
      // Conversation shares: the owner handed their history with this Person to
      // the team. One arm per grant, each an AND of the two columns the covering
      // index already leads with.
      ...grants.map((grant) =>
        eb.and([
          eb('entity_id', '=', grant.personEntityId),
          eb('author_user_id', '=', grant.ownerUserId),
        ]),
      ),
    ]),
  )
}

/**
 * Row-level predicate: is this email interaction HIDDEN from the caller?
 *
 * The exact logical complement of {@link applyEmailVisibilityFilter}, extracted so
 * every enforcement point derives from one definition of the rule. Any change to
 * the visibility predicate MUST be mirrored here and in
 * {@link applyEmailHiddenFilter} in the same commit — the unit tests assert the
 * three agree on a shared row matrix.
 */
export function isEmailHiddenFrom(opts: {
  interactionType: string | null | undefined
  visibility: string | null | undefined
  authorUserId: string | null | undefined
  currentUserId: string | null | undefined
  /** The Person this interaction is anchored to; required to match a share grant. */
  personEntityId?: string | null | undefined
  sharedConversations?: ConversationShareGrant[]
}): boolean {
  if (opts.interactionType !== 'email') return false
  if (opts.visibility !== 'private') return false
  if (opts.currentUserId && opts.authorUserId && opts.authorUserId === opts.currentUserId) {
    return false
  }
  const grants = opts.sharedConversations ?? []
  if (grants.length > 0 && opts.personEntityId && opts.authorUserId) {
    const shared = grants.some(
      (grant) =>
        grant.personEntityId === opts.personEntityId && grant.ownerUserId === opts.authorUserId,
    )
    if (shared) return false
  }
  return true
}

/**
 * Kysely complement of {@link applyEmailVisibilityFilter}: narrows a query to the
 * email rows the caller may NOT read. Used to count another user's private email
 * without duplicating the rule in raw SQL.
 *
 * Note the SQL NULL semantics deliberately preserved from the original inline
 * query: `author_user_id != caller` does not match rows whose author is NULL, so a
 * private row with no author is neither visible nor counted. Private rows always
 * carry the channel owner as author, so this is unreachable in practice; it is
 * documented rather than "fixed" so counts do not shift silently.
 */
export function applyEmailHiddenFilter<T extends { where: (...args: any[]) => T }>(
  query: T,
  opts: ApplyEmailVisibilityFilterOptions,
): T {
  const currentUserId = opts.currentUserId
  const grants = opts.sharedConversations ?? []
  return query
    .where('interaction_type', '=', 'email')
    .where('visibility', '=', 'private')
    .where((eb: any) =>
      currentUserId ? eb('author_user_id', '!=', currentUserId) : eb.val(true),
    )
    // Subtract the shared conversations. Without this the Person page would keep
    // reporting "3 private emails" for emails the caller can now actually read.
    .where((eb: any) =>
      grants.length === 0
        ? eb.val(true)
        : eb.and(
            grants.map((grant) =>
              eb.or([
                eb('entity_id', '!=', grant.personEntityId),
                eb('author_user_id', '!=', grant.ownerUserId),
              ]),
            ),
          ),
    )
}

type RbacServiceLike = {
  getEffectiveFeatures?: (
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
    if (!rbac?.getEffectiveFeatures) return undefined
    return await rbac.getEffectiveFeatures(userId, { tenantId, organizationId })
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
/**
 * @deprecated Use {@link EmailVisibilityFilterFragment}. The old shape exposed
 * `$or` as the only possible key, which invited callers to consume the fragment
 * as `where.$or = build(...).$or` and silently drop any other arm the predicate
 * grows. Retained for one minor per the deprecation protocol in
 * `BACKWARD_COMPATIBILITY.md`.
 */
export type EmailVisibilityMikroFilter = EmailVisibilityFilterFragment

/**
 * Opaque where-fragment to merge (implicit AND) into a `CustomerInteraction`
 * where-clause. Callers MUST merge the WHOLE fragment — `{ ...fragment }` or
 * `Object.assign(where, fragment)` — and never cherry-pick a single key, so the
 * predicate can grow arms without leaking private rows at compile-clean call
 * sites.
 */
export type EmailVisibilityFilterFragment = { $or: FilterQuery<CustomerInteraction>[] }

export function buildEmailVisibilityMikroFilter(
  opts: ApplyEmailVisibilityFilterOptions,
): EmailVisibilityFilterFragment {
  // Deliberately a SINGLE `$or` key. Several callers merge this fragment by
  // object spread into a where-clause that may itself carry other keys; keeping
  // the whole predicate inside one `$or` means such a spread can never split the
  // predicate into independently-satisfiable arms. Any future widening MUST be
  // added as another arm of THIS `$or`, not as a sibling top-level key.
  const grants = opts.sharedConversations ?? []
  return {
    $or: [
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
      ...(opts.currentUserId ? [{ authorUserId: opts.currentUserId }] : []),
      // Mirrors the kysely share arm: one AND-pair per grant, kept flat inside
      // this single `$or` so the fragment stays a one-key object.
      ...grants.map((grant) => ({
        entity: grant.personEntityId,
        authorUserId: grant.ownerUserId,
      })),
    ],
  } as EmailVisibilityFilterFragment
}
