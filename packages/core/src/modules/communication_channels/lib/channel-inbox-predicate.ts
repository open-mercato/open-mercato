import type { Expression, SqlBool } from 'kysely'
import { expressionBuilder, sql } from 'kysely'
import type { ChannelInboxPredicate } from '../../messages/lib/participantScope'

type ChannelInboxDatabase = {
  m: { id: string; thread_id: string | null }
  message_channel_links: {
    message_id: string
    external_conversation_id: string | null
    direction: string
    tenant_id: string
    organization_id: string | null
  }
  channel_thread_mappings: {
    external_conversation_id: string
    message_thread_id: string
    channel_id: string
    tenant_id: string
    organization_id: string | null
    assigned_user_id: string | null
  }
  external_conversations: {
    id: string
    channel_id: string
    tenant_id: string
    organization_id: string | null
  }
  communication_channels: {
    id: string
    tenant_id: string
    organization_id: string | null
    user_id: string | null
    deleted_at: Date | null
  }
}

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
  _outer: Parameters<ChannelInboxPredicate>[0],
  scope: ChannelInboxScope,
  actor: ChannelInboxActor,
): Expression<SqlBool> {
  const eb = expressionBuilder<ChannelInboxDatabase, 'm'>()
  const organizationId = scope.organizationId ?? null

  return eb.exists(
    eb
      .selectFrom('message_channel_links as mcl')
      .innerJoin('channel_thread_mappings as ctm', (join) => join
        .onRef('ctm.external_conversation_id', '=', 'mcl.external_conversation_id')
        .onRef('ctm.tenant_id', '=', 'mcl.tenant_id'))
      .innerJoin('external_conversations as ec', (join) => join
        .onRef('ec.id', '=', 'mcl.external_conversation_id')
        .onRef('ec.channel_id', '=', 'ctm.channel_id')
        .onRef('ec.tenant_id', '=', 'ctm.tenant_id'))
      .innerJoin('communication_channels as cc', 'cc.id', 'ctm.channel_id')
      .select(sql<number>`1`.as('one'))
      .whereRef('mcl.message_id', '=', 'm.id')
      .whereRef('ctm.message_thread_id', '=', 'm.thread_id')
      .where('mcl.direction', '=', 'inbound')
      .where('mcl.tenant_id', '=', scope.tenantId)
      .where('ctm.tenant_id', '=', scope.tenantId)
      .where('ec.tenant_id', '=', scope.tenantId)
      .where((cond) =>
        organizationId
          ? cond('mcl.organization_id', '=', organizationId)
          : cond('mcl.organization_id', 'is', null),
      )
      .where((cond) =>
        organizationId
          ? cond('ctm.organization_id', '=', organizationId)
          : cond('ctm.organization_id', 'is', null),
      )
      .where((cond) =>
        organizationId
          ? cond('ec.organization_id', '=', organizationId)
          : cond('ec.organization_id', 'is', null),
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
}

/** DI service type for cross-module callers (resolve `communicationChannelsBuildChannelInboxPredicate`). */
export type BuildChannelInboxPredicateService = typeof buildChannelInboxPredicate
