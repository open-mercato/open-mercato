import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { contextGraphNeighborsSchema } from '../../../data/validators'
import { AgentGovernanceDecisionEntityLink } from '../../../data/entities'
import { agentGovernanceErrorSchema } from '../../openapi'

const neighborSchema = z.object({
  eventId: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string(),
  relationshipType: z.string(),
  createdAt: z.string(),
})

const responseSchema = z.object({
  anchorEventId: z.string().uuid(),
  neighbors: z.array(neighborSchema),
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
  const parsed = contextGraphNeighborsSchema.parse({
    eventId: url.searchParams.get('eventId') ?? '',
    limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
  })

  const em = container.resolve<EntityManager>('em')

  const anchorLinks = await findWithDecryption(
    em,
    AgentGovernanceDecisionEntityLink,
    {
      decisionEvent: parsed.eventId,
      tenantId,
      organizationId,
    },
    {
      limit: parsed.limit,
      orderBy: { createdAt: 'DESC' },
    },
    { tenantId, organizationId },
  )

  if (anchorLinks.length === 0) {
    return NextResponse.json({
      anchorEventId: parsed.eventId,
      neighbors: [],
    })
  }

  const entityPairs = anchorLinks.map((link) => `${link.entityType}:${link.entityId}`)
  const entityTypes = [...new Set(anchorLinks.map((link) => link.entityType))]
  const entityIds = [...new Set(anchorLinks.map((link) => link.entityId))]

  const neighbors = await findWithDecryption(
    em,
      AgentGovernanceDecisionEntityLink,
      {
        tenantId,
        organizationId,
        entityType: { $in: entityTypes },
        entityId: { $in: entityIds },
        decisionEvent: { $ne: parsed.eventId },
      },
    {
      limit: parsed.limit,
      orderBy: { createdAt: 'DESC' },
    },
    { tenantId, organizationId },
  )

  return NextResponse.json({
    anchorEventId: parsed.eventId,
    neighbors: neighbors
      .filter((row) => entityPairs.includes(`${row.entityType}:${row.entityId}`))
      .map((row) => ({
        eventId: row.decisionEvent.id,
        entityType: row.entityType,
        entityId: row.entityId,
        relationshipType: row.relationshipType,
        createdAt: row.createdAt,
      })),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Context graph neighbors',
  methods: {
    GET: {
      summary: 'List neighboring decisions for anchor event',
      query: contextGraphNeighborsSchema,
      responses: [{ status: 200, description: 'Context neighbors', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 400, description: 'Invalid query', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
