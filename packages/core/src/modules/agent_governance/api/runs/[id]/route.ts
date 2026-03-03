import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentGovernanceRun } from '../../../data/entities'
import { agentGovernanceErrorSchema } from '../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const runDetailSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  playbookId: z.string().uuid().nullable().optional(),
  policyId: z.string().uuid().nullable().optional(),
  riskBandId: z.string().uuid().nullable().optional(),
  status: z.string(),
  autonomyMode: z.string(),
  actionType: z.string(),
  targetEntity: z.string(),
  targetId: z.string().nullable().optional(),
  pauseReason: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  terminatedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.runs.view'] },
}

export async function GET(req: Request, routeContext: RouteContext) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request: req,
  })
  const tenantId = auth.tenantId
  const organizationId = organizationScope?.selectedId ?? auth.orgId
  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const params = await routeContext.params
  const em = container.resolve<EntityManager>('em')
  const run = await findOneWithDecryption(
    em,
    AgentGovernanceRun,
    {
      id: params.id,
      tenantId,
      organizationId,
    },
    undefined,
    { tenantId, organizationId },
  )

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  return NextResponse.json(run)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Get run details',
  methods: {
    GET: {
      summary: 'Get governed run by id',
      responses: [{ status: 200, description: 'Run detail', schema: runDetailSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Run not found', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
