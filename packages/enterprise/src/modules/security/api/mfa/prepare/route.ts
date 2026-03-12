import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { mapMfaError, readJsonRecord, readString, resolveMfaRequestContext } from '../_shared'

const requestSchema = z.object({
  challengeId: z.string().min(1),
  methodType: z.string().min(1),
})

const responseSchema = z.object({
  ok: z.literal(true),
  clientData: z.record(z.string(), z.unknown()).optional(),
})

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  if (context.auth.mfa_pending !== true) {
    return securityApiError(403, 'MFA pending token is required.')
  }

  const body = await readJsonRecord(req)
  const challengeId = readString(body.challengeId)
  const methodType = readString(body.methodType)
  if (!challengeId || !methodType) {
    return securityApiError(400, 'challengeId and methodType are required.')
  }

  try {
    const prepared = await context.mfaVerificationService.prepareChallenge(challengeId, methodType, { request: req })
    return NextResponse.json({ ok: true, ...(prepared.clientData ? { clientData: prepared.clientData } : {}) })
  } catch (error) {
    return await mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA challenge prepare routes',
  methods: {
    POST: {
      summary: 'Prepare MFA challenge payload for selected method',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'MFA challenge prepared', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 403, description: 'Pending MFA context required', schema: securityErrorSchema },
      ],
    },
  },
})
