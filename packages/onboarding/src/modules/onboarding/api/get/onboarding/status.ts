import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { sendWorkspaceReadyEmail } from '@open-mercato/onboarding/modules/onboarding/lib/ready-email'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  path: '/onboarding/onboarding/status',
  GET: {
    requireAuth: false,
  },
}

const onboardingStatusQuerySchema = z.object({
  tenantId: z.string().uuid(),
})

export async function GET(req: Request) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') || url.searchParams.get('tenant') || ''
  const parsed = onboardingStatusQuerySchema.safeParse({ tenantId })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid tenant id.' }, { status: 400 })
  }

  const baseUrl = process.env.APP_URL || `${url.protocol}//${url.host}`
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)
  const request = await service.findLatestByTenantId(parsed.data.tenantId)
  if (!request) {
    return NextResponse.json({ ok: false, error: 'Onboarding request not found.' }, { status: 404 })
  }

  let emailSent = Boolean(request.readyEmailSentAt)
  const ready = request.status === 'completed' && Boolean(request.preparationCompletedAt)
  const loginUrl = ready && request.tenantId ? `${baseUrl}/login?tenant=${encodeURIComponent(request.tenantId)}` : null

  if (ready && request.tenantId && !request.readyEmailSentAt) {
    try {
      emailSent = await sendWorkspaceReadyEmail({
        requestId: request.id,
        baseUrl,
        tenantId: request.tenantId,
      })
    } catch (error) {
      console.error('[onboarding.status] ready email retry failed', {
        requestId: request.id,
        tenantId: request.tenantId,
        organizationId: request.organizationId,
        error,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    status: request.status,
    ready,
    emailSent,
    tenantId: request.tenantId ?? parsed.data.tenantId,
    loginUrl,
  })
}

const onboardingTag = 'Onboarding'

const onboardingStatusSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['pending', 'processing', 'completed', 'expired']),
  ready: z.boolean(),
  emailSent: z.boolean(),
  tenantId: z.string().uuid(),
  loginUrl: z.string().nullable(),
})

const onboardingStatusErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const onboardingStatusDoc: OpenApiMethodDoc = {
  summary: 'Get onboarding preparation status',
  description: 'Resolves whether a tenant workspace finished deferred onboarding preparation and can be opened.',
  tags: [onboardingTag],
  query: onboardingStatusQuerySchema,
  responses: [
    { status: 200, description: 'Onboarding status resolved.', schema: onboardingStatusSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid tenant id.', schema: onboardingStatusErrorSchema },
    { status: 404, description: 'Onboarding request not found.', schema: onboardingStatusErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: onboardingTag,
  summary: 'Onboarding preparation status',
  methods: {
    GET: onboardingStatusDoc,
  },
}

export default GET
