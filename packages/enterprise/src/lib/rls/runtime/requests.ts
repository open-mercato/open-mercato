import { cache } from 'react'
import { headers } from 'next/headers'
import { after } from 'next/server'
import {
  registerDatabaseExecutionContextResolver,
  type DatabaseContextResolution,
  type DatabaseExecutionContext,
} from '@open-mercato/shared/lib/db/runtime'
import { getDatabaseRequest } from '@open-mercato/shared/lib/db/request'
import { findRouteManifestMatch, getBackendRouteManifests, getFrontendRouteManifests } from '@open-mercato/shared/modules/registry'
import { runWithTenantBoundary } from './scope'

type RequestAudience = 'staff' | 'customer' | 'public'
const requestRenderersKey = Symbol.for('@open-mercato/enterprise.tenantBoundaryRequestRenderers.v1')
type RequestRenderers = { identifiers: WeakMap<object, string>; nextIdentifier: number }

export function tenantRequestAudience(pathname: string): RequestAudience {
  if (pathname.startsWith('/api/')) {
    return /^\/api\/(?:customer_accounts|staff|warranty_claims)\/portal(?:\/|$)/.test(pathname)
      || /^\/api\/ecommerce\/storefront(?:\/|$)/.test(pathname) ? 'customer' : 'public'
  }
  const page = findRouteManifestMatch(getFrontendRouteManifests(), pathname)?.route
    ?? findRouteManifestMatch(getBackendRouteManifests(), pathname)?.route
  if (page?.requireCustomerAuth || /^\/[^/]+\/portal(?:\/|$)/.test(pathname)) return 'customer'
  if (page?.requireAuth === false) return 'public'
  return page?.requireAuth || pathname === '/backend' || pathname.startsWith('/backend/') ? 'staff' : 'public'
}

async function verifyPortalBinding(
  pathname: string,
  hostname: string | null,
  auth: Readonly<{ tenantId: string; orgId: string }>,
): Promise<boolean> {
  const [{ createRequestContainer }, { Organization }, { DomainMapping }, { findOneWithDecryption }, { platformDomains }, { tryNormalizeHostname }] = await Promise.all([
    import('@open-mercato/shared/lib/di/container'),
    import('@open-mercato/core/modules/directory/data/entities'),
    import('@open-mercato/core/modules/customer_accounts/data/entities'),
    import('@open-mercato/shared/lib/encryption/find'),
    import('@open-mercato/core/modules/customer_accounts/lib/platformDomains'),
    import('@open-mercato/core/modules/customer_accounts/lib/hostname'),
  ])
  return runWithTenantBoundary({ kind: 'identity', tenantId: auth.tenantId, source: 'identity', operation: 'portal-binding' }, async () => {
    const container = await createRequestContainer()
    const em = container.resolve<import('@mikro-orm/postgresql').EntityManager>('em')
    const slug = pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)?.[1]
    const organization = await findOneWithDecryption(em, Organization, {
      id: auth.orgId, tenant: auth.tenantId, isActive: true, deletedAt: null, ...(slug ? { slug } : {}),
    })
    if (!organization) return false
    if (!hostname) return true
    const platformHost = hostname.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
    if (platformDomains().includes(platformHost)) return true
    const normalized = tryNormalizeHostname(hostname)
    if (!normalized) return false
    const mapping = await findOneWithDecryption(em, DomainMapping, {
      hostname: normalized, status: 'active', tenantId: auth.tenantId, organizationId: auth.orgId,
    })
    return mapping !== null
  })
}

async function canonicalRequestContext(request: Request | undefined): Promise<DatabaseExecutionContext> {
  const headerStore = request?.headers ?? await headers()
  const pathname = request ? new URL(request.url).pathname : headerStore.get('x-next-url')?.split('?')[0]
  if (!pathname?.startsWith('/') || (!request && pathname.startsWith('/api/'))) {
    throw new Error('[internal] Tenant boundary requires a server-resolved page pathname')
  }
  const audience = tenantRequestAudience(pathname)
  if (audience === 'staff') {
    const { resolveAuthFromCookiesDetailed } = await import('@open-mercato/shared/lib/auth/server')
    const resolved = await resolveAuthFromCookiesDetailed()
    if (resolved.status === 'error') throw new Error('[internal] Tenant boundary staff identity is unavailable')
    if (resolved.auth?.tenantId) return { kind: 'tenant', source: 'page', tenantId: resolved.auth.tenantId }
  }
  if (audience === 'customer') {
    const resolved = request
      ? await (await import('@open-mercato/core/modules/customer_accounts/lib/customerAuth')).resolveCustomerAuthFromRequestDetailed(request)
      : await (await import('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer')).resolveCustomerAuthFromCookiesDetailed()
    if (resolved.status === 'error') throw new Error('[internal] Tenant boundary customer identity is unavailable')
    if (resolved.auth && await verifyPortalBinding(pathname, headerStore.get('host'), resolved.auth)) {
      return { kind: 'tenant', source: 'portal', tenantId: resolved.auth.tenantId }
    }
  }
  return { kind: 'identity', source: 'identity', tenantId: null, operation: 'unauthenticated-request' }
}

export function createTenantRequestResolver(): () => Promise<DatabaseContextResolution> {
  const requests = new WeakMap<Request, Promise<DatabaseContextResolution>>()
  const pageMarker = cache(() => Object.freeze({}))

  async function resolveRequest(request?: Request): Promise<DatabaseContextResolution> {
    let active = true
    const revoke = () => { active = false }
    try {
      after(() => {
        revoke()
        request?.signal.removeEventListener('abort', revoke)
      })
      request?.signal.addEventListener('abort', revoke, { once: true })
      if (request?.signal.aborted) revoke()
      const context = Object.freeze(await canonicalRequestContext(request))
      if (!active) throw new Error('[internal] Tenant boundary request completed during identity resolution')
      return Object.freeze({
        status: 'resolved', context,
        invocation: Object.freeze({ token: Symbol('tenant-boundary-request'), isActive: () => active }),
      })
    } catch {
      revoke()
      request?.signal.removeEventListener('abort', revoke)
      return { status: 'unavailable', error: new Error('[internal] Tenant boundary could not establish a live canonical request context') }
    }
  }

  const resolvePage = cache(() => resolveRequest())
  return async () => {
    const request = getDatabaseRequest()
    if (request) {
      let resolution = requests.get(request)
      if (!resolution) {
        resolution = resolveRequest(request)
        requests.set(request, resolution)
      }
      return resolution
    }
    if (pageMarker() !== pageMarker()) return { status: 'absent' }
    return resolvePage()
  }
}

export function registerTenantBoundaryRequestResolver(): void {
  const globals = globalThis as typeof globalThis & { [requestRenderersKey]?: RequestRenderers }
  const renderers = globals[requestRenderersKey] ??= { identifiers: new WeakMap(), nextIdentifier: 0 }
  let identifier = renderers.identifiers.get(cache)
  if (!identifier) {
    identifier = `enterprise.tenant-boundaries.requests.v1.${renderers.nextIdentifier++}`
    renderers.identifiers.set(cache, identifier)
  }
  registerDatabaseExecutionContextResolver(identifier, createTenantRequestResolver())
}
