import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
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
    return NextResponse.json({ error: 'MFA pending token is required.' }, { status: 403 })
  }

  const body = await readJsonRecord(req)
  const challengeId = readString(body.challengeId)
  const methodType = readString(body.methodType)
  if (!challengeId || !methodType) {
    return NextResponse.json({ error: 'challengeId and methodType are required.' }, { status: 400 })
  }

  try {
    const prepared = await context.mfaVerificationService.prepareChallenge(challengeId, methodType)
    return NextResponse.json({ ok: true, ...(prepared.clientData ? { clientData: prepared.clientData } : {}) })
  } catch (error) {
    return mapMfaError(error)
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
