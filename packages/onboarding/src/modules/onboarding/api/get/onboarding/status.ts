import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { assertAllowedAppOrigin, mapSecurityEmailUrlError } from '@open-mercato/shared/lib/url'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { sendWorkspaceReadyEmail } from '@open-mercato/onboarding/modules/onboarding/lib/ready-email'
import {
  resolveProvisioningIds,
  runDeferredProvisioning,
} from '@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning'
import { isPreparationClaimActive } from '@open-mercato/onboarding/modules/onboarding/lib/preparation-claim'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const logger = createLogger('onboarding').child({ component: 'status' })

export const metadata = {
  path: '/onboarding/onboarding/status',
  GET: {
    requireAuth: false,
  },
}

const ONBOARDING_LOGIN_TENANT_COOKIE = 'om_login_tenant'

const onboardingStatusQuerySchema = z.object({
  tenantId: z.string().uuid(),
})

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) continue
    const key = part.slice(0, separatorIndex).trim()
    if (key !== name) continue
    const rawValue = part.slice(separatorIndex + 1).trim()
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') || url.searchParams.get('tenant') || ''
  const parsed = onboardingStatusQuerySchema.safeParse({ tenantId })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid tenant id.' }, { status: 400 })
  }

  const loginTenantCookie = readCookie(req, ONBOARDING_LOGIN_TENANT_COOKIE)
  if (!loginTenantCookie || loginTenantCookie !== parsed.data.tenantId) {
    return NextResponse.json({ ok: false, error: 'Not authorized for this tenant.' }, { status: 403 })
  }

  try {
    assertAllowedAppOrigin(req)
  } catch (error) {
    const mapped = mapSecurityEmailUrlError(error, {
      scope: 'onboarding.status',
      configMessage: 'Onboarding status is not configured.',
    })
    if (mapped) return NextResponse.json({ ok: false, error: mapped.body.error }, { status: mapped.status })
    throw error
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)
  const request = await service.findLatestByTenantId(parsed.data.tenantId)
  if (!request) {
    return NextResponse.json({ ok: false, error: 'Onboarding request not found.' }, { status: 404 })
  }

  const provisioningIds = resolveProvisioningIds(request)
  if (provisioningIds && request.status === 'processing') {
    await service.markCompleted(request, provisioningIds)
  }
  // Schedule deferred provisioning only while no runner holds a fresh claim —
  // otherwise every ~1s poll piles another full seed + reindex chain onto the
  // connection pool. The atomic claim inside runDeferredProvisioning remains
  // the authoritative gate; this check just keeps polls cheap.
  if (
    provisioningIds &&
    request.status === 'completed' &&
    !request.preparationCompletedAt &&
    !isPreparationClaimActive(request.preparationStartedAt)
  ) {
    after(async () => {
      await runDeferredProvisioning({
        requestId: request.id,
        tenantId: provisioningIds.tenantId,
        organizationId: provisioningIds.organizationId,
      })
    })
  }

  const emailSent = Boolean(request.readyEmailSentAt)
  const ready = request.status === 'completed' && Boolean(request.preparationCompletedAt)
  const loginUrl = ready && request.tenantId ? `/login?tenant=${encodeURIComponent(request.tenantId)}` : null

  if (ready && request.tenantId && !request.readyEmailSentAt) {
    const readyTenantId = request.tenantId
    after(async () => {
      await sendWorkspaceReadyEmail({
        requestId: request.id,
        tenantId: readyTenantId,
      }).catch((error) => {
        logger.error('Ready email retry failed', {
          requestId: request.id,
          tenantId: readyTenantId,
          organizationId: request.organizationId,
          err: error,
        })
      })
    })
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
    { status: 400, description: 'Invalid tenant id or request origin.', schema: onboardingStatusErrorSchema },
    { status: 403, description: 'Caller is not authorized for this tenant.', schema: onboardingStatusErrorSchema },
    { status: 404, description: 'Onboarding request not found.', schema: onboardingStatusErrorSchema },
    { status: 500, description: 'Onboarding status is not configured.', schema: onboardingStatusErrorSchema },
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
