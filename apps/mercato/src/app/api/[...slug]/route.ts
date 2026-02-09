import { NextResponse, type NextRequest } from 'next/server'
import { findApi, type HttpMethod } from '@open-mercato/shared/modules/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { modules } from '@/.mercato/generated/modules.generated'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { bootstrap } from '@/bootstrap'

// Ensure all package registrations are initialized for API routes
bootstrap()
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { enforceTenantSelection, normalizeTenantId } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { runWithCacheTenant } from '@open-mercato/cache'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'

type MethodMetadata = {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
  rateLimit?: RateLimitConfig
}

type HandlerContext = {
  params: Record<string, string | string[]>
  auth: AuthContext
}

function extractMethodMetadata(metadata: unknown, method: HttpMethod): MethodMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const entry = (metadata as Partial<Record<HttpMethod, unknown>>)[method]
  if (!entry || typeof entry !== 'object') return null
  const source = entry as Record<string, unknown>
  const normalized: MethodMetadata = {}
  if (typeof source.requireAuth === 'boolean') normalized.requireAuth = source.requireAuth
  if (Array.isArray(source.requireRoles)) {
    normalized.requireRoles = source.requireRoles.filter((role): role is string => typeof role === 'string' && role.length > 0)
  }
  if (Array.isArray(source.requireFeatures)) {
    normalized.requireFeatures = source.requireFeatures.filter((feature): feature is string => typeof feature === 'string' && feature.length > 0)
  }
  if (source.rateLimit && typeof source.rateLimit === 'object') {
    const rl = source.rateLimit as Record<string, unknown>
    if (typeof rl.points === 'number' && typeof rl.duration === 'number') {
      normalized.rateLimit = {
        points: rl.points,
        duration: rl.duration,
        blockDuration: typeof rl.blockDuration === 'number' ? rl.blockDuration : undefined,
        keyPrefix: typeof rl.keyPrefix === 'string' ? rl.keyPrefix : undefined,
      }
    }
  }
  return normalized
}

