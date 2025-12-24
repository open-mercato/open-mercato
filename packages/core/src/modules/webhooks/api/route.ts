import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Webhook } from '../data/entities'
import {
  createWebhookSchema,
  updateWebhookSchema,
  webhookFilterSchema,
  webhookDeliveryTypeSchema,
  retryConfigSchema,
  httpConfigSchema,
  sqsConfigSchema,
  snsConfigSchema,
  type UpdateWebhookInput,
} from '../data/validators'
import { generateWebhookSecret, DEFAULT_RETRY_CONFIG, DEFAULT_TIMEOUT } from '../services/webhookService'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/webhook'

// Route metadata for auth/feature requirements
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.list'] },
  POST: { requireAuth: true, requireFeatures: ['webhooks.create'] },
  PUT: { requireAuth: true, requireFeatures: ['webhooks.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['webhooks.delete'] },
}

/**
 * Mask sensitive fields in webhook config before returning.
 * Handles both top-level fields and nested objects (like headers).
 */
function maskSensitiveConfig(config: Record<string, any>): Record<string, any> {
  if (!config || typeof config !== 'object') return config

  const sensitiveFields = ['password', 'secretAccessKey', 'apiKey', 'token', 'secret', 'accessKeyId']
  const sensitiveHeaderPatterns = ['authorization', 'x-api-key', 'x-auth-token', 'bearer']

  function maskValue(obj: Record<string, any>, depth = 0): Record<string, any> {
    if (depth > 5) return obj // Prevent infinite recursion

    const masked: Record<string, any> = {}

    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase()

      // Check if this is a sensitive field
      if (sensitiveFields.some((f) => keyLower.includes(f.toLowerCase()))) {
        masked[key] = value ? '********' : value
      }
      // Check if this is a sensitive header key
      else if (sensitiveHeaderPatterns.some((p) => keyLower.includes(p))) {
        masked[key] = value ? '********' : value
      }
      // Recursively mask nested objects
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        masked[key] = maskValue(value, depth + 1)
      } else {
        masked[key] = value
      }
    }

    return masked
  }

  return maskValue(config)
}

/**
 * Build filters for the webhook list query.
 */
function buildWebhookFilters(query: z.infer<typeof webhookFilterSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}

  if (query.id) {
    filters.id = { $eq: query.id }
  }
  if (query.search) {
    filters.name = { $ilike: `%${query.search}%` }
  }
  if (query.deliveryType) {
    filters.delivery_type = query.deliveryType
  }
  if (query.active !== undefined) {
    filters.active = query.active
  }
  // Note: event filter not supported in QueryEngine (no $contains operator)
  // Client-side filtering can be used if needed

  return filters
}

// Response schemas for OpenAPI documentation
const webhookListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  deliveryType: webhookDeliveryTypeSchema,
  config: z.record(z.string(), z.any()),
  events: z.array(z.string()),
  active: z.boolean(),
  timeout: z.number(),
  retryConfig: retryConfigSchema,
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTriggeredAt: z.string().nullable(),
})

