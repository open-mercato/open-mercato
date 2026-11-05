import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { runWithCacheTenant } from '@open-mercato/cache'
import {
  buildCollectionTags,
  isCrudCacheEnabled,
  resolveCrudCache,
} from '@open-mercato/shared/lib/crud/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { resolveMessageContext } from '../../lib/routeHelpers'
import { unreadCountResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true },
}

const UNREAD_COUNT_RESOURCE = 'messages.message'
const UNREAD_COUNT_TTL_MS = 10_000

function buildUnreadCountCacheKey(params: {
  userId: string
  orgId: string | null
}): string {
  return `messages:unread-count:u=${params.userId}:org=${params.orgId ?? 'null'}`
}

function getDb(em: EntityManager): Kysely<any> {
  return em.getKysely<any>()
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = ctx.container.resolve('em') as EntityManager
  const db = getDb(em) as any

  const orgId = scope.organizationId ?? null
  const cache = isCrudCacheEnabled() ? resolveCrudCache(ctx.container) : null
  const cacheKey = cache
    ? buildUnreadCountCacheKey({ userId: scope.userId, orgId })
    : null

  if (cache && cacheKey) {
    const cached = await runWithCacheTenant(scope.tenantId, () => cache.get(cacheKey))
    if (typeof cached === 'number') {
      return Response.json({ unreadCount: cached })
    }
  }

  let query = db
    .selectFrom('message_recipients as r')
    .innerJoin('messages as m', 'm.id', 'r.message_id')
    .where('r.recipient_user_id', '=', scope.userId)
    .where('r.status', '=', 'unread')
    .where('r.deleted_at', 'is', null)
    .where('r.archived_at', 'is', null)
    .where('m.tenant_id', '=', scope.tenantId)
    .where('m.deleted_at', 'is', null)

  if (scope.organizationId) {
    query = query.where('m.organization_id', '=', scope.organizationId)
  } else {
    query = query.where('m.organization_id', 'is', null)
  }

  const row = await query
    .select(sql<number>`count(*)`.as('count'))
    .executeTakeFirst() as { count: string | number } | undefined
  const count = Number(row?.count ?? 0)

  if (cache && cacheKey) {
    try {
      await runWithCacheTenant(scope.tenantId, () =>
        cache.set(cacheKey, count, {
          ttl: UNREAD_COUNT_TTL_MS,
          tags: buildCollectionTags(UNREAD_COUNT_RESOURCE, scope.tenantId, [orgId]),
        }),
      )
    } catch {}
  }

  return Response.json({ unreadCount: count })
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
