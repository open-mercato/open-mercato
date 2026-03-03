import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { decisionSupersedeSchema } from '../../../../data/validators'
import { buildCommandRouteContext } from '../../../route-helpers'
import { agentGovernanceErrorSchema } from '../../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const requestSchema = z.object({
  sourceRefs: z.array(z.string()).optional(),
  writeSet: z.record(z.string(), z.unknown()).optional().nullable(),
  status: z.enum(['success', 'failed', 'blocked']).optional(),
  errorCode: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
})

const responseSchema = z.object({
  decisionEventId: z.string().uuid(),
  supersedesEventId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.memory.manage'] },
}

export async function POST(req: Request, routeContext: RouteContext) {
  const { ctx, commandBus } = await buildCommandRouteContext(req)
  const params = await routeContext.params
  const body = await req.json().catch(() => ({}))

  const parsed = decisionSupersedeSchema.parse({
    id: params.id,
    sourceRefs: Array.isArray(body.sourceRefs) ? body.sourceRefs : undefined,
    writeSet:
      body.writeSet && typeof body.writeSet === 'object' && !Array.isArray(body.writeSet)
        ? body.writeSet
        : body.writeSet === null
          ? null
          : undefined,
    status:
      body.status === 'success' || body.status === 'failed' || body.status === 'blocked'
        ? body.status
        : undefined,
    errorCode: typeof body.errorCode === 'string' ? body.errorCode : body.errorCode === null ? null : undefined,
    note: typeof body.note === 'string' ? body.note : body.note === null ? null : undefined,
  })

  const { result } = await commandBus.execute<
    z.infer<typeof decisionSupersedeSchema>,
    { decisionEventId: string; supersedesEventId: string }
  >('agent_governance.decisions.supersede', { input: parsed, ctx })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Supersede a decision event',
  methods: {
    POST: {
      summary: 'Create an append-only superseding correction for a decision event',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'Decision superseded', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Decision event not found', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
