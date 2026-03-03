import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { agentSkillValidateSchema } from '../../../../data/validators'
import { buildCommandRouteContext } from '../../../route-helpers'
import { agentGovernanceErrorSchema } from '../../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const requestSchema = z.object({
  sampleSize: z.number().int().min(1).max(250).optional(),
  passRateThreshold: z.number().min(0).max(1).optional(),
  approvalDecision: z.enum(['approve', 'reject']).optional(),
  comment: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
})

const responseSchema = z.object({
  skillId: z.string().uuid(),
  status: z.enum(['draft', 'validated', 'active', 'deprecated']),
  passed: z.boolean(),
  passRate: z.number(),
  skillVersionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  validationReport: z.record(z.string(), z.unknown()),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.skills.manage'] },
}

export async function POST(req: Request, routeContext: RouteContext) {
  const { ctx, commandBus } = await buildCommandRouteContext(req)
  const params = await routeContext.params
  const body = await req.json().catch(() => ({}))

  const parsed = requestSchema.parse(body)

  const input = agentSkillValidateSchema.parse({
    id: params.id,
    sampleSize: parsed.sampleSize,
    passRateThreshold: parsed.passRateThreshold,
    approvalDecision: parsed.approvalDecision,
    comment: parsed.comment,
    idempotencyKey: parsed.idempotencyKey,
  })

  const { result } = await commandBus.execute('agent_governance.skills.validate', {
    input,
    ctx,
  })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Validate skill',
  methods: {
    POST: {
      summary: 'Run validation against historical traces with approval checkpoint',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'Skill validated', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 403, description: 'Forbidden', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Skill not found', schema: agentGovernanceErrorSchema },
        { status: 409, description: 'Validation policy rejected', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
