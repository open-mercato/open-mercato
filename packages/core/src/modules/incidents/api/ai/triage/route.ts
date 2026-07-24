import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  findSimilarIncidents,
  loadIncidentCatalogs,
  runIncidentsObjectAgent,
  type IncidentsAiRunResult,
  type IncidentAiCatalogs,
  type IncidentAiScope,
  type SimilarIncident,
} from '../../../lib/aiRuntime'

const REQUIRED_FEATURES = ['incidents.incident.view', 'incidents.ai.use'] as const

const triageRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8000).optional(),
})

type TriageRequest = z.infer<typeof triageRequestSchema>

const triageSuggestionSchema = z.object({
  severityKey: z.string(),
  typeKey: z.string(),
  priorityKey: z.string().optional(),
  rationale: z.string(),
  possibleDuplicateIds: z.array(z.string()),
})

type TriageSuggestion = z.infer<typeof triageSuggestionSchema>

const similarIncidentSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  title: z.string(),
  status: z.string(),
})

const triageResponseSchema = z.object({
  suggestion: triageSuggestionSchema.nullable(),
  similar: z.array(similarIncidentSchema),
})

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
    locale?: string | null
  }
} | NextResponse> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return jsonError(401, 'unauthorized')
  const { locale } = await resolveTranslations()

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
      locale,
    },
  }
}

function buildTriagePrompt(
  input: TriageRequest,
  catalogs: IncidentAiCatalogs,
  similar: SimilarIncident[],
): string {
  return [
    'Suggest severity and type for a new incident.',
    '',
    `Title: ${input.title}`,
    `Description: ${input.description?.trim() || '(none)'}`,
    '',
    'Severity catalog:',
    JSON.stringify(catalogs.severities, null, 2),
    '',
    'Type catalog:',
    JSON.stringify(catalogs.types, null, 2),
    '',
    'Priority catalog:',
    JSON.stringify(catalogs.priorities, null, 2),
    '',
    'Similar incidents:',
    JSON.stringify(similar, null, 2),
    '',
    'Return only keys from the provided catalogs. Include priorityKey only when a priority match is clear. The rationale must be one sentence.',
  ].join('\n')
}

function responseForRunResult(
  result: IncidentsAiRunResult<TriageSuggestion>,
  similar: SimilarIncident[],
): NextResponse {
  if (result.ok) {
    return NextResponse.json({ suggestion: result.data, similar })
  }
  console.error('[incidents.ai.triage] failed', { incidentId: 'triage' }, result.error)
  if (result.reason === 'unavailable') return jsonError(503, result.code ?? 'ai_unavailable')
  return jsonError(500, 'ai_failed')
}

export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req)
    const parsed = triageRequestSchema.safeParse(body)
    if (!parsed.success) return jsonError(400, 'invalid_request')

    const context = await resolveAiRequestContext(req)
    if (context instanceof NextResponse) return context

    const searchText = [parsed.data.title, parsed.data.description ?? ''].join('\n')
    const [catalogs, similar] = await Promise.all([
      loadIncidentCatalogs(context.container, context.scope),
      findSimilarIncidents(context.container, context.scope, searchText, 5),
    ])
    const result = await runIncidentsObjectAgent<TriageSuggestion>({
      agentId: 'incidents.triage',
      container: context.container,
      authContext: context.authContext,
      input: buildTriagePrompt(parsed.data, catalogs, similar),
    })
    return responseForRunResult(result, similar)
  } catch (error) {
    console.error('[incidents.ai.triage] failed', { incidentId: 'triage' }, error)
    return jsonError(500, 'ai_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident AI triage',
  methods: {
    POST: {
      summary: 'Suggest incident severity and type',
      description: 'Suggests severity and type from a title, optional description, tenant catalogs, and similar incidents.',
      requestBody: {
        contentType: 'application/json',
        schema: triageRequestSchema,
      },
      responses: [
        { status: 200, description: 'Triage suggestion', schema: triageResponseSchema },
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 500, description: 'AI failed', schema: errorResponseSchema },
        { status: 503, description: 'AI unavailable', schema: errorResponseSchema },
      ],
    },
  },
}
