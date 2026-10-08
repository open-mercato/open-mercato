import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { detectLocale } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ExplainService } from '../services/explainService'
import { resolveExplainViewer, type ExplainViewer, type ExplainViewerRescope } from './viewer'

const logger = createLogger('insights').child({ component: 'explain-routes' })

export type PreparedExplainRequest = {
  viewer: ExplainViewer
  service: ExplainService
  rescope: ExplainViewerRescope
}

type RequestCookieReader = { get: (name: string) => { value: string } | undefined }

type ExplainScopeRequestView = {
  headers: Headers
  cookies?: RequestCookieReader
}

export function explainJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status })
}

function readRequestCookies(req: Request): RequestCookieReader | undefined {
  const cookies = (req as Request & { cookies?: unknown }).cookies
  if (!cookies || typeof cookies !== 'object') return undefined
  const get = (cookies as { get?: unknown }).get
  return typeof get === 'function' ? (cookies as RequestCookieReader) : undefined
}

/**
 * A fresh view of the request (same headers and cookies, so the same selected
 * organization) for organization-scope resolution. The route guard has already bound a
 * scope computed for the route's own features to the original request object; resolving
 * against a fresh view lets explain narrow the scope by the features of the resource it
 * actually reads.
 */
function scopeRequestView(req: Request): ExplainScopeRequestView {
  const cookies = readRequestCookies(req)
  return cookies ? { headers: req.headers, cookies } : { headers: req.headers }
}

export async function prepareExplainRequest(
  req: Request,
  requiredFeatures: readonly string[],
): Promise<PreparedExplainRequest | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth) return explainJson({ error: 'unauthorized' }, 401)
  const container = await createRequestContainer()
  const locale = await detectLocale()
  const rescope: ExplainViewerRescope = (features) => resolveExplainViewer({
    container,
    auth,
    request: scopeRequestView(req),
    requiredFeatures: features,
    locale,
  })
  const viewer = await rescope(requiredFeatures)
  if (!viewer) return explainJson({ error: 'tenant_required' }, 403)
  const service = container.resolve('explainService') as ExplainService
  return { viewer, service, rescope }
}

export function explainInternalError(error: unknown, route: string): NextResponse {
  logger.error('[internal] Explain request failed', { route, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.explain_failed', attributes: { route } })
  return explainJson({ error: 'internal_error' }, 500)
}
