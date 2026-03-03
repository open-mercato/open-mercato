import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentGovernanceApprovalTask,
  AgentGovernanceDecisionEvent,
  AgentGovernanceRun,
  AgentGovernanceRunStep,
} from '../../../../data/entities'
import { agentGovernanceErrorSchema } from '../../../openapi'

interface RouteContext {
  params: Promise<{ id: string }>
}

const runTimelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

const decisionItemSchema = z.object({
  id: z.string().uuid(),
  stepId: z.string().nullable().optional(),
  actionType: z.string(),
  targetEntity: z.string(),
  targetId: z.string().nullable().optional(),
  controlPath: z.string(),
  status: z.string(),
  errorCode: z.string().nullable().optional(),
  immutableHash: z.string(),
  supersedesEventId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
})

const stepItemSchema = z.object({
  id: z.string().uuid(),
  sequenceNo: z.number().int(),
  actionType: z.string(),
  toolName: z.string().nullable().optional(),
  isIrreversible: z.boolean(),
  status: z.string(),
  errorCode: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const approvalItemSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  requestedByUserId: z.string().uuid().nullable().optional(),
  reviewerUserId: z.string().uuid().nullable().optional(),
  requestedAt: z.string(),
  reviewedAt: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  reviewComment: z.string().nullable().optional(),
})

const runTimelineResponseSchema = z.object({
  runId: z.string().uuid(),
  decisions: z.array(decisionItemSchema),
  steps: z.array(stepItemSchema),
  approvals: z.array(approvalItemSchema),
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
  const url = new URL(req.url)
  const query = runTimelineQuerySchema.parse({
    limit: url.searchParams.get('limit') ?? undefined,
  })

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

  const [decisions, steps, approvals] = await Promise.all([
    findWithDecryption(
      em,
      AgentGovernanceDecisionEvent,
      {
        tenantId,
        organizationId,
        runId: run.id,
      },
      { orderBy: { createdAt: 'ASC' }, limit: query.limit },
      { tenantId, organizationId },
    ),
    findWithDecryption(
      em,
      AgentGovernanceRunStep,
      {
        tenantId,
        organizationId,
        run: run.id,
      },
      { orderBy: [{ sequenceNo: 'ASC' }, { createdAt: 'ASC' }], limit: query.limit },
      { tenantId, organizationId },
    ),
    findWithDecryption(
      em,
      AgentGovernanceApprovalTask,
      {
        tenantId,
        organizationId,
        run: run.id,
      },
      { orderBy: { requestedAt: 'ASC' }, limit: query.limit },
      { tenantId, organizationId },
    ),
  ])

  return NextResponse.json({
    runId: run.id,
    decisions,
    steps,
    approvals,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Get run timeline',
  methods: {
    GET: {
      summary: 'Get timeline for a governed run',
      query: runTimelineQuerySchema,
      responses: [{ status: 200, description: 'Run timeline', schema: runTimelineResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 404, description: 'Run not found', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
