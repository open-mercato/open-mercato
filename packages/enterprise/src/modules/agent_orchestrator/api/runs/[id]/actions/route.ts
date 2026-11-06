import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProposal, AgentRun } from '../../../../data/entities'
import {
  buildRunActionCorrelationKeys,
  parseCorrelationKeys,
  RUN_ACTIONS_MAX_PAGE_SIZE,
} from '../../../../lib/identity/runActionCorrelation'

/**
 * The domain writes a run caused: action-log entries whose correlation keys carry
 * this run id, or the id of one of its proposals (effector writes after approval).
 * Read through the audit_logs action-log service, which decrypts the entries.
 * Org-scoped — a run outside the caller's organization returns 404.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view', 'audit_logs.view_tenant'] },
}

const idSchema = z.string().uuid()

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(RUN_ACTIONS_MAX_PAGE_SIZE).default(50),
})

type RouteContext = { params: Promise<{ id: string }> }

type ActionLogRow = {
  id: string
  commandId: string
  actionLabel: string | null
  resourceKind: string | null
  resourceId: string | null
  actorUserId: string | null
  onBehalfOfUserId: string | null
  sourceKey: string | null
  correlationKeys: string[] | null
  createdAt: Date | string
}

type ActionLogServiceLike = {
  listByCorrelationKeys: (params: {
    tenantId: string
    organizationId: string
    keys: string[]
    page: number
    pageSize: number
  }) => Promise<{ items: ActionLogRow[]; total: number }>
}

const errorSchema = z.object({ error: z.string() })

const actionItemSchema = z.object({
  id: z.string(),
  commandId: z.string(),
  actionLabel: z.string().nullable(),
  resourceKind: z.string().nullable(),
  resourceId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  onBehalfOfUserId: z.string().nullable(),
  sourceKey: z.string().nullable(),
  correlation: z.record(z.string(), z.string()),
  createdAt: z.string(),
})

export const responseSchema = z.object({
  items: z.array(actionItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

function resolveActionLogService(container: unknown): ActionLogServiceLike | null {
  const registry = container as { hasRegistration?: (name: string) => boolean; resolve: (name: string) => unknown }
  if (typeof registry.hasRegistration !== 'function' || !registry.hasRegistration('actionLogService')) return null
  const service = registry.resolve('actionLogService') as Partial<ActionLogServiceLike> | null
  return service && typeof service.listByCorrelationKeys === 'function' ? (service as ActionLogServiceLike) : null
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const url = new URL(req.url)
  const parsedQuery = querySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsedQuery.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const { page, pageSize } = parsedQuery.data

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const run = await findOneWithDecryption(
    em,
    AgentRun,
    { id: parsedId.data, ...scope, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const empty = { items: [], total: 0, page, pageSize }
  const service = resolveActionLogService(container)
  if (!service || !run.organizationId) return NextResponse.json(empty)

  const proposals = await em.find(
    AgentProposal,
    { runId: run.id, tenantId: run.tenantId, organizationId: run.organizationId },
    { fields: ['id'] },
  )
  const keys = buildRunActionCorrelationKeys(run.id, proposals.map((proposal) => proposal.id))
  const result = await service.listByCorrelationKeys({
    tenantId: run.tenantId,
    organizationId: run.organizationId,
    keys,
    page,
    pageSize,
  })

  return NextResponse.json({
    items: result.items.map((entry) => ({
      id: entry.id,
      commandId: entry.commandId,
      actionLabel: entry.actionLabel ?? null,
      resourceKind: entry.resourceKind ?? null,
      resourceId: entry.resourceId ?? null,
      actorUserId: entry.actorUserId ?? null,
      onBehalfOfUserId: entry.onBehalfOfUserId ?? null,
      sourceKey: entry.sourceKey ?? null,
      correlation: parseCorrelationKeys(entry.correlationKeys),
      createdAt: toIsoString(entry.createdAt),
    })),
    total: result.total,
    page,
    pageSize,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'List the actions an agent run caused',
  methods: {
    GET: {
      summary: 'List action-log entries correlated with an agent run',
      description:
        'Returns the decrypted action-log entries whose correlation carries this run id (`agentRunId`) or the id of one of its proposals (`proposalId`, effector writes after approval), newest first. `correlation` is the id-shaped correlation subset recorded on the entry. Org-scoped (404 for a run outside the caller organization); requires agent_orchestrator.trace.view and audit_logs.view_tenant; pageSize is capped at 100.',
      query: querySchema,
      responses: [{ status: 200, description: 'Run actions', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view or audit_logs.view_tenant', schema: errorSchema },
        { status: 404, description: 'Unknown run id', schema: errorSchema },
      ],
    },
  },
}
