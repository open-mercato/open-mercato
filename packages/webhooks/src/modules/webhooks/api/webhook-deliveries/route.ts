import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WebhookDeliveryEntity, WebhookEntity } from '../../data/entities'
import { webhookDeliveryQuerySchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeDeliveryListItem } from '../helpers'

function json(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

const deliveryItemSchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  webhookName: z.string().nullable(),
  eventType: z.string(),
  messageId: z.string(),
  status: z.string(),
  responseStatus: z.number().nullable(),
  errorMessage: z.string().nullable(),
  attemptNumber: z.number(),
  maxAttempts: z.number(),
  targetUrl: z.string(),
  durationMs: z.number().nullable(),
  enqueuedAt: z.string(),
  lastAttemptAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
})

const deliveryCollectionResponseSchema = z.object({
  items: z.array(deliveryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
})

const errorSchema = z.object({ error: z.string() })

const crud = makeCrudRoute<never, never, z.infer<typeof webhookDeliveryQuerySchema>>({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
  },
  orm: { entity: WebhookDeliveryEntity, orgField: 'organizationId' },
  list: { schema: webhookDeliveryQuerySchema },
  hooks: {
    beforeList: async (query, ctx) => {
      const auth = ctx.auth
      const { translate } = await resolveTranslations()
      if (!auth?.tenantId) throw json({ error: translate('webhooks.errors.tenantRequired', 'Tenant context required') }, { status: 400 })

      const page = query.page ?? 1
      const pageSize = Math.min(query.pageSize ?? 50, 100)

      const em = ctx.container.resolve('em') as EntityManager
      const qb = em.createQueryBuilder(WebhookDeliveryEntity, 'd')
      qb.where({ tenantId: auth.tenantId })

      const allowedIds = ctx.organizationScope?.allowedIds ?? null
      if (allowedIds && allowedIds.length > 0) {
        qb.andWhere({ organizationId: { $in: allowedIds } })
      } else if (auth.orgId) {
        qb.andWhere({ organizationId: auth.orgId })
      }

      if (query.webhookId) {
        qb.andWhere({ webhookId: query.webhookId })
      }

      if (query.eventType) {
        qb.andWhere({ eventType: query.eventType })
      }

      if (query.status) {
        qb.andWhere({ status: query.status })
      }

      qb.orderBy({ createdAt: 'desc' })
      qb.limit(pageSize).offset((page - 1) * pageSize)
      const [items, total] = await qb.getResultAndCount()
      const webhookIds = Array.from(new Set(items.map((item) => item.webhookId)))
      const webhooks = webhookIds.length > 0
        ? await findWithDecryption(
          em,
          WebhookEntity,
          {
            id: { $in: webhookIds },
            tenantId: auth.tenantId,
            deletedAt: null,
          },
          undefined,
          { tenantId: auth.tenantId, organizationId: auth.orgId ?? '' },
        )
        : []
      const webhookNames = new Map(webhooks.map((webhook) => [webhook.id, webhook.name]))

      const payload = {
        items: items.map((item) => serializeDeliveryListItem(item, {
          webhookName: webhookNames.get(item.webhookId) ?? null,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }

      throw json(payload)
    },
  },
})

export const metadata = crud.metadata
export const GET = crud.GET

export const openApi: OpenApiRouteDoc = {
  summary: 'Webhook delivery logs',
  description: 'View delivery attempts for webhook endpoints.',
  methods: {
    GET: {
      summary: 'List delivery logs',
      description: 'Returns paginated webhook delivery attempts with filtering by webhook, event type, and status.',
      query: webhookDeliveryQuerySchema,
      responses: [{ status: 200, description: 'Delivery log collection', schema: deliveryCollectionResponseSchema }],
      errors: [
        { status: 400, description: 'Tenant context missing', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
