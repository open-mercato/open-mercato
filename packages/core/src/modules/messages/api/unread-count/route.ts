import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { runWithCacheTenant } from '@open-mercato/cache'
import { buildCollectionTags, isCrudCacheEnabled, resolveCrudCache } from '@open-mercato/shared/lib/crud/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { resolveChannelInboxPredicate } from '../../lib/channelThreadWidening'
import { channelInboxWideningClause, type MessagesParticipantScopeDatabase } from '../../lib/participantScope'
import { resolveMessageContext } from '../../lib/routeHelpers'
import { unreadCountResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true },
}

const UNREAD_COUNT_RESOURCE = 'messages.message'
const UNREAD_COUNT_TTL_MS = 10_000

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const orgId = scope.organizationId ?? null
  const channelInboxPredicate = await resolveChannelInboxPredicate(ctx.container, {
    userId: scope.userId,
    tenantId: scope.tenantId,
    organizationId: orgId,
  })

  const cache = !channelInboxPredicate && isCrudCacheEnabled() ? resolveCrudCache(ctx.container) : null
  const cacheKey = `messages:unread-count:v2:u=${scope.userId}:org=${orgId ?? 'null'}`
  if (cache) {
    const cached = await runWithCacheTenant(scope.tenantId, () => cache.get(cacheKey))
    if (typeof cached === 'number') return Response.json({ unreadCount: cached })
  }

  const em = ctx.container.resolve<EntityManager>('em')
  const db = em.getKysely<MessagesParticipantScopeDatabase>()
  const scopedMessages = db
    .selectFrom('messages as m')
    .where('m.tenant_id', '=', scope.tenantId)
    .where('m.deleted_at', 'is', null)
    .where((eb) => orgId
      ? eb('m.organization_id', '=', orgId)
      : eb('m.organization_id', 'is', null))
  const recipients = scopedMessages
    .innerJoin('message_recipients as r', 'r.message_id', 'm.id')
    .where('r.recipient_user_id', '=', scope.userId)
    .where('r.status', '=', 'unread')
    .where('r.deleted_at', 'is', null)
    .where('r.archived_at', 'is', null)
  const messages = channelInboxPredicate
    ? recipients.select('m.id').unionAll(
        scopedMessages
          .where('m.is_draft', '=', false)
          .where((eb) => channelInboxWideningClause(eb, scope.userId, channelInboxPredicate))
          .select('m.id'),
      ).as('unread_messages')
    : null
  const count = sql<string | number>`count(*)`.as('count')
  const query = messages ? db.selectFrom(messages).select(count) : recipients.select(count)
  const row = await query.executeTakeFirst()
  const unreadCount = Number(row?.count ?? 0)

  if (cache) {
    try {
      await runWithCacheTenant(scope.tenantId, () =>
        cache.set(cacheKey, unreadCount, {
          ttl: UNREAD_COUNT_TTL_MS,
          tags: buildCollectionTags(UNREAD_COUNT_RESOURCE, scope.tenantId, [orgId]),
        }),
      )
    } catch {}
  }
  return Response.json({ unreadCount })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'Get unread message count',
      responses: [
        {
          status: 200,
          description: 'Unread count',
          schema: unreadCountResponseSchema,
        },
      ],
    },
  },
}
