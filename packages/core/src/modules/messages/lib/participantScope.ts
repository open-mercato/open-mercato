import { sql } from 'kysely'
import type { Expression, ExpressionBuilder, SelectQueryBuilder, SqlBool } from 'kysely'
import { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from './composeSourceChannelType'

/**
 * Minimal Kysely schema contract the message participant-scope predicate depends
 * on. Both the messages list route (`api/route.ts`) and the
 * `communication_channels.message-channel` response enricher build their access
 * filter from {@link applyMessageParticipantScope}, so a column rename or a change
 * to the visibility rules updates both call sites at once instead of silently
 * desyncing the enricher's security boundary from the list route (#4133, #4099).
 */
export type MessagesParticipantScopeDatabase = {
  messages: {
    id: string
    tenant_id: string
    organization_id: string | null
    sender_user_id: string
    thread_id: string | null
    visibility: string | null
    source_entity_type: string | null
    deleted_at: Date | null
  }
  message_recipients: {
    message_id: string
    recipient_user_id: string
    deleted_at: Date | null
  }
}

type MessagesTable = MessagesParticipantScopeDatabase['messages']
type MessageRecipientsTable = MessagesParticipantScopeDatabase['message_recipients']

type MessagesFrom = MessagesParticipantScopeDatabase & { m: MessagesTable }
type MessagesJoinedFrom = MessagesFrom & { r: MessageRecipientsTable }

/**
 * Channel-inbox predicate (#6106): a SQL condition over the outer `messages as m`
 * row, built by the channels hub through DI (`communicationChannelsBuildChannelInboxPredicate`)
 * and bound to the caller's scope by `resolveChannelInboxPredicate`. It answers
 * "inbound message on an unassigned conversation of a channel the caller may work".
 * `messages` never touches the hub's tables itself.
 */
export type ChannelInboxPredicate = (eb: ExpressionBuilder<any, any>) => Expression<SqlBool>

/**
 * The channel-inbox widening clause (#6106): a message the caller has no recipient
 * row for, that is listed anyway because it is an inbound message on an unassigned
 * conversation of a channel they may work.
 *
 * Every condition is part of the one clause so the list can never be wider than the
 * single-record read rule (`resolveMessageReadAccess`):
 *
 *   - `visibility = 'public'` — internal notes never widen (same "not explicitly
 *     public" rule the detail route applies);
 *   - `source_entity_type = communication_channels.external_conversation` — the only
 *     source type the detail route's channel fallback accepts;
 *   - the caller has **no recipient row at all**, deleted or not — a row the caller
 *     deleted or archived must not resurface through this branch. The `NOT EXISTS`
 *     deliberately has no `deleted_at` filter, unlike the participant join;
 *   - the hub predicate: inbound, unassigned, accessible channel.
 *
 * An operator's own replies, `send-as-user` messages and colleagues' assigned
 * conversations fail the hub predicate and never appear.
 *
 * Exported so the list route (inbox, `status=unread`), the unread counter and the
 * recipient-materialising helper all use the one clause.
 */
export function channelInboxWideningClause(
  eb: ExpressionBuilder<any, any>,
  userId: string,
  predicate: ChannelInboxPredicate,
): Expression<SqlBool> {
  return eb.and([
    eb('m.visibility', '=', 'public'),
    eb('m.source_entity_type', '=', EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE),
    eb.not(
      eb.exists(
        eb
          .selectFrom('message_recipients as rx')
          .select(sql<number>`1`.as('one'))
          .whereRef('rx.message_id', '=', 'm.id')
          .where('rx.recipient_user_id', '=', userId),
      ),
    ),
    predicate(eb),
  ])
}

/**
 * Apply the shared message participant-scope predicate to a query already built
 * from `messages as m`. A message is visible to `userId` when they are the
 * sender, a non-deleted recipient, or — when `channelInboxPredicate` is given —
 * the message is a channel-inbox message they may work (see
 * {@link channelInboxWideningClause}). It is the single source of truth — the
 * recipient-visibility boundary cannot drift between the list route and the
 * enricher.
 *
 * Callers that do not resolve a channel-inbox predicate (no `messages.view`, no
 * hub) pass nothing and keep the participant-only rule.
 *
 * Message-level tenant / organization / soft-delete scoping stays with the
 * caller (both call sites already apply it uniformly to every query), but the
 * shared {@link MessagesParticipantScopeDatabase} type keeps those column names
 * coupled at compile time as well.
 */
export function applyMessageParticipantScope<O>(
  query: SelectQueryBuilder<MessagesFrom, 'm', O>,
  userId: string,
  channelInboxPredicate?: ChannelInboxPredicate | null,
): SelectQueryBuilder<MessagesJoinedFrom, 'm' | 'r', O> {
  return query
    .leftJoin('message_recipients as r', (join) =>
      join
        .onRef('m.id', '=', 'r.message_id')
        .on('r.recipient_user_id', '=', userId)
        .on('r.deleted_at', 'is', null),
    )
    .where((eb) => {
      const branches: Expression<SqlBool>[] = [
        eb('m.sender_user_id', '=', userId),
        eb('r.message_id', 'is not', null),
      ]
      if (channelInboxPredicate) {
        branches.push(channelInboxWideningClause(eb as unknown as ExpressionBuilder<any, any>, userId, channelInboxPredicate))
      }
      return eb.or(branches)
    }) as unknown as SelectQueryBuilder<MessagesJoinedFrom, 'm' | 'r', O>
}