const webhookListResponseSchema = z.object({
  items: z.array(webhookListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
})

const webhookCreateResponseSchema = z.object({
  id: z.string().uuid(),
  secret: z.string().describe('Full webhook secret. Shown once for secure storage.'),
})

const okResponseSchema = z.object({ ok: z.literal(true) })
const errorResponseSchema = z.object({ error: z.string() })

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Webhook,
    idField: 'id',
    orgField: null, // No organization scoping for webhooks
    tenantField: 'tenantId',
    softDeleteField: null, // Hard delete only
  },
  list: {
    schema: webhookFilterSchema,
    entityId: E.webhooks.webhook,
    fields: [
      F.id,
      F.tenant_id,
      F.name,
      F.description,
      F.delivery_type,
      F.config,
      F.events,
      F.active,
      F.retry_config,
      F.timeout,
      F.created_at,
      F.updated_at,
      F.last_triggered_at,
    ],
    sortFieldMap: {
      id: F.id,
      name: F.name,
      deliveryType: F.delivery_type,
      active: F.active,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildWebhookFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      name: item.name,
      description: item.description ?? null,
      deliveryType: item.delivery_type,
      config: maskSensitiveConfig(item.config as Record<string, any>),
      events: item.events,
      active: item.active,
      timeout: item.timeout,
      retryConfig: item.retry_config,
      tenantId: item.tenant_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      lastTriggeredAt: item.last_triggered_at ?? null,
    }),
  },
  create: {
    schema: createWebhookSchema,
    mapToEntity: (input, ctx) => ({
      tenantId: ctx.auth!.tenantId!,
      name: input.name,
      description: input.description ?? null,
      deliveryType: input.deliveryType,
      config: input.config,
      secret: generateWebhookSecret(),
      events: input.events,
      active: input.active ?? true,
      retryConfig: input.retryConfig ?? DEFAULT_RETRY_CONFIG,
      timeout: input.timeout ?? DEFAULT_TIMEOUT,
    }),
    response: (entity) => ({ id: entity.id, secret: entity.secret }),
  },
  update: {
    schema: updateWebhookSchema,
    applyToEntity: (entity, input) => {
      if (input.name !== undefined) entity.name = input.name
      if (input.description !== undefined) entity.description = input.description
      if (input.deliveryType !== undefined) entity.deliveryType = input.deliveryType
      if (input.config !== undefined) entity.config = input.config as typeof entity.config
      if (input.events !== undefined) entity.events = input.events
      if (input.active !== undefined) entity.active = input.active
      if (input.retryConfig !== undefined) entity.retryConfig = input.retryConfig
      if (input.timeout !== undefined) entity.timeout = input.timeout
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'query',
    softDelete: false,
    response: () => ({ ok: true }),
  },
  hooks: {
    beforeUpdate: async (input: UpdateWebhookInput, ctx: CrudCtx) => {
      // Validate deliveryType change requires config
      if (input.deliveryType !== undefined) {
        const em = ctx.container.resolve('em') as EntityManager
        const existing = await em.findOne(Webhook, {
          id: input.id,
          tenantId: ctx.auth!.tenantId,
        })

        if (existing && input.deliveryType !== existing.deliveryType) {
          if (input.config === undefined) {
            throw new CrudHttpError(400, 'Config must be provided when changing deliveryType')
          }

          // Validate config against the new delivery type
          const configSchemas: Record<string, z.ZodType<any>> = {
            http: httpConfigSchema,
            sqs: sqsConfigSchema,
            sns: snsConfigSchema,
          }
          const schema = configSchemas[input.deliveryType]
          if (schema) {
            const result = schema.safeParse(input.config)
            if (!result.success) {
              const errors = result.error.issues.map((e) => `config.${e.path.join('.')}: ${e.message}`)
              throw new CrudHttpError(400, `Validation failed: ${errors.join(', ')}`)
            }
          }
        }
      }
      return input
    },
  },
})

export const metadata = routeMetadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Webhooks',
  summary: 'Webhook configuration management',
  methods: {
    GET: {
      summary: 'List webhooks',
      description:
        'Returns webhooks for the current tenant with filtering and pagination. Use ?id=<uuid> to get a single webhook.',
      query: webhookFilterSchema,
      responses: [{ status: 200, description: 'Webhooks collection', schema: webhookListResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Create webhook',
      description: 'Creates a new webhook configuration. Returns the generated secret once.',
      requestBody: { contentType: 'application/json', schema: createWebhookSchema },
      responses: [{ status: 201, description: 'Webhook created', schema: webhookCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update webhook',
      description: 'Updates an existing webhook configuration. ID must be provided in the request body.',
      requestBody: { contentType: 'application/json', schema: updateWebhookSchema },
      responses: [{ status: 200, description: 'Webhook updated', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Webhook not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Delete webhook',
      description: 'Permanently deletes a webhook configuration. Use ?id=<uuid> query parameter.',
      responses: [{ status: 200, description: 'Webhook deleted', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid webhook id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Webhook not found', schema: errorResponseSchema },
      ],
    },
  },
}
