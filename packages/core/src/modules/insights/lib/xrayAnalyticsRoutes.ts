import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { ZodType } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RegisteredProcess } from './process/registry'
import { createXrayAnalyticsFromContainer, isXrayAnalyticsError, type XrayAnalytics } from './analytics/index'
import type { AnalyticsFilters, AnalyticsRequestInput, WindowInput } from './analytics/types'
import { xrayAnalyticsErrorSchema } from '../data/validators'
import { scopeRequestView } from './routeHelpers'
import {
  findRegisteredProcess,
  resolveXrayAnalyticsAccess,
  xrayProcessFeatures,
  type XrayAnalyticsAccess,
} from './xrayAnalyticsAccess'
import { xrayInternalError, xrayJson } from './xrayRoutes'

export type XrayRouteParams = { params?: unknown } | undefined

export type XrayAnalyticsRouteContext = {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  process: RegisteredProcess
  access: XrayAnalyticsAccess
  analytics: XrayAnalytics
  translate: TranslateFn
}

export type XrayWindowQuery = {
  window?: '7d' | '30d' | '90d'
  from?: string
  to?: string
  timeZone?: string
}

export type XrayFilterQuery = {
  causeKinds?: string
  actorRoleIds?: string
  actorTeamIds?: string
  includeSyncRun?: string
}

/** The error body of every X-Ray analytics route: translated message, stable `code`, optional `hint`; never counts. */
export function xrayErrorResponse(translate: TranslateFn, code: string, status: number, hint: string | null = null): NextResponse {
  return xrayJson({ error: translate(`insights.xray.errors.${code}`), code, hint }, status)
}

/** The one 404 body for an unknown process and for a process the caller may not see. */
export function xrayProcessNotFound(translate: TranslateFn): NextResponse {
  return xrayErrorResponse(translate, 'process_not_found', 404)
}

/** Reads a dynamic route segment (the dispatcher passes plain params; Next.js may pass a promise). */
export async function readRouteParam(context: XrayRouteParams, name: string): Promise<string | null> {
  const params = await Promise.resolve(context?.params)
  if (!params || typeof params !== 'object') return null
  const value = (params as Record<string, unknown>)[name]
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** Parses the query string with a route schema (last value wins); `null` when invalid. */
export function parseXrayQuery<TQuery>(req: Request, schema: ZodType<TQuery>): TQuery | null {
  const parsed = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  return parsed.success ? parsed.data : null
}

export function splitCsv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const items = Array.from(new Set(value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)))
  return items.length > 0 ? items : undefined
}

/** The analytics window of a query: a custom `{ from, to }` or a default window (`30d` when absent). */
export function windowOfQuery(query: XrayWindowQuery): WindowInput {
  if (query.from !== undefined && query.to !== undefined) return { from: query.from, to: query.to }
  return { windowKey: query.window ?? '30d' }
}

/** The analytics filters of a query, or `null` when `includeSyncRun` is not a boolean token. */
export function filtersOfQuery(query: XrayFilterQuery): AnalyticsFilters | null {
  const filters: AnalyticsFilters = {}
  const causeKinds = splitCsv(query.causeKinds)
  const actorRoleIds = splitCsv(query.actorRoleIds)
  const actorTeamIds = splitCsv(query.actorTeamIds)
  if (causeKinds) filters.causeKinds = causeKinds
  if (actorRoleIds) filters.actorRoleIds = actorRoleIds
  if (actorTeamIds) filters.actorTeamIds = actorTeamIds
  if (query.includeSyncRun !== undefined) {
    const includeSyncRun = parseBooleanToken(query.includeSyncRun)
    if (includeSyncRun === null) return null
    filters.includeSyncRun = includeSyncRun
  }
  return filters
}

/** The facade input shared by every per-process route: caller scope, process, window, time zone, filters, viewer. */
export function analyticsInputOf(context: XrayAnalyticsRouteContext, query: XrayWindowQuery, filters: AnalyticsFilters = {}): AnalyticsRequestInput {
  return {
    scope: { tenantId: context.access.tenantId, organizationIds: context.access.organizationIds },
    processKey: context.process.processKey,
    window: windowOfQuery(query),
    ...(query.timeZone ? { timeZone: query.timeZone } : {}),
    filters,
    viewer: context.access.viewer,
  }
}

