import { NextResponse } from 'next/server'
import { z } from 'zod'
import { EnforcementScope } from '../../../data/entities'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { mapEnforcementError, resolveEnforcementContext } from '../_shared'

const complianceQuerySchema = z.object({
  scope: z.nativeEnum(EnforcementScope).default(EnforcementScope.PLATFORM),
  scopeId: z.string().optional(),
})

const complianceResponseSchema = z.object({
  scope: z.nativeEnum(EnforcementScope),
  scopeId: z.string().nullable(),
  total: z.number().int().nonnegative(),
  enrolled: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.admin.manage'] },
}

export async function GET(req: Request) {
  const context = await resolveEnforcementContext(req)
  if (context instanceof NextResponse) return context

  const url = new URL(req.url)
  const parsedQuery = complianceQuerySchema.safeParse({
    scope: url.searchParams.get('scope') ?? undefined,
    scopeId: url.searchParams.get('scopeId') ?? undefined,
  })
  if (!parsedQuery.success) {
    return securityApiError(400, 'Invalid query parameters', { issues: parsedQuery.error.issues })
  }

  try {
    const report = await context.enforcementService.getComplianceReport(
      parsedQuery.data.scope,
      parsedQuery.data.scopeId,
    )
    return NextResponse.json({
      scope: parsedQuery.data.scope,
      scopeId: parsedQuery.data.scopeId ?? null,
      ...report,
    })
  } catch (error) {
    return await mapEnforcementError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Enforcement compliance routes',
  methods: {
    GET: {
      summary: 'Get compliance summary for enforcement scope',
      query: complianceQuerySchema,
      responses: [
        { status: 200, description: 'Compliance summary', schema: complianceResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
