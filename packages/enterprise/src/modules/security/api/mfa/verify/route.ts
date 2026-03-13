import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { issueVerifiedMfaToken, mapMfaError, readJsonRecord, readString, resolveMfaRequestContext, setAuthCookie } from '../_shared'

const requestSchema = z.object({
  challengeId: z.string().min(1),
  methodType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
})

const responseSchema = z.object({
  ok: z.literal(true),
  token: z.string(),
  redirect: z.string(),
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
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
  if (!challengeId || !methodType) {
    return securityApiError(400, 'challengeId and methodType are required.')
  }

  try {
    const verified = await context.mfaVerificationService.verifyChallenge(challengeId, methodType, payload, { request: req })
    if (!verified) {
      return securityApiError(401, 'Invalid MFA verification code.')
    }

    const methods = await context.mfaService.getUserMethods(context.auth.sub)
    const token = issueVerifiedMfaToken(context.auth, methods.map((method) => method.type))
    const response = NextResponse.json({ ok: true, token, redirect: '/backend' })
    setAuthCookie(response, token)
    return response
  } catch (error) {
    return await mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA challenge verify routes',
  methods: {
    POST: {
      summary: 'Verify MFA challenge during login flow',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'MFA challenge verified', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Invalid challenge response', schema: securityErrorSchema },
        { status: 403, description: 'Pending MFA context required', schema: securityErrorSchema },
      ],
    },
  },
})
