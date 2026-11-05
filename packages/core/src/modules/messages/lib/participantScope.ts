import type { SelectQueryBuilder } from 'kysely'

/**
 * Minimal Kysely schema contract the message participant-scope predicate depends
 * on. Both the messages list route (`api/route.ts`, `all` folder) and the
 * `communication_channels.message-channel` response enricher build their
 * sender-OR-recipient access filter from {@link applyMessageParticipantScope},
 * so a column rename (`sender_user_id`, `recipient_user_id`, `deleted_at`) or a
 * change to the recipient-visibility rules updates both call sites at once
 * instead of silently desyncing the enricher's security boundary from the list
 * route (#4133, follow-up to #4099).
 */
export type MessagesParticipantScopeDatabase = {
  messages: {
    id: string
    tenant_id: string
    organization_id: string | null
    sender_user_id: string
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
 * Apply the shared message participant-scope predicate to a query already built
 * from `messages as m`. A message is visible to `userId` when they are the
 * sender OR a non-deleted recipient. The recipient soft-delete rule
 * (`r.deleted_at is null`) lives inside the recipient join, so it is part of the
 * single source of truth — the recipient-visibility boundary cannot drift
 * between the list route and the enricher.
 *
 * Message-level tenant / organization / soft-delete scoping stays with the
 * caller (both call sites already apply it uniformly to every query), but the
 * shared {@link MessagesParticipantScopeDatabase} type keeps those column names
 * coupled at compile time as well.
 */
export function applyMessageParticipantScope<O>(
  query: SelectQueryBuilder<MessagesFrom, 'm', O>,
  userId: string,
): SelectQueryBuilder<MessagesJoinedFrom, 'm' | 'r', O> {
  return query
    .leftJoin('message_recipients as r', (join) =>
      join
        .onRef('m.id', '=', 'r.message_id')
        .on('r.recipient_user_id', '=', userId)
        .on('r.deleted_at', 'is', null),
    )
    .where((eb) =>
      eb.or([
        eb('m.sender_user_id', '=', userId),
        eb('r.message_id', 'is not', null),
      ]),
    ) as unknown as SelectQueryBuilder<MessagesJoinedFrom, 'm' | 'r', O>
}
