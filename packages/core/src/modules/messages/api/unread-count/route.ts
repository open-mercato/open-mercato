import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { resolveMessageContext } from '../../lib/routeHelpers'
import { unreadCountResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.view'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = ctx.container.resolve('em') as EntityManager
  const knex = getKnex(em)

  let query = knex('message_recipients as r')
    .join('messages as m', 'm.id', 'r.message_id')
    .where('r.recipient_user_id', scope.userId)
    .where('r.status', 'unread')
    .whereNull('r.deleted_at')
    .whereNull('r.archived_at')
    .where('m.tenant_id', scope.tenantId)
    .whereNull('m.deleted_at')

  if (scope.organizationId) {
    query = query.where('m.organization_id', scope.organizationId)
  } else {
    query = query.whereNull('m.organization_id')
  }

  const row = await query.count('* as count').first<{ count: string | number }>()
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
