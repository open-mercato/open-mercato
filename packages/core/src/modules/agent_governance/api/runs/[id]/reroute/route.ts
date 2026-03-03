import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRerouteSchema } from '../../../../data/validators'
import { buildCommandRouteContext } from '../../../route-helpers'
import { agentGovernanceErrorSchema } from '../../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const requestSchema = z.object({
  playbookId: z.string().uuid().optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
  riskBandId: z.string().uuid().optional().nullable(),
  reason: z.string().optional().nullable(),
  expectedStatus: z.enum(['queued', 'running', 'checkpoint', 'paused', 'failed', 'completed', 'terminated']).optional(),
})

const responseSchema = z.object({
  runId: z.string().uuid(),
  status: z.string(),
  approvalTaskId: z.string().uuid().nullable(),
  checkpointReasons: z.array(z.string()),
  telemetryEventId: z.string().uuid().nullable(),
  telemetryRepairRequired: z.boolean(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.runs.manage'] },
}

export async function POST(req: Request, routeContext: RouteContext) {
  const { ctx, commandBus } = await buildCommandRouteContext(req)
  const params = await routeContext.params
  const body = await req.json().catch(() => ({}))

  const parsed = runRerouteSchema.parse({
    id: params.id,
    playbookId: typeof body.playbookId === 'string' ? body.playbookId : body.playbookId === null ? null : undefined,
    policyId: typeof body.policyId === 'string' ? body.policyId : body.policyId === null ? null : undefined,
    riskBandId: typeof body.riskBandId === 'string' ? body.riskBandId : body.riskBandId === null ? null : undefined,
    reason: typeof body.reason === 'string' ? body.reason : body.reason === null ? null : undefined,
    expectedStatus: typeof body.expectedStatus === 'string' ? body.expectedStatus : undefined,
  })

  const { result } = await commandBus.execute<
    z.infer<typeof runRerouteSchema>,
    {
      runId: string
      status: string
      approvalTaskId: string | null
      checkpointReasons: string[]
      telemetryEventId: string | null
      telemetryRepairRequired: boolean
    }
  >('agent_governance.runs.reroute', { input: parsed, ctx })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Reroute a run',
  methods: {
    POST: {
      summary: 'Reroute run policy/playbook/risk binding',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'Run rerouted', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Run not found', schema: agentGovernanceErrorSchema },
        { status: 409, description: 'Reroute blocked by policy', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
