import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { RuleExecutionLog } from '../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { executionResultSchema } from '../../data/validators'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const querySchema = z.looseObject({
  id: z.coerce.bigint().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  ruleId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  executionResult: executionResultSchema.optional(),
  executedBy: z.string().optional(),
  executedAtFrom: z.coerce.date().optional(),
  executedAtTo: z.coerce.date().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

const logListItemSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  ruleType: z.string(),
  entityId: z.string().uuid(),
  entityType: z.string(),
  executionResult: executionResultSchema,
  inputContext: z.any().nullable(),
  outputContext: z.any().nullable(),
  errorMessage: z.string().nullable(),
  executionTimeMs: z.number(),
  executedAt: z.string(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  executedBy: z.string().nullable(),
})

const logListResponseSchema = z.object({
  items: z.array(logListItemSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['business_rules.view_logs'] },
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
    ruleId: url.searchParams.get('ruleId') || undefined,
    entityId: url.searchParams.get('entityId') || undefined,
    entityType: url.searchParams.get('entityType') || undefined,
    executionResult: url.searchParams.get('executionResult') || undefined,
    executedBy: url.searchParams.get('executedBy') || undefined,
    executedAtFrom: url.searchParams.get('executedAtFrom') || undefined,
    executedAtTo: url.searchParams.get('executedAtTo') || undefined,
    sortField: url.searchParams.get('sortField') || undefined,
    sortDir: url.searchParams.get('sortDir') || undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { id, page, pageSize, ruleId, entityId, entityType, executionResult, executedBy, executedAtFrom, executedAtTo, sortField, sortDir } = parsed.data

  const filters: Record<string, any> = {
    tenantId: auth.tenantId,
  }

  // Organization filter is optional for logs (can be null)
  if (auth.orgId) {
    filters.organizationId = auth.orgId
  }

  if (id) filters.id = id.toString()
  if (ruleId) filters.rule = { id: ruleId }
  if (entityId) filters.entityId = entityId
  if (entityType) filters.entityType = entityType
  if (executionResult) filters.executionResult = executionResult
  if (executedBy) filters.executedBy = executedBy

  // Date range filter
  if (executedAtFrom || executedAtTo) {
    filters.executedAt = {}
    if (executedAtFrom) filters.executedAt.$gte = executedAtFrom
    if (executedAtTo) filters.executedAt.$lte = executedAtTo
  }

  const sortFieldMap: Record<string, string> = {
    id: 'id',
    ruleId: 'rule.ruleId',
    entityType: 'entityType',
    executionResult: 'executionResult',
    executionTimeMs: 'executionTimeMs',
    executedAt: 'executedAt',
  }

  const orderByField = sortField && sortFieldMap[sortField] ? sortFieldMap[sortField] : 'executedAt'
  const orderBy = { [orderByField]: sortDir }

  const [rows, count] = await findAndCountWithDecryption(
    em,
    RuleExecutionLog,
    filters,
    {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy,
      populate: ['rule'],
    },
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )

  const items = rows.map((log) => ({
    id: log.id,
    ruleId: log.rule.id,
    ruleName: log.rule.ruleName,
    ruleType: log.rule.ruleType,
    entityId: log.entityId,
    entityType: log.entityType,
    executionResult: log.executionResult,
    inputContext: log.inputContext ?? null,
    outputContext: log.outputContext ?? null,
    errorMessage: log.errorMessage ?? null,
    executionTimeMs: log.executionTimeMs,
    executedAt: log.executedAt.toISOString(),
    tenantId: log.tenantId,
    organizationId: log.organizationId ?? null,
    executedBy: log.executedBy ?? null,
  }))

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  return NextResponse.json({ items, total: count, totalPages })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Rule execution logs',
  methods: {
    GET: {
      summary: 'List rule execution logs',
      description: 'Returns rule execution history for the current tenant and organization with filtering and pagination. Useful for audit trails and debugging.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Rule execution logs collection', schema: logListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
  },
}
