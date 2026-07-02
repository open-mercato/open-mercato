import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  loadIncidentAiContext,
  runIncidentsObjectAgent,
  type IncidentAiContext,
  type IncidentAiScope,
  type IncidentsAiRunResult,
} from '../../../../lib/aiRuntime'

const REQUIRED_FEATURES = ['incidents.incident.view', 'incidents.ai.use'] as const

const pathParamsSchema = z.object({
  id: z.string().uuid(),
})

const emptyBodySchema = z.object({}).strict()

const postmortemDraftResponseSchema = z.object({
  summary: z.string(),
  rootCause: z.string(),
  impact: z.string(),
  contributingFactors: z.string(),
  lessons: z.string(),
  actionItems: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
  })),
})

type PostmortemDraftResponse = z.infer<typeof postmortemDraftResponseSchema>

const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [...REQUIRED_FEATURES] },
}

type RbacAcl = {
  features: string[]
  isSuperAdmin: boolean
}

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<RbacAcl>
}

function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: `[internal] ${code}`, code }, { status })
}

function authIsSuperAdmin(auth: AuthContext): boolean {
  return !!auth && (auth as Record<string, unknown>).isSuperAdmin === true
}

async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function resolveAiRequestContext(req: Request): Promise<{
  container: AwilixContainer
  scope: IncidentAiScope
  authContext: {
    tenantId: string
    organizationId: string
    userId: string
    features: string[]
    isSuperAdmin: boolean
  }
} | NextResponse> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return jsonError(401, 'unauthorized')

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) return jsonError(400, 'organization_required')

  const rbacService = container.resolve<RbacServiceLike>('rbacService')
  const acl = await rbacService.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId,
  })

  return {
    container,
    scope: {
      tenantId: auth.tenantId,
      organizationId,
      organizationIds: scope?.filterIds ?? [organizationId],
    },
    authContext: {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
      features: acl.features,
      isSuperAdmin: acl.isSuperAdmin || authIsSuperAdmin(auth),
    },
  }
}

function buildPostmortemPrompt(context: IncidentAiContext): string {
  return [
    'Draft a postmortem for this incident.',
    '',
    'Incident:',
    JSON.stringify(context.incident, null, 2),
    '',
    'Timeline:',
    JSON.stringify(context.timeline, null, 2),
    '',
    'Impacts:',
    JSON.stringify(context.impacts, null, 2),
    '',
    'Participants:',
    JSON.stringify(context.participants, null, 2),
    '',
    'Use only supported facts. If root cause is not clear, state that it needs confirmation instead of inventing one.',
  ].join('\n')
}

function responseForRunResult(result: IncidentsAiRunResult<PostmortemDraftResponse>, incidentId: string): NextResponse {
  if (result.ok) return NextResponse.json(result.data)
  console.error('[incidents.ai.postmortem] failed', { incidentId }, result.error)
  if (result.reason === 'unavailable') return jsonError(503, result.code ?? 'ai_unavailable')
  return jsonError(500, 'ai_failed')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const parsedParams = pathParamsSchema.safeParse(params)
    if (!parsedParams.success) return jsonError(400, 'invalid_request')
    const body = await readJsonBody(req)
    if (!emptyBodySchema.safeParse(body).success) return jsonError(400, 'invalid_request')

    const context = await resolveAiRequestContext(req)
    if (context instanceof NextResponse) return context

    const incidentContext = await loadIncidentAiContext(context.container, context.scope, parsedParams.data.id, {
      timelineOrder: 'asc',
    })
    if (!incidentContext) return jsonError(404, 'incident_not_found')

    const result = await runIncidentsObjectAgent<PostmortemDraftResponse>({
      agentId: 'incidents.postmortem_writer',
      container: context.container,
      authContext: context.authContext,
      input: buildPostmortemPrompt(incidentContext),
    })
    return responseForRunResult(result, parsedParams.data.id)
  } catch (error) {
    console.error('[incidents.ai.postmortem] failed', { incidentId: params.id }, error)
    return jsonError(500, 'ai_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident AI postmortem draft',
  pathParams: pathParamsSchema,
  methods: {
    POST: {
      summary: 'Draft postmortem',
      description: 'Generates non-persisted postmortem draft fields for one incident.',
      requestBody: {
        contentType: 'application/json',
        schema: emptyBodySchema,
      },
      responses: [
        { status: 200, description: 'Postmortem draft', schema: postmortemDraftResponseSchema },
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Incident not found', schema: errorResponseSchema },
        { status: 503, description: 'AI unavailable', schema: errorResponseSchema },
      ],
    },
  },
}
