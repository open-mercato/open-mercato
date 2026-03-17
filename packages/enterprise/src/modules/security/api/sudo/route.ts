import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { sudoChallengeInitSchema } from '../../data/validators'
import { buildSecurityOpenApi, securityErrorSchema } from '../openapi'
import { securityApiError } from '../i18n'
import { mapSudoError, resolveSudoContext } from './_shared'

const sudoStatusResponseSchema = z.object({
  ok: z.literal(true),
  enabled: z.literal(true),
})

const sudoChallengeResponseSchema = z.object({
  required: z.boolean(),
  sessionId: z.string().uuid().optional(),
  method: z.enum(['password', 'mfa']).optional(),
  availableMfaMethods: z.array(z.object({
    type: z.string(),
    label: z.string(),
    icon: z.string(),
  })).optional(),
  expiresAt: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
}

export async function GET() {
  return NextResponse.json({ ok: true, enabled: true })
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

  const parsed = sudoChallengeInitSchema.safeParse(body)
  if (!parsed.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsed.error.issues })
  }

  try {
    const result = await context.sudoChallengeService.initiate(context.auth.sub, parsed.data.targetIdentifier, {
      tenantId: context.auth.tenantId,
      organizationId: context.auth.orgId,
    })
    return NextResponse.json({
      ...result,
      expiresAt: result.expiresAt?.toISOString(),
    })
  } catch (error) {
    return await mapSudoError(error)
  }
}

export const openApi: OpenApiRouteDoc = buildSecurityOpenApi({
  summary: 'Sudo challenge routes',
  methods: {
    GET: {
      summary: 'Get sudo feature status',
      responses: [
        { status: 200, description: 'Sudo feature status', schema: sudoStatusResponseSchema },
      ],
    },
    POST: {
      summary: 'Initiate sudo challenge',
      requestBody: {
        contentType: 'application/json',
        schema: sudoChallengeInitSchema,
      },
      responses: [
        { status: 200, description: 'Sudo challenge created', schema: sudoChallengeResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
