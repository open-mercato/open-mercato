import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgresEntityManager } from '@mikro-orm/postgresql'
import { MessageRecipient } from '../data/entities'
import { resolveChannelInboxPredicate } from './channelThreadWidening'
import { channelInboxWideningClause } from './participantScope'
import type { MessageScope } from './routeHelpers'

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

/**
 * Give the caller their own recipient row on a channel-inbox message (#6106).
 *
 * The inbox lists an inbound message on an unassigned conversation for every
 * operator who may work the channel, but such a message has no recipient row, and
 * every per-user action (mark read / unread, archive, delete) is keyed on one.
 * Read state is per operator, so the row is created lazily, the first time the
 * caller opens or acts on the message:
 *
 *   - until then the list reports the message as `unread` (a new customer message
 *     is flagged as new) and `unread-count` counts it;
 *   - from then on the message takes the normal recipient branch, so read,
 *     archive and delete behave exactly as for any other inbox message — and it
 *     stays out of the inbox for this operator once archived or deleted, because
 *     the widening clause only matches callers with no row at all;
 *   - other operators are untouched: each gets their own row on their own first
 *     open.
 *
 * The row is only created when the message matches the very clause the list uses
 * ({@link channelInboxWideningClause}), so nothing outside the inbox listing can
 * ever be materialised. Returns the caller's live recipient row, or `null` when the
 * message is not a channel-inbox message for them (or they deleted their row).
 */
export async function ensureChannelInboxRecipient(
  container: ContainerLike,
  em: EntityManager,
  scope: MessageScope,
  messageId: string,
): Promise<MessageRecipient | null> {
  if (!scope.userId || !scope.tenantId) return null

  const predicate = await resolveChannelInboxPredicate(container, scope)
  if (!predicate) return null

  const db = (em as PostgresEntityManager).getKysely<any>()
  let query = db
    .selectFrom('messages as m')
    .select('m.id')
    .where('m.id', '=', messageId)
    .where('m.tenant_id', '=', scope.tenantId)
    .where('m.deleted_at', 'is', null)
    .where('m.is_draft', '=', false)
  query = scope.organizationId
    ? query.where('m.organization_id', '=', scope.organizationId)
    : query.where('m.organization_id', 'is', null)
  const eligible = await query
    .where((eb: any) => channelInboxWideningClause(eb, scope.userId, predicate))
    .executeTakeFirst()
  if (!eligible) return null

  try {
    const writeEm = em.fork()
    writeEm.persist(
      writeEm.create(MessageRecipient, {
        messageId,
        recipientUserId: scope.userId,
        recipientType: 'to',
        status: 'unread',
      }),
    )
    await writeEm.flush()
  } catch {
    // A concurrent first open created the row (unique on message + user): fall
    // through and read it back.
  }

  return em.findOne(MessageRecipient, {
    messageId,
    recipientUserId: scope.userId,
    deletedAt: null,
  })
}
