import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { agentSkillCaptureFromTraceSchema } from '../../../data/validators'
import { buildCommandRouteContext } from '../../route-helpers'
import { agentGovernanceErrorSchema } from '../../openapi'

const responseSchema = z.object({
  skillId: z.string().uuid(),
  status: z.enum(['draft', 'validated', 'active', 'deprecated']),
  validationReport: z.record(z.string(), z.unknown()).nullable(),
  skillVersionId: z.string().uuid().nullable(),
  versionNo: z.number().int().positive().nullable(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.skills.manage'] },
}

export async function POST(req: Request) {
  const { ctx, commandBus, translate } = await buildCommandRouteContext(req)
  const body = await req.json().catch(() => ({}))

  const input = parseScopedCommandInput(agentSkillCaptureFromTraceSchema, body, ctx, translate)

  const { result } = await commandBus.execute(
    'agent_governance.skills.capture_from_trace',
    { input, ctx },
  )

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Capture skill from traces',
  methods: {
    POST: {
      summary: 'Extract tacit skill candidate from decision traces and postmortem notes',
      requestBody: {
        contentType: 'application/json',
        schema: agentSkillCaptureFromTraceSchema,
      },
      responses: [{ status: 200, description: 'Skill captured', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 403, description: 'Forbidden', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
