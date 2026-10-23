import type { ExpressionBuilder, SelectQueryBuilder } from 'kysely'

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
 * The channel-thread widening clause (#6106): a public message on a channel thread
 * the actor may act on is visible to them even without a participant row. Internal
 * and non-public messages never take this branch — the same "not explicitly public"
 * rule the single-record detail route applies. An empty id list yields no clause.
 *
 * Exported so the list route can use it inside its own inbox predicate and so the
 * widening rule lives in exactly one place.
 */
export function channelThreadVisibilityClause<E extends ExpressionBuilder<MessagesFrom, 'm'>>(
  eb: E,
  channelThreadIds: readonly string[],
) {
  return eb.and([
    eb('m.thread_id', 'in', [...channelThreadIds]),
    eb('m.visibility', '=', 'public'),
  ])
}

/**
 * Apply the shared message participant-scope predicate to a query already built
 * from `messages as m`. A message is visible to `userId` when they are the
 * sender OR a non-deleted recipient. The recipient soft-delete rule
 * (`r.deleted_at is null`) lives inside the recipient join, so it is part of the
 * single source of truth — the recipient-visibility boundary cannot drift
 * between the list route and the enricher.
 *
 * `channelThreadIds` widens the predicate to public messages on channel threads
 * the caller may act on (see {@link channelThreadVisibilityClause}). Callers that
 * do not resolve such threads pass nothing and keep the participant-only rule.
 *
 * Message-level tenant / organization / soft-delete scoping stays with the
 * caller (both call sites already apply it uniformly to every query).
 */
export function applyMessageParticipantScope<O>(
  query: SelectQueryBuilder<MessagesFrom, 'm', O>,
  userId: string,
  channelThreadIds: readonly string[] = [],
): SelectQueryBuilder<MessagesJoinedFrom, 'm' | 'r', O> {
  return query
    .leftJoin('message_recipients as r', (join) =>
      join
        .onRef('m.id', '=', 'r.message_id')
        .on('r.recipient_user_id', '=', userId)
        .on('r.deleted_at', 'is', null),
    )
    .where((eb) => {
      const branches = [
        eb('m.sender_user_id', '=', userId),
        eb('r.message_id', 'is not', null),
      ]
      if (channelThreadIds.length > 0) {
        branches.push(channelThreadVisibilityClause(eb, channelThreadIds))
      }
      return eb.or(branches)
    }) as unknown as SelectQueryBuilder<MessagesJoinedFrom, 'm' | 'r', O>
}
