import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ruleEngineContextSchema } from '../../data/validators'
import * as ruleEngine from '../../lib/rule-engine'

const executeRequestSchema = z.object({
  entityType: z.string().min(1, 'entityType is required'),
  entityId: z.string().optional(),
  eventType: z.string().optional(),
  data: z.any(),
  dryRun: z.boolean().optional().default(false),
})

const executeResponseSchema = z.object({
  allowed: z.boolean(),
  executedRules: z.array(z.object({
    ruleId: z.string(),
    ruleName: z.string(),
    conditionResult: z.boolean(),
    executionTime: z.number(),
    error: z.string().optional(),
  })),
  totalExecutionTime: z.number(),
  errors: z.array(z.string()).optional(),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['business_rules.execute'] },
}

export const metadata = routeMetadata

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

  const parsed = executeRequestSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const { entityType, entityId, eventType, data, dryRun } = parsed.data

  const context: ruleEngine.RuleEngineContext = {
    entityType,
    entityId,
    eventType,
    data,
    user: {
      id: auth.sub,
      email: auth.email,
      role: (auth.role as string) ?? undefined,
    },
    tenantId: auth.tenantId ?? '',
    organizationId: auth.orgId ?? '',
    executedBy: auth.sub ?? auth.email ?? null,
    dryRun,
  }

  const validation = ruleEngineContextSchema.safeParse(context)
  if (!validation.success) {
    const errors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: `Invalid execution context: ${errors.join(', ')}` }, { status: 400 })
  }

  try {
    const result = await ruleEngine.executeRules(em, context)

    const response = {
      allowed: result.allowed,
      executedRules: result.executedRules.map(r => ({
        ruleId: r.rule.ruleId,
        ruleName: r.rule.ruleName,
        ruleType: r.rule.ruleType,
        conditionResult: r.conditionResult,
        actionsExecuted: r.actionsExecuted ? {
          success: r.actionsExecuted.success,
          results: r.actionsExecuted.results.map(ar => ({
            type: ar.action.type,
            success: ar.success,
            error: ar.error,
          })),
        } : null,
        executionTime: r.executionTime,
        error: r.error,
        logId: r.logId,
      })),
      totalExecutionTime: result.totalExecutionTime,
      errors: result.errors,
      logIds: result.logIds,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Rule execution failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Execute business rules',
  methods: {
    POST: {
      summary: 'Execute rules for given context',
      description: 'Manually executes applicable business rules for the specified entity type, event, and data. Supports dry-run mode to test rules without executing actions.',
      requestBody: {
        contentType: 'application/json',
        schema: executeRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Rules executed successfully',
          schema: executeResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 500, description: 'Execution error', schema: errorResponseSchema },
      ],
    },
  },
}
