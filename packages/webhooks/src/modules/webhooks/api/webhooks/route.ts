import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { WebhookEntity } from '../../data/entities'
import { webhookCreateSchema, webhookUpdateSchema, webhookListQuerySchema } from '../../data/validators'
import { generateWebhookSecret } from '@open-mercato/shared/lib/webhooks'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { WebhookCreateInput, WebhookUpdateInput } from '../../data/validators'

type WebhookCrudCtx = CrudCtx & {
  __webhookSecret?: string
}

function json(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

const webhookListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  subscribedEvents: z.array(z.string()),
  httpMethod: z.string(),
  isActive: z.boolean(),
  deliveryStrategy: z.string(),
  maxRetries: z.number(),
  consecutiveFailures: z.number(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const webhookCollectionResponseSchema = z.object({
  items: z.array(webhookListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
})

const webhookCreateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  secret: z.string(),
  subscribedEvents: z.array(z.string()),
  isActive: z.boolean(),
})

const webhookDetailResponseSchema = webhookListItemSchema.extend({
  customHeaders: z.record(z.string(), z.string()).nullable(),
  strategyConfig: z.record(z.string(), z.unknown()).nullable(),
  timeoutMs: z.number(),
  rateLimitPerMinute: z.number(),
  autoDisableThreshold: z.number(),
  integrationId: z.string().nullable(),
})

const deleteResponseSchema = z.object({ success: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

const crud = makeCrudRoute<WebhookCreateInput, WebhookUpdateInput, z.infer<typeof webhookListQuerySchema>>({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
    POST: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
  },
  orm: { entity: WebhookEntity, orgField: 'organizationId' },
  events: { module: 'webhooks', entity: 'webhook', persistent: true },
  list: { schema: webhookListQuerySchema },
  create: {
    schema: webhookCreateSchema,
    mapToEntity: (input, ctx) => {
      const scopedCtx = ctx as WebhookCrudCtx
      const secret = scopedCtx.__webhookSecret
      if (!secret) throw new Error('Webhook secret not prepared')
      return {
        name: input.name,
        description: input.description ?? null,
        url: input.url,
        secret,
        subscribedEvents: input.subscribedEvents,
        httpMethod: input.httpMethod ?? 'POST',
        customHeaders: input.customHeaders ?? null,
        deliveryStrategy: input.deliveryStrategy ?? 'http',
        strategyConfig: input.strategyConfig ?? null,
        maxRetries: input.maxRetries ?? 10,
        timeoutMs: input.timeoutMs ?? 15000,
        rateLimitPerMinute: input.rateLimitPerMinute ?? 0,
        autoDisableThreshold: input.autoDisableThreshold ?? 100,
        integrationId: input.integrationId ?? null,
        organizationId: ctx.auth?.orgId ?? '',
        tenantId: ctx.auth?.tenantId ?? '',
      }
    },
    response: (entity) => ({
      id: entity.id,
      name: entity.name,
      url: entity.url,
      secret: (entity as WebhookEntity & { __revealSecret?: string }).__revealSecret ?? '***',
      subscribedEvents: entity.subscribedEvents,
      isActive: entity.isActive,
    }),
  },
  update: {
    schema: webhookUpdateSchema,
    applyToEntity: (entity, input) => {
      if (input.name !== undefined) entity.name = input.name
      if (input.description !== undefined) entity.description = input.description
      if (input.url !== undefined) entity.url = input.url
      if (input.subscribedEvents !== undefined) entity.subscribedEvents = input.subscribedEvents
      if (input.httpMethod !== undefined) entity.httpMethod = input.httpMethod
      if (input.customHeaders !== undefined) entity.customHeaders = input.customHeaders
      if (input.deliveryStrategy !== undefined) entity.deliveryStrategy = input.deliveryStrategy
      if (input.strategyConfig !== undefined) entity.strategyConfig = input.strategyConfig
      if (input.maxRetries !== undefined) entity.maxRetries = input.maxRetries
      if (input.timeoutMs !== undefined) entity.timeoutMs = input.timeoutMs
      if (input.rateLimitPerMinute !== undefined) entity.rateLimitPerMinute = input.rateLimitPerMinute
      if (input.autoDisableThreshold !== undefined) entity.autoDisableThreshold = input.autoDisableThreshold
      if (input.integrationId !== undefined) entity.integrationId = input.integrationId
      if (input.isActive !== undefined) entity.isActive = input.isActive
    },
  },
  del: { idFrom: 'query' },
  hooks: {
    beforeList: async (query, ctx) => {
      const auth = ctx.auth
      const { translate } = await resolveTranslations()
      if (!auth?.tenantId) throw json({ error: translate('webhooks.errors.tenantRequired', 'Tenant context required') }, { status: 400 })

      const page = Math.max(parseInt(query.page ?? '1', 10) || 1, 1)
      const pageSize = Math.min(Math.max(parseInt(query.pageSize ?? '20', 10) || 20, 1), 100)
      const search = (query.search ?? '').trim().toLowerCase()

      const organizationIds = Array.isArray(ctx.organizationIds) ? ctx.organizationIds : null
      if (organizationIds && organizationIds.length === 0) {
        throw json({ items: [], total: 0, page, pageSize, totalPages: 0 })
      }

      const em = ctx.container.resolve('em') as EntityManager
      const qb = em.createQueryBuilder(WebhookEntity, 'w')
      qb.where({ deletedAt: null })
      qb.andWhere({ tenantId: auth.tenantId })

      if (organizationIds && organizationIds.length > 0) {
        qb.andWhere({ organizationId: { $in: organizationIds } })
      } else if (auth.orgId) {
        qb.andWhere({ organizationId: auth.orgId })
      }

      if (search) {
        const pattern = `%${escapeLikePattern(search)}%`
        qb.andWhere({
          $or: [
            { name: { $ilike: pattern } },
            { url: { $ilike: pattern } },
          ],
        })
      }

      if (query.isActive !== undefined && query.isActive !== '') {
        const active = parseBooleanToken(query.isActive)
        if (active !== null) {
          qb.andWhere({ isActive: active })
        }
      }

      qb.orderBy({ createdAt: 'desc' })
      qb.limit(pageSize).offset((page - 1) * pageSize)
      const [items, total] = await qb.getResultAndCount()

      const payload = {
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description ?? null,
          url: item.url,
          subscribedEvents: item.subscribedEvents,
          httpMethod: item.httpMethod,
          isActive: item.isActive,
          deliveryStrategy: item.deliveryStrategy,
          maxRetries: item.maxRetries,
          consecutiveFailures: item.consecutiveFailures,
          lastSuccessAt: item.lastSuccessAt?.toISOString() ?? null,
          lastFailureAt: item.lastFailureAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }

      throw json(payload)
    },
    beforeCreate: async (input, ctx) => {
      const auth = ctx.auth
      const { translate } = await resolveTranslations()
      if (!auth?.tenantId) throw json({ error: translate('webhooks.errors.tenantRequired', 'Tenant context required') }, { status: 400 })
      if (!auth?.orgId) throw json({ error: translate('webhooks.errors.orgRequired', 'Organization context required') }, { status: 400 })

      const scopedCtx = ctx as WebhookCrudCtx
      scopedCtx.__webhookSecret = generateWebhookSecret()

      return input
    },
    afterCreate: async (entity, ctx) => {
      const scopedCtx = ctx as WebhookCrudCtx
      if (scopedCtx.__webhookSecret) {
        ;(entity as WebhookEntity & { __revealSecret?: string }).__revealSecret = scopedCtx.__webhookSecret
      }
    },
    beforeDelete: async (id, ctx) => {
      const auth = ctx.auth
      const { translate } = await resolveTranslations()
      if (!auth?.tenantId) throw json({ error: translate('webhooks.errors.tenantRequired', 'Tenant context required') }, { status: 400 })

      const em = ctx.container.resolve('em') as EntityManager
      const record = await em.findOne(WebhookEntity, { id, deletedAt: null, tenantId: auth.tenantId })
      if (!record) throw json({ error: translate('webhooks.errors.notFound', 'Webhook not found') }, { status: 404 })

      const allowedIds = ctx.organizationScope?.allowedIds ?? null
      if (record.organizationId && Array.isArray(allowedIds) && allowedIds.length > 0) {
        if (!allowedIds.includes(record.organizationId)) {
          throw json({ error: translate('webhooks.errors.forbidden', 'Forbidden') }, { status: 403 })
        }
      }
    },
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi: OpenApiRouteDoc = {
  summary: 'Manage webhooks',
  description: 'CRUD operations for webhook endpoints following the Standard Webhooks specification.',
  methods: {
    GET: {
      summary: 'List webhooks',
      description: 'Returns paginated webhooks for the current tenant and organization.',
      query: webhookListQuerySchema,
      responses: [{ status: 200, description: 'Webhook collection', schema: webhookCollectionResponseSchema }],
      errors: [
        { status: 400, description: 'Tenant context missing', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Create webhook',
      description: 'Creates a new webhook endpoint. A signing secret (whsec_ prefixed) is auto-generated and returned once.',
      requestBody: { contentType: 'application/json', schema: webhookCreateSchema, description: 'Webhook configuration.' },
      responses: [{ status: 201, description: 'Webhook created', schema: webhookCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Update webhook',
      description: 'Updates an existing webhook configuration.',
      requestBody: { contentType: 'application/json', schema: webhookUpdateSchema, description: 'Fields to update.' },
      responses: [{ status: 200, description: 'Webhook updated', schema: webhookDetailResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 404, description: 'Not found', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete webhook',
      description: 'Soft-deletes a webhook endpoint.',
      query: z.object({ id: z.string().uuid().describe('Webhook ID to delete') }),
      responses: [{ status: 200, description: 'Deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 404, description: 'Not found', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
  },
}
