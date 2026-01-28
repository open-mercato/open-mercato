import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import * as ruleEngine from '../../../lib/rule-engine'

const executeByIdRequestSchema = z.object({
  data: z.any(),
  dryRun: z.boolean().optional().default(false),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  eventType: z.string().optional(),
})

const executeByIdResponseSchema = z.object({
  success: z.boolean(),
  ruleId: z.string(),
  ruleName: z.string(),
  conditionResult: z.boolean(),
  actionsExecuted: z.object({
    success: z.boolean(),
    results: z.array(z.object({
      type: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    })),
  }).nullable(),
  executionTime: z.number(),
  error: z.string().optional(),
  logId: z.string().optional(),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['business_rules.execute'] },
}

export const metadata = routeMetadata

interface RouteContext {
  params: Promise<{ ruleId: string }>
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = await context.params
  const ruleId = params.ruleId

  if (!ruleId || !z.uuid().safeParse(ruleId).success) {
    return NextResponse.json({ error: 'Invalid rule ID' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = executeByIdRequestSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const { data, dryRun, entityType, entityId, eventType } = parsed.data

  const execContext: ruleEngine.DirectRuleExecutionContext = {
    ruleId,
    data,
    user: {
      id: auth.sub,
      email: auth.email,
      role: (auth.role as string) ?? undefined,
    },
    tenantId: auth.tenantId ?? '',
    organizationId: auth.orgId ?? '',
    executedBy: auth.sub ?? auth.email ?? undefined,
    dryRun,
    entityType,
    entityId,
    eventType,
  }

  try {
    const result = await ruleEngine.executeRuleById(em, execContext)

    const response = {
      success: result.success,
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      conditionResult: result.conditionResult,
      actionsExecuted: result.actionsExecuted ? {
        success: result.actionsExecuted.success,
        results: result.actionsExecuted.results.map(ar => ({
          type: ar.action.type,
          success: ar.success,
          error: ar.error,
        })),
      } : null,
      executionTime: result.executionTime,
      error: result.error,
      logId: result.logId,
    }

    // Return appropriate status based on result
    const status = result.success ? 200 : (result.error === 'Rule not found' ? 404 : 200)
    return NextResponse.json(response, { status })
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
  summary: 'Execute a specific business rule by ID',
  methods: {
    POST: {
      summary: 'Execute a specific rule by its database UUID',
      description: 'Directly executes a specific business rule identified by its UUID, bypassing the normal entityType/eventType discovery mechanism. Useful for workflows and targeted rule execution.',
      pathParams: z.object({
        ruleId: z.string().uuid().describe('The database UUID of the business rule to execute'),
      }),
      requestBody: {
        contentType: 'application/json',
        schema: executeByIdRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Rule executed successfully',
          schema: executeByIdResponseSchema,
        },
        {
          status: 404,
          description: 'Rule not found',
          schema: errorResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request payload or rule ID', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 500, description: 'Execution error', schema: errorResponseSchema },
      ],
    },
  },
}
