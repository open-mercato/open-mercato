import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentPostmortem } from '../../data/entities'

const postmortemsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['draft', 'published']).optional(),
})

const postmortemListItemSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  incidentNumber: z.string(),
  incidentTitle: z.string(),
  status: z.string(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  summary: z.string().nullable(),
})

const postmortemsListResponseSchema = z.object({
  items: z.array(postmortemListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})

const postmortemsErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.postmortem.view'] },
}

type RequestContext = {
  em: EntityManager
  organizationId: string
  tenantId: string
}

type PostmortemListItem = z.infer<typeof postmortemListItemSchema>

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) throw new CrudHttpError(401, { error: '[internal] unauthorized' })

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: '[internal] organization_required' })

  return {
    em: (container.resolve('em') as EntityManager).fork(),
    organizationId,
    tenantId: auth.tenantId,
  }
}

function normalizeDate(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

function truncateSummary(value: string | null | undefined): string | null {
  const summary = typeof value === 'string' ? value.trim() : ''
  if (!summary) return null
  if (summary.length <= 240) return summary
  return `${summary.slice(0, 237)}...`
}

function serializePostmortem(
  postmortem: IncidentPostmortem,
  incident: Incident,
): PostmortemListItem {
  return {
    id: postmortem.id,
    incidentId: postmortem.incidentId,
    incidentNumber: incident.number,
    incidentTitle: incident.title,
    status: postmortem.status,
    publishedAt: normalizeDate(postmortem.publishedAt),
    updatedAt: postmortem.updatedAt.toISOString(),
    summary: truncateSummary(postmortem.summary),
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = postmortemsListQuerySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    })
    const { em, organizationId, tenantId } = await resolveRequestContext(req)
    const scope = { organizationId, tenantId }
    const where = {
      ...scope,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    }
    const total = await em.count(IncidentPostmortem, where)
    const postmortems = await findWithDecryption(
      em,
      IncidentPostmortem,
      where,
      {
        orderBy: { updatedAt: 'desc' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      },
      scope,
    )
    const incidentIds = Array.from(new Set(postmortems.map((postmortem) => postmortem.incidentId)))
    const incidents = incidentIds.length > 0
      ? await findWithDecryption(
          em,
          Incident,
          { id: { $in: incidentIds }, ...scope, deletedAt: null },
          undefined,
          scope,
        )
      : []
    const incidentById = new Map(incidents.map((incident) => [incident.id, incident]))
    const items = postmortems.flatMap((postmortem) => {
      const incident = incidentById.get(postmortem.incidentId)
      return incident ? [serializePostmortem(postmortem, incident)] : []
    })

    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.postmortems GET failed', err)
    return NextResponse.json({ error: '[internal] postmortems_list_failed' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident postmortems',
  methods: {
    GET: {
      summary: 'List incident postmortems',
      description: 'Returns decrypted incident postmortem summaries scoped to the authenticated organization.',
      query: postmortemsListQuerySchema,
      responses: [
        { status: 200, description: 'Incident postmortems', schema: postmortemsListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: postmortemsErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: postmortemsErrorResponseSchema },
      ],
    },
  },
}
