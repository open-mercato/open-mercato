import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, readJsonRecord, resolveMfaRequestContext } from '../../_shared'

const responseSchema = z.object({
  setupId: z.string(),
  uri: z.string(),
  secret: z.string(),
  qrDataUrl: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['security.mfa.manage'] },
}

export async function POST(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  const body = await readJsonRecord(req)

  try {
    const result = await context.mfaService.setupTotp(
      context.auth.sub,
      typeof body.label === 'string' ? body.label : undefined,
    )
    return NextResponse.json(result)
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'TOTP setup routes',
  methods: {
    POST: {
      summary: 'Begin TOTP setup',
      requestBody: {
        contentType: 'application/json',
        schema: z.object({ label: z.string().min(1).optional() }).optional(),
      },
      responses: [{ status: 200, description: 'TOTP setup payload', schema: responseSchema }],
      errors: [{ status: 401, description: 'Unauthorized', schema: securityErrorSchema }],
    },
  },
})
