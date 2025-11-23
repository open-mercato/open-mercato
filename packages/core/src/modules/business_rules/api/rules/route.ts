import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { BusinessRule } from '../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  createBusinessRuleSchema,
  updateBusinessRuleSchema,
  businessRuleFilterSchema,
  ruleTypeSchema,
} from '../../data/validators'

const querySchema = z.looseObject({
  id: z.uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  ruleId: z.string().optional(),
  ruleType: ruleTypeSchema.optional(),
  entityType: z.string().optional(),
  eventType: z.string().optional(),
  enabled: z.coerce.boolean().optional(),
  ruleCategory: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

const ruleListItemSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string(),
  ruleName: z.string(),
  description: z.string().nullable(),
  ruleType: ruleTypeSchema,
  ruleCategory: z.string().nullable(),
  entityType: z.string(),
  eventType: z.string().nullable(),
  enabled: z.boolean(),
  priority: z.number(),
  version: z.number(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const ruleListResponseSchema = z.object({
  items: z.array(ruleListItemSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
})

const ruleCreateResponseSchema = z.object({
  id: z.string().uuid(),
})

const okResponseSchema = z.object({
  ok: z.literal(true),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['business_rules.view'] },
  POST: { requireAuth: true, requireFeatures: ['business_rules.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['business_rules.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['business_rules.manage'] },
}

export const metadata = routeMetadata

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
    ruleId: url.searchParams.get('ruleId') || undefined,
    ruleType: url.searchParams.get('ruleType') || undefined,
    entityType: url.searchParams.get('entityType') || undefined,
    eventType: url.searchParams.get('eventType') || undefined,
    enabled: url.searchParams.get('enabled') || undefined,
    ruleCategory: url.searchParams.get('ruleCategory') || undefined,
    sortField: url.searchParams.get('sortField') || undefined,
    sortDir: url.searchParams.get('sortDir') || undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { id, page, pageSize, search, ruleId, ruleType, entityType, eventType, enabled, ruleCategory, sortField, sortDir } = parsed.data

  const filters: Record<string, any> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  }

  if (id) filters.id = id
  if (ruleId) filters.ruleId = { $ilike: `%${ruleId}%` }
  if (search) filters.ruleName = { $ilike: `%${search}%` }
  if (ruleType) filters.ruleType = ruleType
  if (entityType) filters.entityType = entityType
  if (eventType) filters.eventType = eventType
  if (enabled !== undefined) filters.enabled = enabled
  if (ruleCategory) filters.ruleCategory = ruleCategory

  const sortFieldMap: Record<string, string> = {
    ruleId: 'ruleId',
    ruleName: 'ruleName',
    ruleType: 'ruleType',
    entityType: 'entityType',
    priority: 'priority',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }

  const orderByField = sortField && sortFieldMap[sortField] ? sortFieldMap[sortField] : 'priority'
  const orderBy = { [orderByField]: sortDir, ruleId: 'asc' as const }

  const [rows, count] = await em.findAndCount(
    BusinessRule,
    filters,
    {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy,
    }
  )

  const items = rows.map((rule) => ({
    id: rule.id,
    ruleId: rule.ruleId,
    ruleName: rule.ruleName,
    description: rule.description ?? null,
    ruleType: rule.ruleType,
    ruleCategory: rule.ruleCategory ?? null,
    entityType: rule.entityType,
    eventType: rule.eventType ?? null,
    enabled: rule.enabled,
    priority: rule.priority,
    version: rule.version,
    effectiveFrom: rule.effectiveFrom ? rule.effectiveFrom.toISOString() : null,
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString() : null,
    tenantId: rule.tenantId,
    organizationId: rule.organizationId,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }))

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  return NextResponse.json({ items, total: count, totalPages })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const payload = {
    ...body,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    createdBy: auth.sub ?? auth.email ?? null,
  }

  const parsed = createBusinessRuleSchema.safeParse(payload)
  if (!parsed.success) {
    const errors = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const rule = em.create(BusinessRule, parsed.data)
  await em.persistAndFlush(rule)

  return NextResponse.json({ id: rule.id }, { status: 201 })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) {
    return NextResponse.json({ error: 'Rule id is required' }, { status: 400 })
  }

  const payload = {
    ...body,
    updatedBy: auth.sub ?? auth.email ?? null,
  }

  const parsed = updateBusinessRuleSchema.safeParse(payload)
  if (!parsed.success) {
    const errors = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const rule = await em.findOne(BusinessRule, {
    id: parsed.data.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  em.assign(rule, parsed.data)
  await em.persistAndFlush(rule)

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Rule id is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const rule = await em.findOne(BusinessRule, {
    id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  rule.deletedAt = new Date()
  await em.persistAndFlush(rule)

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Business rule management',
  methods: {
    GET: {
      summary: 'List business rules',
      description: 'Returns business rules for the current tenant and organization with filtering and pagination.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Business rules collection', schema: ruleListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Create business rule',
      description: 'Creates a new business rule for the current tenant and organization.',
      requestBody: {
        contentType: 'application/json',
        schema: createBusinessRuleSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Business rule created',
          schema: ruleCreateResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update business rule',
      description: 'Updates an existing business rule.',
      requestBody: {
        contentType: 'application/json',
        schema: updateBusinessRuleSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Business rule updated',
          schema: okResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Business rule not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Delete business rule',
      description: 'Soft deletes a business rule by identifier.',
      query: z.object({ id: z.string().uuid().describe('Business rule identifier') }),
      responses: [
        { status: 200, description: 'Business rule deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Business rule not found', schema: errorResponseSchema },
      ],
    },
  },
}
