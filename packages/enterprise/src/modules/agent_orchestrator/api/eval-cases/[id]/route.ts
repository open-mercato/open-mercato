import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentEvalCase } from '../../../data/entities'
import { agentOrchestratorTag } from '../../openapi'

/**
 * The ONLY route that exposes a case's payload.
 *
 * The list route is a deliberate metadata-only projection so it can never leak
 * `input`/`expected` in bulk; those columns are encrypted at rest and are read
 * here through `findOneWithDecryption`, one record at a time, behind
 * `eval.manage`. Without this route the workbench could not show an author what a
 * case actually contains.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid eval case id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const evalCase = await findOneWithDecryption(
    em,
    AgentEvalCase,
    { id, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  // Org-scoped 404: a cross-tenant id must not be distinguishable from a missing one.
  if (!evalCase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id: evalCase.id,
    status: evalCase.status,
    source_type: evalCase.sourceType,
    source_id: evalCase.sourceId,
    agent_definition_id: evalCase.agentDefinitionId,
    process_type: evalCase.processType ?? null,
    input: evalCase.input ?? null,
    expected: evalCase.expected ?? null,
    assertions: evalCase.assertions ?? null,
    approved_by_user_id: evalCase.approvedByUserId ?? null,
    created_at: evalCase.createdAt.toISOString(),
    updated_at: evalCase.updatedAt.toISOString(),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Get an eval case with its payload',
  methods: {
    GET: {
      summary: 'Full eval case including the decrypted input and expected value',
      description:
        'The only endpoint that returns a case payload. `input` and `expected` are encrypted at rest and decrypted per record here; the list route projects metadata only and never exposes them. Returns `updatedAt` for optimistic locking. Cross-tenant ids return 404. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'The eval case' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 404, description: 'Eval case not found (or cross-tenant)', schema: errorSchema },
      ],
    },
  },
}