/**
 * Resolves a per-process X-Ray analytics request: the caller (401 without one), the registered
 * process, and access for `insights.xray.view` plus the process's `requiredFeatures` (organization
 * scope resolved for those features, wildcard-aware RBAC). An unknown process and a process the
 * caller may not see answer the same 404 body. A caller without a resolved tenant gets 403.
 */
export async function prepareXrayAnalyticsRoute(req: Request, routeContext: XrayRouteParams): Promise<XrayAnalyticsRouteContext | NextResponse> {
  const { t: translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.sub) return xrayErrorResponse(translate, 'unauthorized', 401)
  const processKey = await readRouteParam(routeContext, 'processKey')
  const process = processKey ? findRegisteredProcess(processKey) : null
  if (!process) return xrayProcessNotFound(translate)
  const container = (await createRequestContainer()) as AwilixContainer
  const access = await resolveXrayAnalyticsAccess({
    container,
    auth,
    request: scopeRequestView(req),
    requiredFeatures: xrayProcessFeatures(process),
  })
  if (!access) return xrayErrorResponse(translate, 'tenant_required', 403)
  if (!access.visible) return xrayProcessNotFound(translate)
  return { container, auth, process, access, analytics: createXrayAnalyticsFromContainer(container), translate }
}

/**
 * Maps a failure of an analytics route: typed analytics errors to their status with a
 * translated message, `code` and `hint` (an unregistered process to the shared 404), anything
 * else to a logged and reported 500.
 */
export function xrayAnalyticsFailure(error: unknown, translate: TranslateFn | null, route: string): NextResponse {
  if (translate && isXrayAnalyticsError(error)) {
    if (error.code === 'process_not_found') return xrayProcessNotFound(translate)
    return xrayErrorResponse(translate, error.code, error.status, error.hint)
  }
  return xrayInternalError(error, route)
}

/** Runs a route body with the shared preparation and failure mapping. */
export async function runXrayAnalyticsRoute(
  req: Request,
  routeContext: XrayRouteParams,
  route: string,
  handle: (context: XrayAnalyticsRouteContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  let translate: TranslateFn | null = null
  try {
    const prepared = await prepareXrayAnalyticsRoute(req, routeContext)
    if (prepared instanceof NextResponse) return prepared
    translate = prepared.translate
    return await handle(prepared)
  } catch (error) {
    return xrayAnalyticsFailure(error, translate, route)
  }
}

/** Viewer-scoped analytics are never stored by shared caches. */
export function xrayAnalyticsJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/**
 * The error responses every per-process analytics route documents; route-specific causes are
 * appended to the description of their status.
 */
export function xrayAnalyticsErrorDocs(more: { forbidden?: string; notFound?: string; unprocessable?: string } = {}): OpenApiResponseDoc[] {
  const describe = (base: string, extra: string | undefined) => (extra ? `${base} ${extra}` : base)
  return [
    { status: 400, description: 'Invalid query, body or window (`invalid_request`, `invalid_window`)', schema: xrayAnalyticsErrorSchema },
    { status: 401, description: 'Authentication required', schema: xrayAnalyticsErrorSchema },
    { status: 403, description: describe('Missing `insights.xray.view` or no resolved tenant (`tenant_required`).', more.forbidden), schema: xrayAnalyticsErrorSchema },
    { status: 404, description: describe('Unknown process, or the caller lacks the process\'s required features (identical body, `process_not_found`).', more.notFound), schema: xrayAnalyticsErrorSchema },
    {
      status: 422,
      description: describe('Window over 180 days (`window_too_large`), statement timeout (`query_timeout`) or event budget exceeded (`result_too_large`), all with hint `run_background_analysis`; an actor filter matching too few cases or actors (`filter_too_narrow`, hint `widen_actor_filter`). No counts are disclosed.', more.unprocessable),
      schema: xrayAnalyticsErrorSchema,
    },
  ]
}
