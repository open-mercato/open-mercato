import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { agentRunRequestSchema, baseAgentResultSchema } from '../../../../data/validators'
import {
  AgentNotFoundError,
  AgentOutputInvalidError,
  type AgentRunCtx,
  type AgentRuntimeService,
} from '../../../../lib/runtime/agentRuntime'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.run'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  const body = await readJsonSafe(req, {})
  const parsed = agentRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
    resourceKind: 'agent_orchestrator.agent_run',
    resourceId: id,
    operation: 'custom',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const runCtx: AgentRunCtx = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
  }

  let result: unknown
  try {
    const agentRuntime = container.resolve('agentRuntime') as AgentRuntimeService
    result = await agentRuntime.run(id, parsed.data.input, runCtx)
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    if (err instanceof AgentOutputInvalidError) {
      return NextResponse.json({ error: 'Agent produced invalid output' }, { status: 422 })
    }
    throw err
  }

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
      resourceKind: 'agent_orchestrator.agent_run',
      resourceId: id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Run an agent (playground)',
  methods: {
    POST: {
      summary: 'Run an agent',
      description:
        'Runs the agent in object mode under the caller scope, persists an AgentRun (and an AgentProposal for actionable results), and returns the typed AgentResult.',
      requestBody: {
        contentType: 'application/json',
        schema: agentRunRequestSchema,
        description: 'Agent input payload (shape is agent-specific).',
      },
      responses: [
        { status: 200, description: 'Typed AgentResult', schema: baseAgentResultSchema },
      ],
      errors: [
        { status: 400, description: 'Tenant context missing', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.run', schema: errorSchema },
        { status: 404, description: 'Unknown agent id', schema: errorSchema },
        { status: 422, description: 'Invalid input or invalid model output', schema: errorSchema },
      ],
    },
  },
}
