import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sudoChallengeVerifySchema } from '../../../data/validators'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { mapSudoError, resolveSudoContext } from '../_shared'

const verifyResponseSchema = z.object({
  sudoToken: z.string(),
  expiresAt: z.string(),
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

  const parsed = sudoChallengeVerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const result = await context.sudoChallengeService.verify(
      parsed.data.sessionId,
      parsed.data.methodType,
      parsed.data.payload,
      {
        targetType: parsed.data.targetType,
        targetIdentifier: parsed.data.targetIdentifier,
      },
    )
    return NextResponse.json({
      sudoToken: result.sudoToken,
      expiresAt: result.expiresAt.toISOString(),
    })
  } catch (error) {
    return mapSudoError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Sudo verification routes',
  methods: {
    POST: {
      summary: 'Verify a sudo challenge',
      requestBody: {
        contentType: 'application/json',
        schema: sudoChallengeVerifySchema,
      },
      responses: [
        { status: 200, description: 'Sudo token issued', schema: verifyResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized or verification failed', schema: securityErrorSchema },
      ],
    },
  },
})
