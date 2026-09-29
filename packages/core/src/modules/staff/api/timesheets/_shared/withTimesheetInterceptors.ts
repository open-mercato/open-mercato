/**
 * API interceptors for the hand-rolled `/api/staff/timesheets/*` routes.
 *
 * The eight `makeCrudRoute` time-tracking resources run `runApiInterceptorsBefore`
 * and `runApiInterceptorsAfter` through the CRUD factory. The ~23 routes written by
 * hand beside them ran neither, so a third party could rewrite the body of a create
 * on `/time-entries` but not on `/time-entries/bulk`, and could not shape the
 * response of a single aggregate. This wraps the two shared runners in the one shape
 * those routes need: one call before the work, one call around the response.
 *
 * `routePath` is derived from the request URL exactly as the factory derives it
 * (`normalizeInterceptorRoutePath`) — the pathname with the leading `/api/` removed,
 * so an interceptor targets `staff/timesheets/time-entries/bulk`. A route with a
 * dynamic segment carries the CONCRETE id in that path
 * (`staff/timesheets/time-entries/<uuid>/duplicate`), so an interceptor for one of
 * those must use the registry's prefix wildcard — `staff/timesheets/time-entries/*`
 * — rather than a literal with a placeholder in it.
 *
 * Scope: the interceptor context carries `tenantId` and `organizationId` and this
 * helper fails closed with a 400 when either is missing, so no interceptor ever runs
 * — and no route body is ever handed to one — outside a resolved tenant scope.
 */

import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  ApiInterceptorMethod,
  InterceptorRequest,
} from '@open-mercato/shared/lib/crud/api-interceptor'
import { getApiInterceptorsForRoute } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import { runCustomRouteAfterInterceptors } from '@open-mercato/shared/lib/crud/custom-route-interceptor'
import { parseExtensionHeaders } from '@open-mercato/shared/lib/umes/extension-headers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

export type TimesheetInterceptorScope = {
  container: AwilixContainer
  userId: string | null | undefined
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  /**
   * The caller's granted features, when the route already resolved them — through
   * `resolveFeatureAccess`, which always yields an array. Deliberately not
   * nullable: a grant list that can be `null` cannot say whether an empty answer
   * means "no grants" or "could not ask", and passing that ambiguity on is what
   * this helper's own fallback exists to avoid.
   *
   * Omitted, the helper asks `rbacService.getGrantedFeatures` once — the same
   * source the CRUD factory uses — so a feature-gated interceptor is evaluated
   * against a real grant set rather than an empty one, and an unreadable set gates
   * every feature-scoped interceptor off.
   */
  userFeatures?: readonly string[]
  /**
   * Opt-in for the tenant-global routes (`/settings`, `/settings/reapply-rounding`),
   * whose records have no organization at all. Without it a request that resolved no
   * organization is refused rather than interceptor-scoped to an empty organization —
   * the same fail-closed default every org-scoped route here keeps. With it, the
   * context carries the empty organization id the CRUD factory also passes for a
   * tenant-global caller.
   */
  tenantGlobal?: boolean
}

export type TimesheetInterceptorSession = {
  /** The request body after the before-pass, or `{}` for a route that sends none. */
  body: Record<string, unknown>
  /** The query after the before-pass. */
  query: Record<string, unknown>
  /** `query` as `URLSearchParams`, for routes that read their input that way. */
  searchParams: URLSearchParams
  /**
   * Runs the after-pass over a successful JSON response and returns it. An
   * interceptor that fails or times out replaces the response with its own error.
   */
  respond(statusCode: number, body: Record<string, unknown>): Promise<NextResponse>
  /**
   * Runs the after-pass over a descriptor for a non-JSON response (a file export).
   * The interceptors cannot rewrite the bytes, so the descriptor is what they shape;
   * the caller applies whatever came back. A failed interceptor yields a JSON error
   * response instead of the file.
   */
  respondWithDescriptor(
    descriptor: Record<string, unknown>,
  ): Promise<{ ok: true; descriptor: Record<string, unknown> } | { ok: false; response: NextResponse }>
}

export type TimesheetInterceptorRun =
  | { ok: true; session: TimesheetInterceptorSession }
  | { ok: false; response: NextResponse }

/**
 * Duplicates and repeated keys collapse to arrays so a rewritten query round-trips
 * `?tagIds=a&tagIds=b` unchanged.
 */
export function readSearchParamsRecord(url: string): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  let params: URLSearchParams
  try {
    params = new URL(url).searchParams
  } catch {
    return record
  }
  params.forEach((value, key) => {
    const existing = record[key]
    if (existing === undefined) {
      record[key] = value
      return
    }
    if (Array.isArray(existing)) {
      existing.push(value)
      return
    }
    record[key] = [existing, value]
  })
  return record
}

