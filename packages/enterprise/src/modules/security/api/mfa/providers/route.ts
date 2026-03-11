import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { mapMfaError, resolveMfaRequestContext } from '../_shared'

const providersResponseSchema = z.object({
  providers: z.array(z.object({
    type: z.string(),
    label: z.string(),
    icon: z.string(),
    allowMultiple: z.boolean(),
    components: z.object({
      setup: z.string().optional(),
      list: z.string().optional(),
      details: z.string().optional(),
      challenge: z.string().optional(),
    }).optional(),
  })),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.profile.view'] },
}

export async function GET(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  if (!context.auth.tenantId) {
    return securityApiError(400, 'Tenant context is required.')
  }

  try {
    const providers = await context.mfaService.getAvailableProviders(
      context.auth.tenantId,
      context.auth.orgId ?? undefined,
    )
    return NextResponse.json({ providers })
  } catch (error) {
    return await mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA provider routes',
  methods: {
    GET: {
      summary: 'List available MFA providers',
      responses: [{ status: 200, description: 'Available MFA providers', schema: providersResponseSchema }],
      errors: [
        { status: 400, description: 'Missing tenant context', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
