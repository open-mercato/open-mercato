import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { probeAiAvailability } from '../../../lib/aiRuntime'

const REQUIRED_FEATURES = ['incidents.incident.view', 'incidents.ai.use'] as const

const availabilityReasonSchema = z.enum(['no_provider', 'runtime_missing'])

const availabilityResponseSchema = z.union([
  z.object({ available: z.literal(true) }),
  z.object({
    available: z.literal(false),
    reason: availabilityReasonSchema,
  }),
])

const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [...REQUIRED_FEATURES] },
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

async function resolveAiRequestContext(req: Request): Promise<{
  container: AwilixContainer
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
    authContext: {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
      features: acl.features,
      isSuperAdmin: acl.isSuperAdmin || authIsSuperAdmin(auth),
    },
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveAiRequestContext(req)
    if (context instanceof NextResponse) return context
    const availability = await probeAiAvailability(context.container, context.authContext)
    return NextResponse.json(availability)
  } catch (error) {
    console.error('[incidents.ai.availability] failed', error)
    return jsonError(500, 'ai_probe_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident AI availability',
  methods: {
    GET: {
      summary: 'Check incident AI availability',
      description: 'Returns whether the incident AI provider/runtime is available for the authenticated organization.',
      responses: [
        { status: 200, description: 'AI availability', schema: availabilityResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
      ],
    },
  },
}
