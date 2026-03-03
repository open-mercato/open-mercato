import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentGovernanceApprovalTask } from '../../data/entities'
import { agentGovernanceErrorSchema } from '../openapi'

const approvalsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
  runId: z.string().uuid().optional(),
}).passthrough()

const approvalListItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  run: z.object({ id: z.string().uuid() }),
  decisionEventId: z.string().uuid().nullable().optional(),
  status: z.string(),
  requestedByUserId: z.string().uuid().nullable().optional(),
  reviewerUserId: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  reviewComment: z.string().nullable().optional(),
  requestedAt: z.string(),
  reviewedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const approvalsListResponseSchema = z.object({
  items: z.array(approvalListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(1),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.approvals.manage'] },
}

export async function GET(req: Request) {
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

  const url = new URL(req.url)
  const query = approvalsListQuerySchema.parse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    runId: url.searchParams.get('runId') ?? undefined,
  })

  const where: Record<string, unknown> = {
    tenantId,
    organizationId,
  }
  if (query.status) where.status = query.status
  if (query.runId) where.run = query.runId

  const em = container.resolve<EntityManager>('em')
  const [items, total] = await findAndCountWithDecryption(
    em,
    AgentGovernanceApprovalTask,
    where,
    {
      populate: ['run'],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
      orderBy: { createdAt: 'DESC' },
    },
    { tenantId, organizationId },
  )

  return NextResponse.json({
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'List approvals',
  methods: {
    GET: {
      summary: 'List approval tasks',
      query: approvalsListQuerySchema,
      responses: [{ status: 200, description: 'Approvals list', schema: approvalsListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 400, description: 'Invalid query', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
