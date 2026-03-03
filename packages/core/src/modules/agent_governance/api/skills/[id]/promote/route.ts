import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { agentSkillPromoteSchema } from '../../../../data/validators'
import { buildCommandRouteContext } from '../../../route-helpers'
import { agentGovernanceErrorSchema } from '../../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const responseSchema = z.object({
  skillId: z.string().uuid(),
  skillVersionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.skills.manage'] },
}

export async function POST(req: Request, routeContext: RouteContext) {
  const { ctx, commandBus } = await buildCommandRouteContext(req)
  const params = await routeContext.params
  const body = await req.json().catch(() => ({}))

  const parsed = agentSkillPromoteSchema.parse({
    id: params.id,
    diffJson: typeof body.diffJson === 'object' && body.diffJson != null ? body.diffJson : null,
    validationReportJson:
      typeof body.validationReportJson === 'object' && body.validationReportJson != null ? body.validationReportJson : null,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
  })

  const { result } = await commandBus.execute<
    z.infer<typeof agentSkillPromoteSchema>,
    { skillId: string; skillVersionId: string; versionNo: number }
  >('agent_governance.skills.promote', { input: parsed, ctx })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Promote a skill',
  methods: {
    POST: {
      summary: 'Promote skill and create a version',
      requestBody: {
        contentType: 'application/json',
        schema: z.object({
          diffJson: z.record(z.string(), z.unknown()).optional(),
          validationReportJson: z.record(z.string(), z.unknown()).optional(),
          idempotencyKey: z.string().min(8).max(128).optional(),
        }),
      },
      responses: [{ status: 200, description: 'Skill promoted', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Skill not found', schema: agentGovernanceErrorSchema },
        { status: 409, description: 'Promotion blocked', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
