import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { approvalDecisionSchema } from '../../../../data/validators'
import { buildCommandRouteContext } from '../../../route-helpers'
import { agentGovernanceErrorSchema } from '../../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const responseSchema = z.object({
  approvalTaskId: z.string().uuid(),
  runId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.approvals.manage'] },
}

export async function POST(req: Request, routeContext: RouteContext) {
  const { ctx, commandBus } = await buildCommandRouteContext(req)
  const params = await routeContext.params
  const body = await req.json().catch(() => ({}))

  const parsed = approvalDecisionSchema.parse({
    id: params.id,
    comment: typeof body.comment === 'string' ? body.comment : null,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
  })

  const { result } = await commandBus.execute<z.infer<typeof approvalDecisionSchema>, { approvalTaskId: string; runId: string }>(
    'agent_governance.approvals.approve',
    { input: parsed, ctx },
  )

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Approve checkpoint task',
  methods: {
    POST: {
      summary: 'Approve an approval task by id',
      requestBody: {
        contentType: 'application/json',
        schema: z.object({ comment: z.string().optional(), idempotencyKey: z.string().min(8).max(128).optional() }),
      },
      responses: [{ status: 200, description: 'Task approved', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Task not found', schema: agentGovernanceErrorSchema },
        { status: 409, description: 'Invalid state', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
