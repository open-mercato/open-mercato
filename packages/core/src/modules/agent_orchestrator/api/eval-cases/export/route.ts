import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentEvalCase } from '../../../data/entities'
import {
  EVAL_CASE_EXPORT_VERSION,
  evalCaseExportQuerySchema,
  type EvalCaseExport,
  type EvalCaseExportItem,
} from '../../../data/validators'

/**
 * The agent_orchestrator eval-case export — the contract the lifecycle/eval
 * harness consumes as a regression gate. Only APPROVED cases are exported
 * (drafts/archived excluded); emitted in a versioned envelope (STABLE/ADDITIVE-ONLY).
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.export'] },
}

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const url = new URL(req.url)
  const query = evalCaseExportQuerySchema.parse(Object.fromEntries(url.searchParams))

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    status: 'approved',
    deletedAt: null,
  }
  if (query.agentDefinitionId) where.agentDefinitionId = query.agentDefinitionId

  const cases = await em.find(AgentEvalCase, where, { orderBy: { createdAt: 'asc' } })

  const items: EvalCaseExportItem[] = cases.map((evalCase) => ({
    id: evalCase.id,
    sourceType: evalCase.sourceType,
    agentDefinitionId: evalCase.agentDefinitionId,
    processType: evalCase.processType ?? null,
    input: evalCase.input,
    expected: evalCase.expected ?? null,
    assertions: evalCase.assertions ?? null,
    approvedByUserId: evalCase.approvedByUserId ?? null,
    createdAt: evalCase.createdAt.toISOString(),
  }))

  const envelope: EvalCaseExport = {
    version: EVAL_CASE_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    count: items.length,
    cases: items,
  }
  return NextResponse.json(envelope)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Export the agent eval-case set',
  methods: {
    GET: {
      summary: 'Export approved eval cases in the versioned agent_orchestrator eval-case format',
      description:
        'Returns a versioned envelope of APPROVED eval cases (drafts/archived excluded), org-scoped, optionally filtered by agentDefinitionId. Consumed by the lifecycle regression gate. Gated by agent_orchestrator.eval.export.',
      responses: [{ status: 200, description: 'The versioned eval-case export envelope' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.export', schema: errorSchema },
      ],
    },
  },
}
