import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../openapi'
import { securityApiError } from '../i18n'
import { mapMfaError, resolveMfaRequestContext } from './_shared'

const mfaSummaryResponseSchema = z.object({
  methods: z.array(z.object({
    id: z.string().uuid(),
    type: z.string(),
    label: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
  })),
  providers: z.array(z.object({
    type: z.string(),
    label: z.string(),
    icon: z.string(),
    allowMultiple: z.boolean(),
  })),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.profile.view'] },
}

export async function GET(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  try {
    if (!context.auth.tenantId) {
      return securityApiError(400, 'Tenant context is required.')
    }

    const [methods, providers] = await Promise.all([
      context.mfaService.getUserMethods(context.auth.sub),
      context.mfaService.getAvailableProviders(context.auth.tenantId, context.auth.orgId ?? undefined),
    ])

    return NextResponse.json({
      methods: methods.map((method) => ({
        id: method.id,
        type: method.type,
        label: method.label ?? null,
        lastUsedAt: method.lastUsedAt ? method.lastUsedAt.toISOString() : null,
        createdAt: method.createdAt.toISOString(),
      })),
      providers,
    })
  } catch (error) {
    return await mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA summary routes',
  methods: {
    GET: {
      summary: 'Get user MFA summary',
      description: 'Returns enrolled MFA methods and available provider types for current user scope.',
      responses: [
        { status: 200, description: 'MFA summary payload', schema: mfaSummaryResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant scope', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
