import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAgentEntry, ensureAgentsLoaded } from '../../../../lib/sdk/defineAgent'
import { AgentSetting } from '../../../../data/entities'
import { agentIconWriteSchema } from '../../../../data/validators'
import { AGENT_ICON_NAMES } from '../../../../data/agentIcons'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.manage'] },
}

const responseSchema = z.object({
  agentId: z.string(),
  icon: z.enum(AGENT_ICON_NAMES).nullable(),
  updatedAt: z.string(),
})

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function PUT(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant scope required' }, { status: 400 })
  }
  const { id } = await ctx.params

  await ensureAgentsLoaded()
  if (!getAgentEntry(id)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const parsed = agentIconWriteSchema.safeParse(await readJsonSafe(req, {}))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const existing = await em.findOne(AgentSetting, { ...scope, agentId: id })

  if (existing) {
    // Optimistic lock only applies to an update of an existing row; a first-time
    // write (no row) has nothing to conflict with.
    try {
      enforceCommandOptimisticLock({
        resourceKind: 'agent_orchestrator.agent_setting',
        resourceId: existing.id,
        current: existing.updatedAt,
        expected: parsed.data.updatedAt ?? undefined,
        request: req,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
    existing.icon = parsed.data.icon
    await em.flush()
    return NextResponse.json({ agentId: id, icon: existing.icon ?? null, updatedAt: existing.updatedAt.toISOString() })
  }

  const created = em.create(AgentSetting, { ...scope, agentId: id, icon: parsed.data.icon })
  em.persist(created)
  await em.flush()
  return NextResponse.json({ agentId: id, icon: created.icon ?? null, updatedAt: created.updatedAt.toISOString() })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Update agent presentation settings',
  methods: {
    PUT: {
      summary: "Set an agent's presentation icon",
      description:
        'Upserts the per-(tenant, organization) presentation icon for an agent definition. Optimistic-locked on the settings row updatedAt. Gated by agent_orchestrator.agents.manage.',
      responses: [{ status: 200, description: 'Updated settings', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Validation failed / missing scope', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.manage', schema: errorSchema },
        { status: 404, description: 'Unknown agent id', schema: errorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: errorSchema },
      ],
    },
  },
}
