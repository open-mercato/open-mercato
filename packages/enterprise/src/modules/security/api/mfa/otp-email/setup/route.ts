import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, readJsonRecord, resolveMfaRequestContext } from '../../_shared'

const responseSchema = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()).optional(),
})

export const metadata = {
  POST: { requireAuth: true},
}

export async function POST(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  const body = await readJsonRecord(req)

  try {
    const result = await context.mfaService.setupOtpEmail(
      context.auth.sub,
      body,
    )
    return NextResponse.json({ ok: true, ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) })
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'OTP email setup routes',
  methods: {
    POST: {
      summary: 'Enable OTP email MFA',
      requestBody: {
        contentType: 'application/json',
        schema: z.object({
          email: z.string().email().optional(),
          label: z.string().min(1).optional(),
        }).optional(),
      },
      responses: [{ status: 200, description: 'OTP email enabled', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
