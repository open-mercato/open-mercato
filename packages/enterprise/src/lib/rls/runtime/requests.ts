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

import { resolveDeclaredDatabaseRequestContext } from '@open-mercato/shared/lib/db/declarations'

const requestRenderersKey = Symbol.for('@open-mercato/enterprise.tenantBoundaryRequestRenderers.v1')
type RequestRenderers = { identifiers: WeakMap<object, string>; nextIdentifier: number }

async function canonicalRequestContext(request: Request | undefined): Promise<DatabaseExecutionContext> {
  const headerStore = request?.headers ?? await headers()
  const pathname = request ? new URL(request.url).pathname : headerStore.get('x-next-url')?.split('?')[0]
  if (!pathname?.startsWith('/') || (!request && pathname.startsWith('/api/'))) {
    throw new Error('[internal] Tenant boundary requires a server-resolved page pathname')
  }
  const route = request ? undefined : findRouteManifestMatch(getFrontendRouteManifests(), pathname)?.route
    ?? findRouteManifestMatch(getBackendRouteManifests(), pathname)?.route
  return resolveDeclaredDatabaseRequestContext({
    pathname, headers: headerStore, request,
    requireAuth: route?.requireAuth === true,
    requireCustomerAuth: route?.requireCustomerAuth === true,
  })
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
