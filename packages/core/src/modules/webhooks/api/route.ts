import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Webhook } from '../data/entities'
import {
  createWebhookSchema,
  webhookFilterSchema,
  webhookDeliveryTypeSchema,
  retryConfigSchema,
} from '../data/validators'
import { generateWebhookSecret, DEFAULT_RETRY_CONFIG, DEFAULT_TIMEOUT } from '../services/webhookService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.list'] },
  POST: { requireAuth: true, requireFeatures: ['webhooks.create'] },
}

// Response schemas for OpenAPI documentation
const webhookListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  deliveryType: webhookDeliveryTypeSchema,
  events: z.array(z.string()),
  active: z.boolean(),
  timeout: z.number(),
  retryConfig: retryConfigSchema,
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

const errorResponseSchema = z.object({ error: z.string() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = webhookFilterSchema.safeParse({
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
    deliveryType: url.searchParams.get('deliveryType') || undefined,
    active: url.searchParams.get('active') || undefined,
    event: url.searchParams.get('event') || undefined,
    sortField: url.searchParams.get('sortField') || undefined,
    sortDir: url.searchParams.get('sortDir') || undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const { page, pageSize, search, deliveryType, active, event, sortField, sortDir } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, any> = {
    tenantId: auth.tenantId,
  }

  if (search) filters.name = { $ilike: `%${search}%` }
  if (deliveryType) filters.deliveryType = deliveryType
  if (active !== undefined) filters.active = active
  if (event) filters.events = { $contains: [event] }

  const sortFieldMap: Record<string, string> = {
    name: 'name',
    deliveryType: 'deliveryType',
    active: 'active',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }

  const orderByField = sortField && sortFieldMap[sortField] ? sortFieldMap[sortField] : 'createdAt'
  const orderBy = { [orderByField]: sortDir }

  const [rows, count] = await em.findAndCount(Webhook, filters, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    orderBy,
  })

  const items = rows.map((webhook) => ({
    id: webhook.id,
    name: webhook.name,
    description: webhook.description ?? null,
    deliveryType: webhook.deliveryType,
    events: webhook.events,
    active: webhook.active,
    timeout: webhook.timeout,
    retryConfig: webhook.retryConfig,
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString(),
    lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() ?? null,
  }))

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  return NextResponse.json({
    items,
    total: count,
    page,
    pageSize,
    totalPages,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createWebhookSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  // Generate the webhook secret
  const secret = generateWebhookSecret()

  const webhook = em.create(Webhook, {
    tenantId: auth.tenantId!,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    deliveryType: parsed.data.deliveryType,
    config: parsed.data.config as Webhook['config'],
    secret,
    events: parsed.data.events,
    active: parsed.data.active ?? true,
    retryConfig: parsed.data.retryConfig ?? DEFAULT_RETRY_CONFIG,
    timeout: parsed.data.timeout ?? DEFAULT_TIMEOUT,
  })

  await em.persistAndFlush(webhook)

  // Return the secret only once at creation
  return NextResponse.json({ id: webhook.id, secret }, { status: 201 })
}

export const openApi = {
  tag: 'Webhooks',
  summary: 'Webhook configuration management',
  methods: {
    GET: {
      summary: 'List webhooks',
      description: 'Returns webhooks for the current tenant with filtering and pagination.',
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
  },
}
