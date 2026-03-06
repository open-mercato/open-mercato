import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, readJsonRecord, resolveMfaRequestContext } from '../../_shared'

const responseSchema = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()).optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['security.mfa.manage'] },
}

export async function POST(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  const body = await readJsonRecord(req)

  if (typeof body.setupId !== 'string' || body.setupId.trim().length === 0) {
    return NextResponse.json({ error: 'setupId is required.' }, { status: 400 })
  }

  try {
    const result = await context.mfaService.completeRegistration(
      context.auth.sub,
      body,
      typeof body.label === 'string' ? body.label : undefined,
    )
    return NextResponse.json({ ok: true, ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) })
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Passkey register routes',
  methods: {
    POST: {
      summary: 'Register passkey',
      requestBody: {
        contentType: 'application/json',
        schema: z.record(z.string(), z.unknown()),
      },
      responses: [{ status: 200, description: 'Passkey registered', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid passkey payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
