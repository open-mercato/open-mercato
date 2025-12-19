import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Webhook } from '../../data/entities'
import {
  updateWebhookSchema,
  webhookDeliveryTypeSchema,
  retryConfigSchema,
  httpConfigSchema,
  sqsConfigSchema,
  snsConfigSchema,
} from '../../data/validators'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const webhookDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  deliveryType: webhookDeliveryTypeSchema,
  config: z.record(z.string(), z.any()),
  events: z.array(z.string()),
  active: z.boolean(),
  retryConfig: retryConfigSchema,
  timeout: z.number(),
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTriggeredAt: z.string().nullable(),
})

const okResponseSchema = z.object({ ok: z.literal(true) })
const errorResponseSchema = z.object({ error: z.string() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.list'] },
  PUT: { requireAuth: true, requireFeatures: ['webhooks.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['webhooks.delete'] },
}

/**
 * Mask sensitive fields in webhook config before returning.
 * Handles both top-level fields and nested objects (like headers).
 */
function maskSensitiveConfig(config: Record<string, any>): Record<string, any> {
  const sensitiveFields = ['password', 'secretAccessKey', 'apiKey', 'token', 'secret']
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

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid webhook id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const webhook = await em.findOne(Webhook, {
    id: parse.data.id,
    tenantId: auth.tenantId,
  })

  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: webhook.id,
    name: webhook.name,
    description: webhook.description ?? null,
    deliveryType: webhook.deliveryType,
    config: maskSensitiveConfig(webhook.config as Record<string, any>),
    events: webhook.events,
    active: webhook.active,
    retryConfig: webhook.retryConfig,
    timeout: webhook.timeout,
    tenantId: webhook.tenantId,
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString(),
    lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() ?? null,
  })
}

export async function PUT(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parseParams = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parseParams.success) {
    return NextResponse.json({ error: 'Invalid webhook id' }, { status: 400 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateWebhookSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const webhook = await em.findOne(Webhook, {
    id: parseParams.data.id,
    tenantId: auth.tenantId,
  })

  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  // If deliveryType is being changed, require config to be provided as well
  if (parsed.data.deliveryType !== undefined && parsed.data.deliveryType !== webhook.deliveryType) {
    if (parsed.data.config === undefined) {
      return NextResponse.json(
        { error: 'Config must be provided when changing deliveryType' },
        { status: 400 }
      )
    }

    // Validate config against the new delivery type
    const configSchemas: Record<string, z.ZodType<any>> = {
      http: httpConfigSchema,
      sqs: sqsConfigSchema,
      sns: snsConfigSchema,
    }
    const schema = configSchemas[parsed.data.deliveryType]
    if (schema) {
      const configResult = schema.safeParse(parsed.data.config)
      if (!configResult.success) {
        const errors = configResult.error.issues.map((e) => `config.${e.path.join('.')}: ${e.message}`)
        return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
      }
    }
  }

  // Update only provided fields
  if (parsed.data.name !== undefined) webhook.name = parsed.data.name
  if (parsed.data.description !== undefined) webhook.description = parsed.data.description
  if (parsed.data.deliveryType !== undefined) webhook.deliveryType = parsed.data.deliveryType
  if (parsed.data.config !== undefined) webhook.config = parsed.data.config as typeof webhook.config
  if (parsed.data.events !== undefined) webhook.events = parsed.data.events
  if (parsed.data.active !== undefined) webhook.active = parsed.data.active
  if (parsed.data.retryConfig !== undefined) webhook.retryConfig = parsed.data.retryConfig
  if (parsed.data.timeout !== undefined) webhook.timeout = parsed.data.timeout

  await em.persistAndFlush(webhook)

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid webhook id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const webhook = await em.findOne(Webhook, {
    id: parse.data.id,
    tenantId: auth.tenantId,
  })

  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  // Hard delete as per issue schema (no deleted_at field)
  await em.removeAndFlush(webhook)

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Webhooks',
  summary: 'Webhook detail operations',
  methods: {
    GET: {
      summary: 'Get webhook by ID',
      description: 'Returns complete details of a webhook configuration. Sensitive config fields are masked.',
      responses: [{ status: 200, description: 'Webhook detail', schema: webhookDetailSchema }],
      errors: [
        { status: 400, description: 'Invalid webhook id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Webhook not found', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update webhook',
      description: 'Updates an existing webhook configuration.',
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
      description: 'Permanently deletes a webhook configuration.',
      responses: [{ status: 200, description: 'Webhook deleted', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid webhook id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Webhook not found', schema: errorResponseSchema },
      ],
    },
  },
}
