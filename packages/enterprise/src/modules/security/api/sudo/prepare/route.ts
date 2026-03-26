import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sudoChallengePrepareSchema } from '../../../data/validators'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { mapSudoError, resolveSudoContext } from '../_shared'

const prepareResponseSchema = z.object({
  clientData: z.record(z.string(), z.unknown()).optional(),
})

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const parsed = sudoChallengePrepareSchema.safeParse(body)
  if (!parsed.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsed.error.issues })
  }

  try {
    const result = await context.sudoChallengeService.prepare(parsed.data.sessionId, parsed.data.methodType, req)
    return NextResponse.json(result)
  } catch (error) {
    return await mapSudoError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Sudo prepare challenge routes',
  methods: {
    POST: {
      summary: 'Prepare a sudo MFA challenge',
      requestBody: {
        contentType: 'application/json',
        schema: sudoChallengePrepareSchema,
      },
      responses: [
        { status: 200, description: 'Sudo challenge prepared', schema: prepareResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
