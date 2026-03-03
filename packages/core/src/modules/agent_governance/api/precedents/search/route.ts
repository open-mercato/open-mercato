import { NextResponse } from 'next/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { precedentSearchSchema } from '../../../data/validators'
import { AgentGovernancePrecedentIndex } from '../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { agentGovernanceErrorSchema } from '../../openapi'

const responseItemSchema = z.object({
  id: z.string().uuid(),
  decisionEventId: z.string().uuid(),
  signature: z.string(),
  summary: z.string().nullable().optional(),
  score: z.number(),
  createdAt: z.string(),
})

const responseSchema = z.object({
  items: z.array(responseItemSchema),
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
  const parsed = precedentSearchSchema.parse({
    query: url.searchParams.get('query') ?? '',
    limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    signature: url.searchParams.get('signature') ?? undefined,
  })

  const where: Record<string, unknown> = {
    tenantId,
    organizationId,
  }

  if (parsed.signature) {
    where.signature = parsed.signature
  } else {
    where.summary = { $ilike: `%${escapeLikePattern(parsed.query)}%` }
  }

  const em = container.resolve('em')

  const rows = await findWithDecryption(
    em,
    AgentGovernancePrecedentIndex,
    where,
    {
      limit: parsed.limit,
      orderBy: [{ score: 'DESC' }, { createdAt: 'DESC' }],
    },
    { tenantId, organizationId },
  )

  return NextResponse.json({ items: rows })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Search precedents',
  methods: {
    GET: {
      summary: 'Search precedent index',
      query: precedentSearchSchema,
      responses: [{ status: 200, description: 'Precedents list', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 400, description: 'Invalid query', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
