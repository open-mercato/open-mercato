import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ProcessDefinition } from '../../../data/entities'

/**
 * Process-definition detail for the edit form and detail page: the row, including
 * `updatedAt` for the optimistic-lock header, the bound `workflowId`, the declared
 * `triggers` list and the milestone vocabulary. Org-scoped — cross-org ids 404,
 * never the row.
 *
 * `grantedFeatures` is deliberately NOT here: execution identity is a property of
 * the bound WORKFLOW definition, which owns the grant and the least-privilege
 * principal core provisions from it. The form reads it from there.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Process definition not found' }, { status: 404 })
  }

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const definition = await findOneWithDecryption(
    em,
    ProcessDefinition,
    { id, ...scope, deletedAt: null },
    undefined,
    decryptionScope,
  )
  if (!definition) return NextResponse.json({ error: 'Process definition not found' }, { status: 404 })

  return NextResponse.json({ definition })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get process definition detail',
  methods: {
    GET: {
      summary: 'Get a process definition with its declared triggers',
      description:
        'Returns the process definition including updatedAt for optimistic locking, the bound workflowId, the declared triggers list (schedule / event / manual) and the milestone vocabulary. Org-scoped; gated by agent_orchestrator.processes.view.',
      responses: [{ status: 200, description: 'Process definition detail' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.processes.view', schema: errorSchema },
        { status: 404, description: 'Unknown process definition id', schema: errorSchema },
      ],
    },
  },
}