async function checkAuthorization(
  methodMetadata: MethodMetadata | null,
  auth: AuthContext,
  req: NextRequest
): Promise<NextResponse | null> {
  const { t } = await resolveTranslations()
  if (methodMetadata?.requireAuth && !auth) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const requiredRoles = methodMetadata?.requireRoles ?? []
  const requiredFeatures = methodMetadata?.requireFeatures ?? []

  if (
    requiredRoles.length &&
    (!auth || !Array.isArray(auth.roles) || !requiredRoles.some((role) => auth.roles!.includes(role)))
  ) {
    return NextResponse.json({ error: t('api.errors.forbidden', 'Forbidden'), requiredRoles }, { status: 403 })
  }

  let container: Awaited<ReturnType<typeof createRequestContainer>> | null = null
  const ensureContainer = async () => {
    if (!container) container = await createRequestContainer()
    return container
  }

  if (auth && methodMetadata?.requireAuth !== false) {
    const rawTenantCandidate = await extractTenantCandidate(req)
    if (rawTenantCandidate !== undefined) {
      const tenantCandidate = sanitizeTenantCandidate(rawTenantCandidate)
      if (tenantCandidate !== undefined) {
        const normalizedCandidate = normalizeTenantId(tenantCandidate) ?? null
        const actorTenant = normalizeTenantId(auth.tenantId ?? null) ?? null
        const tenantDiffers = normalizedCandidate !== actorTenant
        if (tenantDiffers) {
          try {
            const guardContainer = await ensureContainer()
            await enforceTenantSelection({ auth, container: guardContainer }, tenantCandidate)
          } catch (error) {
            if (error instanceof CrudHttpError) {
              return NextResponse.json(error.body ?? { error: t('api.errors.forbidden', 'Forbidden') }, { status: error.status })
            }
            throw error
          }
        }
      }
    }
  }

  if (requiredFeatures.length) {
    if (!auth) {
      return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const featureContainer = await ensureContainer()
    const rbac = featureContainer.resolve<RbacService>('rbacService')
    const featureContext = await resolveFeatureCheckContext({ container: featureContainer, auth, request: req })
    const { organizationId } = featureContext
    const ok = await rbac.userHasAllFeatures(auth.sub, requiredFeatures, {
      tenantId: featureContext.scope.tenantId ?? auth.tenantId ?? null,
      organizationId,
    })
    if (!ok) {
      try {
        const acl = await rbac.loadAcl(auth.sub, { tenantId: featureContext.scope.tenantId ?? auth.tenantId ?? null, organizationId })
        console.warn('[api] Forbidden - missing required features', {
          path: req.nextUrl.pathname,
          method: req.method,
          userId: auth.sub,
          tenantId: featureContext.scope.tenantId ?? auth.tenantId ?? null,
          selectedOrganizationId: featureContext.scope.selectedId,
          organizationId,
          requiredFeatures,
          grantedFeatures: acl.features,
          isSuperAdmin: acl.isSuperAdmin,
          allowedOrganizations: acl.organizations,
        })
      } catch (err) {
        try {
          console.warn('[api] Forbidden - could not resolve ACL for logging', {
            path: req.nextUrl.pathname,
            method: req.method,
            userId: auth.sub,
            tenantId: featureContext.scope.tenantId ?? auth.tenantId ?? null,
            organizationId,
            requiredFeatures,
            error: err instanceof Error ? err.message : err,
          })
        } catch {
          // best-effort logging; ignore secondary failures
        }
      }
      return NextResponse.json({ error: t('api.errors.forbidden', 'Forbidden'), requiredFeatures }, { status: 403 })
    }
  }

  return null
}

function sanitizeTenantCandidate(candidate: unknown): unknown {
  if (typeof candidate === 'string') {
    const lowered = candidate.trim().toLowerCase()
    if (lowered === 'null') return null
    if (lowered === 'undefined') return undefined
    return candidate.trim()
  }
  return candidate
}

async function extractTenantCandidate(req: NextRequest): Promise<unknown> {
  const tenantParams = req.nextUrl?.searchParams?.getAll?.('tenantId') ?? []
  if (tenantParams.length > 0) {
    return tenantParams[tenantParams.length - 1]
  }

  const method = (req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return undefined
  }

  const rawContentType = req.headers.get('content-type')
  if (!rawContentType) return undefined
  const contentType = rawContentType.split(';')[0].trim().toLowerCase()

  try {
    if (contentType === 'application/json') {
      const payload = await req.clone().json()
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'tenantId' in payload) {
        return (payload as Record<string, unknown>).tenantId
      }
    } else if (contentType === 'application/x-www-form-urlencoded' || contentType === 'multipart/form-data') {
      const form = await req.clone().formData()
      if (form.has('tenantId')) {
        const value = form.get('tenantId')
        if (value instanceof File) return value.name
        return value
      }
    }
  } catch {
    // Ignore parsing failures; downstream handlers can deal with malformed payloads.
  }

  return undefined
}

async function handleRequest(
  method: HttpMethod,
  req: NextRequest,
  paramsPromise: Promise<{ slug: string[] }>
): Promise<Response> {
  const { t } = await resolveTranslations()
  const params = await paramsPromise
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const api = findApi(modules, method, pathname)
  if (!api) return NextResponse.json({ error: t('api.errors.notFound', 'Not Found') }, { status: 404 })
  const auth = await getAuthFromRequest(req)

  const methodMetadata = extractMethodMetadata(api.metadata, method)
  const authError = await checkAuthorization(methodMetadata, auth, req)
  if (authError) return authError

  if (methodMetadata?.rateLimit) {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      const clientIp = getClientIp(req)
      const rateLimitError = await checkRateLimit(
        rateLimiterService,
        methodMetadata.rateLimit,
        clientIp,
        t(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK),
      )
      if (rateLimitError) return rateLimitError
    }
  }

  const handlerContext: HandlerContext = { params: api.params, auth }
  return await runWithCacheTenant(auth?.tenantId ?? null, () => api.handler(req, handlerContext))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return handleRequest('GET', req, params)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return handleRequest('POST', req, params)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return handleRequest('PUT', req, params)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return handleRequest('PATCH', req, params)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return handleRequest('DELETE', req, params)
}
