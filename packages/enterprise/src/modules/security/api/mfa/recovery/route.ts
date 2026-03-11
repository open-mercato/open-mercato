import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { issueVerifiedMfaToken, mapMfaError, readJsonRecord, readString, resolveMfaRequestContext, setAuthCookie } from '../_shared'

const requestSchema = z.object({
  code: z.string().min(1),
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
  const code = readString(body.code)
  if (!code) {
    return securityApiError(400, 'code is required.')
  }

  try {
    const verified = await context.mfaVerificationService.verifyRecoveryCode(context.auth.sub, code)
    if (!verified) {
      return securityApiError(401, 'Invalid recovery code.')
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
  summary: 'MFA recovery routes',
  methods: {
    POST: {
      summary: 'Verify MFA recovery code during login flow',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'Recovery challenge verified', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Invalid recovery code', schema: securityErrorSchema },
        { status: 403, description: 'Pending MFA context required', schema: securityErrorSchema },
      ],
    },
  },
})
