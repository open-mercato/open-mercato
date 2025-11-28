import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { BusinessRule } from '../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ruleTypeSchema } from '../../../data/validators'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const ruleDetailSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string(),
  ruleName: z.string(),
  description: z.string().nullable(),
  ruleType: ruleTypeSchema,
  ruleCategory: z.string().nullable(),
  entityType: z.string(),
  eventType: z.string().nullable(),
  conditionExpression: z.any(),
  successActions: z.any().nullable(),
  failureActions: z.any().nullable(),
  enabled: z.boolean(),
  priority: z.number(),
  version: z.number(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const rule = await em.findOne(BusinessRule, {
    id: parse.data.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: rule.id,
    ruleId: rule.ruleId,
    ruleName: rule.ruleName,
    description: rule.description ?? null,
    ruleType: rule.ruleType,
    ruleCategory: rule.ruleCategory ?? null,
    entityType: rule.entityType,
    eventType: rule.eventType ?? null,
    conditionExpression: rule.conditionExpression,
    successActions: rule.successActions ?? null,
    failureActions: rule.failureActions ?? null,
    enabled: rule.enabled,
    priority: rule.priority,
    version: rule.version,
    effectiveFrom: rule.effectiveFrom ? rule.effectiveFrom.toISOString() : null,
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString() : null,
    tenantId: rule.tenantId,
    organizationId: rule.organizationId,
    createdBy: rule.createdBy ?? null,
    updatedBy: rule.updatedBy ?? null,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['business_rules.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Fetch business rule detail',
  methods: {
    GET: {
      summary: 'Fetch business rule by ID',
      description: 'Returns complete details of a business rule including conditions and actions.',
      responses: [
        { status: 200, description: 'Business rule detail', schema: ruleDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Business rule not found', schema: errorResponseSchema },
      ],
    },
  },
}
