import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { resolveMessageContext } from '../../lib/routeHelpers'
import { unreadCountResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true },
}

function getDb(em: EntityManager): Kysely<any> {
  return em.getKysely<any>()
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = ctx.container.resolve('em') as EntityManager
  const db = getDb(em) as any

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
