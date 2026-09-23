import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

/**
 * Audit chain by instigator (Agent Identity & On-Behalf-Of, Wave 4 P2).
 *
 * Returns every action a given human caused **directly** (`actor_user_id = human`)
 * AND **via agents** (`on_behalf_of_user_id = human`, where the actor is the
 * agent principal). Both arms are read from the SAME `action_logs` table written
 * through the audited Command path — there is no parallel audit store. Org-scoped:
 * every row is filtered by the caller's `organization_id`, so org B can never read
 * org A's chain. RBAC-gated by `agent_orchestrator.identity.read`.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.identity.read'] },
}

const humanUserIdSchema = z.string().uuid()
const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
})

type RouteContext = { params: Promise<{ humanUserId: string }> }

const errorSchema = z.object({ error: z.string() })

const entrySchema = z.object({
  id: z.string(),
  commandId: z.string().nullable(),
  actionType: z.string().nullable(),
  actionLabel: z.string().nullable(),
  sourceKey: z.string().nullable(),
  resourceKind: z.string().nullable(),
  resourceId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  onBehalfOfUserId: z.string().nullable(),
  createdAt: z.string().nullable(),
  /** `'direct'` when the human is the actor; `'via_agent'` when an agent acted on their behalf. */
  via: z.enum(['direct', 'via_agent']),
})

export const responseSchema = z.object({
  humanUserId: z.string(),
  items: z.array(entrySchema),
  total: z.number(),
})

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { humanUserId } = await ctx.params
  const parsedId = humanUserIdSchema.safeParse(humanUserId)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid user id' }, { status: 404 })

  const url = new URL(req.url)
  const parsedQuery = querySchema.safeParse({ limit: url.searchParams.get('limit') ?? undefined })
  if (!parsedQuery.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const organizationId = auth.orgId ?? null
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  let query = (em.getKysely<Record<string, never>>() as any)
    .selectFrom('action_logs')
    .select([
      'action_logs.id as id',
      'action_logs.command_id as commandId',
      'action_logs.action_type as actionType',
      'action_logs.action_label as actionLabel',
      'action_logs.source_key as sourceKey',
      'action_logs.resource_kind as resourceKind',
      'action_logs.resource_id as resourceId',
      'action_logs.actor_user_id as actorUserId',
      'action_logs.on_behalf_of_user_id as onBehalfOfUserId',
      'action_logs.created_at as createdAt',
    ])
    .where('action_logs.deleted_at', 'is', null)
    .where('action_logs.tenant_id', '=', auth.tenantId)
    .where((eb: any) =>
      eb.or([
        eb('action_logs.actor_user_id', '=', parsedId.data),
        eb('action_logs.on_behalf_of_user_id', '=', parsedId.data),
      ]),
    )

  // Org-scope: pin the caller's organization so a human's chain never crosses orgs.
  if (organizationId) query = query.where('action_logs.organization_id', '=', organizationId)

  const rows = await query
    .orderBy('action_logs.created_at', 'desc')
    .orderBy('action_logs.id', 'desc')
    .limit(parsedQuery.data.limit)
    .execute()

  const items = (rows as Array<Record<string, unknown>>).map((row) => {
    const onBehalfOf = (row.onBehalfOfUserId as string | null) ?? null
    const createdAt = row.createdAt
    return {
      id: String(row.id),
      commandId: (row.commandId as string | null) ?? null,
      actionType: (row.actionType as string | null) ?? null,
      actionLabel: (row.actionLabel as string | null) ?? null,
      sourceKey: (row.sourceKey as string | null) ?? null,
      resourceKind: (row.resourceKind as string | null) ?? null,
      resourceId: (row.resourceId as string | null) ?? null,
      actorUserId: (row.actorUserId as string | null) ?? null,
      onBehalfOfUserId: onBehalfOf,
      createdAt:
        createdAt instanceof Date
          ? createdAt.toISOString()
          : createdAt != null
            ? String(createdAt)
            : null,
      via: onBehalfOf === parsedId.data ? ('via_agent' as const) : ('direct' as const),
    }
  })

  return NextResponse.json({ humanUserId: parsedId.data, items, total: items.length })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Audit chain by instigator',
  methods: {
    GET: {
      summary: 'List actions a human caused directly and via agents',
      description:
        'Returns ActionLog entries where the human is either the direct actor or the on-behalf-of principal of an agent action, joined on action_logs.on_behalf_of_user_id. Org-scoped; gated by agent_orchestrator.identity.read.',
      responses: [{ status: 200, description: 'Instigator audit chain', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.identity.read', schema: errorSchema },
        { status: 404, description: 'Invalid user id', schema: errorSchema },
      ],
    },
  },
}
