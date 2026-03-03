import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { precedentExplainSchema } from '../../../data/validators'
import { AgentGovernanceDecisionEvent, AgentGovernanceDecisionWhyLink } from '../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { agentGovernanceErrorSchema } from '../../openapi'

const responseSchema = z.object({
  event: z.object({
    id: z.string().uuid(),
    actionType: z.string(),
    targetEntity: z.string(),
    targetId: z.string().nullable().optional(),
    controlPath: z.string(),
    status: z.string(),
    riskScore: z.number().nullable().optional(),
    policyId: z.string().uuid().nullable().optional(),
    riskBandId: z.string().uuid().nullable().optional(),
    signature: z.string().nullable().optional(),
    createdAt: z.string(),
  }),
  whyLinks: z.array(z.object({
    id: z.string().uuid(),
    reasonType: z.string(),
    refId: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    confidence: z.number().nullable().optional(),
    createdAt: z.string(),
  })),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.memory.view'] },
}

export async function GET(req: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = auth.tenantId
  const organizationId = organizationScope?.selectedId ?? auth.orgId

  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const url = new URL(req.url)
  const parsed = precedentExplainSchema.parse({
    eventId: url.searchParams.get('eventId') ?? '',
  })

  const em = container.resolve('em')

  const event = await findOneWithDecryption(
    em,
    AgentGovernanceDecisionEvent,
    {
      id: parsed.eventId,
      tenantId,
      organizationId,
    },
    undefined,
    { tenantId, organizationId },
  )

  if (!event) {
    return NextResponse.json({ error: 'Decision event not found' }, { status: 404 })
  }

  const whyLinks = await findWithDecryption(
    em,
    AgentGovernanceDecisionWhyLink,
    {
      decisionEvent: event.id,
      tenantId,
      organizationId,
    },
    {
      orderBy: { createdAt: 'ASC' },
    },
    { tenantId, organizationId },
  )

  return NextResponse.json({
    event,
    whyLinks,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Explain a precedent',
  methods: {
    GET: {
      summary: 'Explain decision event rationale',
      query: precedentExplainSchema,
      responses: [{ status: 200, description: 'Decision explanation', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Decision event not found', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
