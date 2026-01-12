import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RuleExecutionLog } from '../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { executionResultSchema } from '../../../data/validators'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const paramsSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid log id'),
})

const logDetailSchema = z.object({
  id: z.string(),
  rule: z.object({
    id: z.string().uuid(),
    ruleId: z.string(),
    ruleName: z.string(),
    ruleType: z.string(),
    entityType: z.string(),
  }),
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

const errorResponseSchema = z.object({
  error: z.string(),
})

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['business_rules.view_logs'] },
}

export const metadata = routeMetadata

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid log id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, any> = {
    id: parse.data.id,
    tenantId: auth.tenantId,
  }

  // Organization filter is optional for logs (can be null)
  if (auth.orgId) {
    filters.organizationId = auth.orgId
  }

  const log = await findOneWithDecryption(
    em,
    RuleExecutionLog,
    filters,
    {
      populate: ['rule'],
    },
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )

  if (!log) {
    return NextResponse.json({ error: 'Log entry not found' }, { status: 404 })
  }

  const response = {
    id: log.id,
    rule: {
      id: log.rule.id,
      ruleId: log.rule.ruleId,
      ruleName: log.rule.ruleName,
      ruleType: log.rule.ruleType,
      entityType: log.rule.entityType,
    },
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
  }

  return NextResponse.json(response)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Rule execution log detail',
  methods: {
    GET: {
      summary: 'Get execution log detail',
      description: 'Returns detailed information about a specific rule execution, including full context and results.',
      responses: [
        { status: 200, description: 'Log entry details', schema: logDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid log id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Log entry not found', schema: errorResponseSchema },
      ],
    },
  },
}
