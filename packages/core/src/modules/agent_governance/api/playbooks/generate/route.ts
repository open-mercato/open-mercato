import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { SkillLifecycleService } from '../../../../services/skill-lifecycle-service'
import { buildCommandRouteContext } from '../../../route-helpers'
import { agentGovernanceErrorSchema } from '../../../openapi'

const requestSchema = z.object({
  actionType: z.string().min(1).max(200),
  targetEntity: z.string().min(1).max(200),
  targetId: z.string().max(255).optional(),
  playbookName: z.string().min(1).max(200).optional(),
})

const responseSchema = z.object({
  name: z.string(),
  description: z.string(),
  actionType: z.string(),
  targetEntity: z.string(),
  targetId: z.string().nullable(),
  recommendedPolicyId: z.string().uuid().nullable(),
  recommendedRiskBandId: z.string().uuid().nullable(),
  suggestedGuidance: z.array(
    z.object({
      skillId: z.string().uuid(),
      name: z.string(),
      summary: z.string(),
      confidence: z.number(),
      sourceRef: z.string(),
    }),
  ),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.playbooks.manage'] },
}

export async function POST(req: Request) {
  const { ctx } = await buildCommandRouteContext(req)
  const body = await req.json().catch(() => ({}))
  const input = requestSchema.parse(body)

  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null

  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const skillLifecycleService = ctx.container.resolve('agentGovernanceSkillLifecycleService') as SkillLifecycleService

  const draft = await skillLifecycleService.buildPlaybookDraft({
    tenantId,
    organizationId,
    actionType: input.actionType,
    targetEntity: input.targetEntity,
    targetId: input.targetId ?? null,
    playbookName: input.playbookName ?? null,
  })

  return NextResponse.json(draft)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Generate playbook draft',
  methods: {
    POST: {
      summary: 'Generate a playbook draft from active skills and precedent guidance',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'Draft generated', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 403, description: 'Forbidden', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
