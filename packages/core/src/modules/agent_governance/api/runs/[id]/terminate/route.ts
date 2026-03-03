import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runControlSchema } from '../../../../data/validators'
import { buildCommandRouteContext } from '../../../route-helpers'
import { agentGovernanceErrorSchema } from '../../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const responseSchema = z.object({
  runId: z.string().uuid(),
  status: z.string(),
})

const requestSchema = z.object({
  reason: z.string().optional(),
  expectedStatus: z.enum(['queued', 'running', 'checkpoint', 'paused', 'failed', 'completed', 'terminated']).optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.runs.manage'] },
}

export async function POST(req: Request, routeContext: RouteContext) {
  const { ctx, commandBus } = await buildCommandRouteContext(req)
  const params = await routeContext.params
  const body = await req.json().catch(() => ({}))

  const parsed = runControlSchema.parse({
    id: params.id,
    reason: typeof body.reason === 'string' ? body.reason : null,
    expectedStatus: typeof body.expectedStatus === 'string' ? body.expectedStatus : undefined,
  })

  const { result } = await commandBus.execute<z.infer<typeof runControlSchema>, { runId: string; status: string }>(
    'agent_governance.runs.terminate',
    { input: parsed, ctx },
  )

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Terminate a run',
  methods: {
    POST: {
      summary: 'Terminate run by id',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'Run terminated', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Run not found', schema: agentGovernanceErrorSchema },
        { status: 409, description: 'Invalid transition', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
