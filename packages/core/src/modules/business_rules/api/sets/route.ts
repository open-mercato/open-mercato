import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { RuleSet } from '../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  createRuleSetSchema,
  updateRuleSetSchema,
} from '../../data/validators'

const querySchema = z.looseObject({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  setId: z.string().optional(),
  enabled: z.coerce.boolean().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

const ruleSetListItemSchema = z.object({
  id: z.string().uuid(),
  setId: z.string(),
  setName: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const ruleSetListResponseSchema = z.object({
  items: z.array(ruleSetListItemSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
})

const ruleSetCreateResponseSchema = z.object({
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
  POST: { requireAuth: true, requireFeatures: ['business_rules.manage_sets'] },
  PUT: { requireAuth: true, requireFeatures: ['business_rules.manage_sets'] },
  DELETE: { requireAuth: true, requireFeatures: ['business_rules.manage_sets'] },
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
    setId: url.searchParams.get('setId') || undefined,
    enabled: url.searchParams.get('enabled') || undefined,
    sortField: url.searchParams.get('sortField') || undefined,
    sortDir: url.searchParams.get('sortDir') || undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { id, page, pageSize, search, setId, enabled, sortField, sortDir } = parsed.data

  const filters: Record<string, any> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  }

  if (id) filters.id = id
  if (setId) filters.setId = { $ilike: `%${setId}%` }
  if (search) filters.setName = { $ilike: `%${search}%` }
  if (enabled !== undefined) filters.enabled = enabled

  const sortFieldMap: Record<string, string> = {
    setId: 'setId',
    setName: 'setName',
    enabled: 'enabled',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }

  const orderByField = sortField && sortFieldMap[sortField] ? sortFieldMap[sortField] : 'setId'
  const orderBy = { [orderByField]: sortDir }

  const [rows, count] = await em.findAndCount(
    RuleSet,
    filters,
    {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy,
    }
  )

  const items = rows.map((set) => ({
    id: set.id,
    setId: set.setId,
    setName: set.setName,
    description: set.description ?? null,
    enabled: set.enabled,
    tenantId: set.tenantId,
    organizationId: set.organizationId,
    createdBy: set.createdBy ?? null,
    updatedBy: set.updatedBy ?? null,
    createdAt: set.createdAt.toISOString(),
    updatedAt: set.updatedAt.toISOString(),
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

  const parsed = createRuleSetSchema.safeParse(payload)
  if (!parsed.success) {
    const errors = parsed.error?.errors?.map(e => `${e.path.join('.')}: ${e.message}`) ?? ['Unknown validation error']
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const ruleSet = em.create(RuleSet, parsed.data)
  await em.persistAndFlush(ruleSet)

  return NextResponse.json({ id: ruleSet.id }, { status: 201 })
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
    return NextResponse.json({ error: 'Rule set id is required' }, { status: 400 })
  }

  const payload = {
    ...body,
    updatedBy: auth.sub ?? auth.email ?? null,
  }

  const parsed = updateRuleSetSchema.safeParse(payload)
  if (!parsed.success) {
    const errors = parsed.error?.errors?.map(e => `${e.path.join('.')}: ${e.message}`) ?? ['Unknown validation error']
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const ruleSet = await em.findOne(RuleSet, {
    id: parsed.data.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!ruleSet) {
    return NextResponse.json({ error: 'Rule set not found' }, { status: 404 })
  }

  em.assign(ruleSet, parsed.data)
  await em.persistAndFlush(ruleSet)

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
    return NextResponse.json({ error: 'Rule set id is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const ruleSet = await em.findOne(RuleSet, {
    id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!ruleSet) {
    return NextResponse.json({ error: 'Rule set not found' }, { status: 404 })
  }

  ruleSet.deletedAt = new Date()
  await em.persistAndFlush(ruleSet)

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Rule set management',
  methods: {
    GET: {
      summary: 'List rule sets',
      description: 'Returns rule sets for the current tenant and organization with filtering and pagination.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Rule sets collection', schema: ruleSetListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Create rule set',
      description: 'Creates a new rule set for organizing business rules.',
      requestBody: {
        contentType: 'application/json',
        schema: createRuleSetSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Rule set created',
          schema: ruleSetCreateResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update rule set',
      description: 'Updates an existing rule set.',
      requestBody: {
        contentType: 'application/json',
        schema: updateRuleSetSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Rule set updated',
          schema: okResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Rule set not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Delete rule set',
      description: 'Soft deletes a rule set by identifier.',
      query: z.object({ id: z.string().uuid().describe('Rule set identifier') }),
      responses: [
        { status: 200, description: 'Rule set deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Rule set not found', schema: errorResponseSchema },
      ],
    },
  },
}