function toSearchParams(query: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined) continue
        params.append(key, String(item))
      }
      continue
    }
    params.append(key, String(value))
  }
  return params
}

function normalizeRoutePath(url: string): string {
  try {
    const pathname = new URL(url).pathname
    if (pathname.startsWith('/api/')) return pathname.slice(5)
    if (pathname === '/api') return ''
    return pathname.replace(/^\/+/, '')
  } catch {
    return ''
  }
}

function toHeaderRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  headers.forEach((value, key) => {
    output[key] = value
  })
  return output
}

async function resolveUserFeatures(scope: TimesheetInterceptorScope): Promise<string[]> {
  if (scope.userFeatures) return [...scope.userFeatures]
  if (!scope.userId) return []
  try {
    const rbac = scope.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return []
    return await rbac.getGrantedFeatures(scope.userId, {
      tenantId: scope.tenantId ?? null,
      organizationId: scope.organizationId ?? null,
    })
  } catch {
    // An unreadable grant set gates every feature-scoped interceptor off rather
    // than running it unauthorized.
    return []
  }
}

export async function runTimesheetInterceptors(args: {
  request: Request
  method: ApiInterceptorMethod
  scope: TimesheetInterceptorScope
  /** `readJsonSafe` returns `null` for an unparseable body; that reaches here as `{}`. */
  body?: Record<string, unknown> | null
  query?: Record<string, unknown>
}): Promise<TimesheetInterceptorRun> {
  const { request, method, scope } = args
  const tenantId = scope.tenantId || null
  const resolvedOrganizationId = scope.organizationId || null
  const organizationId = resolvedOrganizationId ?? (scope.tenantGlobal ? '' : null)
  if (!tenantId || organizationId === null) {
    const { translate } = await resolveTranslations()
    return {
      ok: false,
      response: NextResponse.json(
        { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') },
        { status: 400 },
      ),
    }
  }

  const routePath = normalizeRoutePath(request.url)
  const headers = toHeaderRecord(request.headers)
  const requestPayload: InterceptorRequest = {
    method,
    url: request.url,
    body: args.body ?? {},
    query: args.query ?? {},
    headers,
  }

  // No interceptor targets this route and method, so neither pass can observe or
  // change anything. Skipping here keeps the request off the RBAC grant read and the
  // `em` resolve that assembling an interceptor context would otherwise cost on every
  // call to every one of these routes.
  if (getApiInterceptorsForRoute(routePath, method).length === 0) {
    const query = requestPayload.query ?? {}
    return {
      ok: true,
      session: {
        body: requestPayload.body ?? {},
        query,
        searchParams: toSearchParams(query),
        async respond(statusCode, body) {
          return NextResponse.json(body, { status: statusCode })
        },
        async respondWithDescriptor(descriptor) {
          return { ok: true, descriptor }
        },
      },
    }
  }

  const context = {
    userId: scope.userId ?? '',
    organizationId,
    tenantId,
    em: scope.container.resolve('em') as EntityManager,
    container: scope.container,
    userFeatures: await resolveUserFeatures(scope),
    extensionHeaders: parseExtensionHeaders(headers),
  }

  const before = await runApiInterceptorsBefore({
    routePath,
    method,
    request: requestPayload,
    context,
  })
  if (!before.ok) {
    return { ok: false, response: NextResponse.json(before.body, { status: before.statusCode }) }
  }

  const interceptedRequest = before.request
  const query = interceptedRequest.query ?? {}

  const runAfter = async (body: Record<string, unknown>, statusCode: number) =>
    runCustomRouteAfterInterceptors({
      routePath,
      method,
      request: interceptedRequest,
      response: { statusCode, body, headers: {} },
      context,
      metadataByInterceptor: before.metadataByInterceptor,
    })

  return {
    ok: true,
    session: {
      body: interceptedRequest.body ?? {},
      query,
      searchParams: toSearchParams(query),
      async respond(statusCode, body) {
        const after = await runAfter(body, statusCode)
        return NextResponse.json(after.body, {
          status: after.statusCode,
          ...(Object.keys(after.headers).length ? { headers: after.headers } : {}),
        })
      },
      async respondWithDescriptor(descriptor) {
        const after = await runAfter(descriptor, 200)
        if (!after.ok) {
          return {
            ok: false,
            response: NextResponse.json(after.body, { status: after.statusCode }),
          }
        }
        return { ok: true, descriptor: after.body }
      },
    },
  }
}
