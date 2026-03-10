import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, readJsonRecord, resolveMfaRequestContext } from '../../_shared'

const responseSchema = z.object({
  setupId: z.string(),
  options: z.record(z.string(), z.unknown()),
})

export const metadata = {
  POST: { requireAuth: true},
}

export async function POST(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  const body = await readJsonRecord(req)

  try {
    const result = await context.mfaService.getRegistrationOptions(
      context.auth.sub,
      body,
    )

    return NextResponse.json({
      setupId: result.setupId,
      options: result.clientData,
    })
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Passkey register options routes',
  methods: {
    POST: {
      summary: 'Get passkey registration options',
      requestBody: {
        contentType: 'application/json',
        schema: z.object({
          label: z.string().min(1).optional(),
          authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
        }).optional(),
      },
      responses: [{ status: 200, description: 'Passkey options', schema: responseSchema }],
      errors: [{ status: 401, description: 'Unauthorized', schema: securityErrorSchema }],
    },
  },
})
