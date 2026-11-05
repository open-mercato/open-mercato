import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { mapMfaError, resolveMfaRequestContext } from '../_shared'

const methodsResponseSchema = z.object({
  methods: z.array(z.object({
    id: z.string().uuid(),
    type: z.string(),
    label: z.string().nullable(),
    providerMetadata: z.record(z.string(), z.unknown()).nullable(),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
  })),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.profile.view'] },
}

export async function GET(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  try {
    const methods = await context.mfaService.getUserMethods(context.auth.sub)
    return NextResponse.json({
      methods: methods.map((method) => ({
        id: method.id,
        type: method.type,
        label: method.label ?? null,
        providerMetadata: method.providerMetadata ?? null,
        lastUsedAt: method.lastUsedAt ? method.lastUsedAt.toISOString() : null,
        createdAt: method.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA methods routes',
  methods: {
    GET: {
      summary: 'Get current user MFA methods',
      responses: [{ status: 200, description: 'User MFA methods', schema: methodsResponseSchema }],
      errors: [{ status: 401, description: 'Unauthorized', schema: securityErrorSchema }],
    },
  },
})
