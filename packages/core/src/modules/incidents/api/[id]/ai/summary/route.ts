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

const summaryResponseSchema = z.object({
  summary: z.string(),
  keyEvents: z.array(z.string()),
})

type SummaryResponse = z.infer<typeof summaryResponseSchema>

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

function buildSummaryPrompt(context: IncidentAiContext): string {
  return [
    'Create a living summary for this incident.',
    '',
    'Incident:',
    JSON.stringify(context.incident, null, 2),
    '',
    'Timeline:',
    JSON.stringify(context.timeline, null, 2),
    '',
    'Return a concise summary and key events in chronological order. Cite the incident number in the summary.',
  ].join('\n')
}

function responseForRunResult(result: IncidentsAiRunResult<SummaryResponse>): NextResponse {
  if (result.ok) return NextResponse.json(result.data)
  if (result.reason === 'unavailable') return jsonError(503, 'ai_unavailable')
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

    const result = await runIncidentsObjectAgent<SummaryResponse>({
      agentId: 'incidents.summarizer',
      container: context.container,
      authContext: context.authContext,
      input: buildSummaryPrompt(incidentContext),
    })
    return responseForRunResult(result)
  } catch (error) {
    console.error('[incidents.ai.summary] failed', error)
    return jsonError(500, 'ai_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident AI summary',
  pathParams: pathParamsSchema,
  methods: {
    POST: {
      summary: 'Generate incident summary',
      description: 'Generates a non-persisted living summary and key events for one incident.',
      requestBody: {
        contentType: 'application/json',
        schema: emptyBodySchema,
      },
      responses: [
        { status: 200, description: 'Incident summary', schema: summaryResponseSchema },
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Incident not found', schema: errorResponseSchema },
        { status: 503, description: 'AI unavailable', schema: errorResponseSchema },
      ],
    },
  },
}
