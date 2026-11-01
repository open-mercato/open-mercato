import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { checkRateLimit, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_ERROR_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { SupportPortalScope } from './portalTickets'

const logger = createLogger('staff').child({ component: 'lib/support/portalRoute' })

export const SUPPORT_TICKET_RESOURCE_KIND = 'staff.support_ticket'

const RATE_LIMITS = {
  create: readEndpointRateLimitConfig('STAFF_SUPPORT_TICKET_CREATE', {
    points: 10,
    duration: 3600,
    keyPrefix: 'staff_support_ticket_create',
  }),
  message: readEndpointRateLimitConfig('STAFF_SUPPORT_TICKET_MESSAGE', {
    points: 60,
    duration: 3600,
    keyPrefix: 'staff_support_ticket_message',
  }),
  upload: readEndpointRateLimitConfig('STAFF_SUPPORT_TICKET_UPLOAD', {
    points: 30,
    duration: 3600,
    keyPrefix: 'staff_support_ticket_upload',
  }),
} as const

export type PortalRateLimitKind = keyof typeof RATE_LIMITS

export function buildPortalCommandContext(scope: SupportPortalScope, req: Request): CommandRuntimeContext {
  const auth: NonNullable<AuthContext> = {
    sub: scope.auth.sub,
    sid: scope.auth.sid,
    tenantId: scope.auth.tenantId,
    orgId: scope.auth.orgId,
    email: scope.auth.email,
    customerEntityId: scope.auth.customerEntityId ?? null,
    personEntityId: scope.auth.personEntityId ?? null,
  }
  return {
    container: scope.container,
    auth,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    request: req,
  }
}

/** Per customer user, so one noisy account cannot exhaust its colleagues' budget. */
export async function checkPortalRateLimit(
  scope: SupportPortalScope,
  kind: PortalRateLimitKind,
): Promise<Response | null> {
  let service: RateLimiterService | null = null
  try {
    service = scope.container.resolve('rateLimiterService') as RateLimiterService
  } catch {
    return null
  }
  if (!service) return null
  const { translate } = await resolveTranslations()
  return checkRateLimit(
    service,
    RATE_LIMITS[kind],
    `${scope.tenantId}:${scope.auth.sub}`,
    translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK),
  )
}

export async function portalErrorResponse(err: unknown, label: string): Promise<Response> {
  if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
  const rejection = getCommandInterceptorHttpRejection(err)
  if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
  if (err instanceof z.ZodError) {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { ok: false, error: translate('staff.errors.invalid_request', 'Invalid request'), details: err.issues },
      { status: 400 },
    )
  }
  logger.error(label, { err })
  getTelemetryRuntime()?.reportError(err, {
    module: 'staff',
    code: 'staff.portal_support_route_failed',
    attributes: { operation: label },
  })
  return NextResponse.json({ ok: false, error: 'staff.errors.internal' }, { status: 500 })
}

export function readPathId(req: Request, pattern: RegExp): string | null {
  try {
    const match = new URL(req.url).pathname.match(pattern)
    const id = match?.[1] ? decodeURIComponent(match[1]) : null
    return id && z.string().uuid().safeParse(id).success ? id : null
  } catch {
    return null
  }
}
