import type { Expression, ExpressionBuilder, SqlBool } from 'kysely'
import { sql } from 'kysely'

export type ChannelInboxScope = {
  tenantId: string
  organizationId: string | null
}

export type ChannelInboxActor = {
  userId: string | null
}

/**
 * SQL predicate over the outer `messages as m` row: "this is a customer message on
 * an unassigned conversation of a channel the actor may work" (#6106).
 *
 * The `messages` inbox list widens its participant rule with this predicate instead
 * of collecting thread ids, so there is no scan, no cap and nothing to truncate. It
 * is the list-shaped counterpart of {@link resolveChannelThreadAccess}, and it is
 * deliberately never wider than that facade:
 *
 *   - **Inbound only** — the message carries an inbound `message_channel_links` row.
 *     An operator's own reply, a `send-as-user` message and an internal note have no
 *     inbound link and never match.
 *   - **Unassigned only** — the thread mapping has `assigned_user_id IS NULL`. A
 *     conversation routed to a colleague stays on that colleague's recipient row.
 *   - **Channel-owner rule** — the channel is live in the caller's scope and is
 *     either shared (`user_id IS NULL`) or owned by the actor. This mirrors
 *     {@link assertCanAccessChannel} and {@link channelOwnerScopeWhere}; a personal
 *     mailbox of someone else never matches.
 *   - Tenant and organization scoped exactly like `resolveChannelThreadAccess`
 *     (mapping: the caller's organization; channel: the organization or tenant-wide).
 *
 * Callers own the `messages`-side conditions (`visibility`, `source_entity_type`,
 * the actor having no recipient row) and the `messages.view` RBAC gate: the channel
 * owner rule grants every shared channel regardless of features.
 *
 * The outer message MUST be aliased `m` (columns `m.id`, `m.thread_id`).
 * Exposed through DI as `communicationChannelsBuildChannelInboxPredicate`.
 */
export function buildChannelInboxPredicate(
  eb: ExpressionBuilder<any, any>,
  scope: ChannelInboxScope,
  actor: ChannelInboxActor,
): Expression<SqlBool> {
  const organizationId = scope.organizationId ?? null

  const inboundLinkExists = eb.exists(
    eb
      .selectFrom('message_channel_links as mcl')
      .select(sql<number>`1`.as('one'))
      .whereRef('mcl.message_id', '=', 'm.id')
      .where('mcl.direction', '=', 'inbound')
      .where('mcl.tenant_id', '=', scope.tenantId),
  )

  const unassignedAccessibleThreadExists = eb.exists(
    eb
      .selectFrom('channel_thread_mappings as ctm')
      .innerJoin('communication_channels as cc', 'cc.id', 'ctm.channel_id')
      .select(sql<number>`1`.as('one'))
      .whereRef('ctm.message_thread_id', '=', 'm.thread_id')
      .where('ctm.tenant_id', '=', scope.tenantId)
      .where((cond) =>
        organizationId
          ? cond('ctm.organization_id', '=', organizationId)
          : cond('ctm.organization_id', 'is', null),
      )
      .where('ctm.assigned_user_id', 'is', null)
      .where('cc.tenant_id', '=', scope.tenantId)
      .where('cc.deleted_at', 'is', null)
      .where((cond) =>
        organizationId
          ? cond.or([cond('cc.organization_id', '=', organizationId), cond('cc.organization_id', 'is', null)])
          : cond('cc.organization_id', 'is', null),
      )
      .where((cond) =>
        actor.userId
          ? cond.or([cond('cc.user_id', 'is', null), cond('cc.user_id', '=', actor.userId)])
          : cond('cc.user_id', 'is', null),
      ),
  )

  return eb.and([inboundLinkExists, unassignedAccessibleThreadExists])
}

/** DI service type for cross-module callers (resolve `communicationChannelsBuildChannelInboxPredicate`). */
export type BuildChannelInboxPredicateService = typeof buildChannelInboxPredicate
