import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import type { RouteMutationGuardPassed } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { isOrganizationInTenant } from '../projection/payloads'
import type { SimulationRunScope } from './store'

const logger = createLogger('insights').child({ component: 'simulation-routes' })

export type SimulationRouteParams = { params?: unknown } | undefined

export type SimulationRouteContext = {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  userId: string
  scope: SimulationRunScope
  translate: TranslateFn
  commandContext: CommandRuntimeContext
}

export function simulationJson(body: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, ...(headers ? { headers } : {}) })
}

/** The error body of every simulation route: translated message and a stable `code`, never exception text. */
export function simulationError(translate: TranslateFn, code: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return simulationJson({ error: translate(`insights.simulation.errors.${code}`), code, ...extra }, status)
}

/** S10: the one 404 for an unknown, foreign, other-organization, expired or non-owned run. */
export function simulationRunNotFound(translate: TranslateFn): NextResponse {
  return simulationError(translate, 'run_not_found', 404)
}

/**
 * The caller and the single verified organization a simulation route acts on (S10): a user
 * principal (API keys have no private runs), the caller's tenant, and the selected organization
 * (else the home organization) verified to belong to that tenant. "All organizations" without a
 * home organization, or an organization of another tenant, answers 400 `organization_scope_required`.
 */
export async function resolveSimulationRouteContext(req: Request): Promise<SimulationRouteContext | NextResponse> {
  const { t: translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth) return simulationError(translate, 'unauthorized', 401)
  if (!auth.tenantId || auth.isApiKey || !isUuid(auth.sub)) return simulationError(translate, 'forbidden', 403)
  const container = (await createRequestContainer()) as AwilixContainer
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  let organizationId: string | null
  try {
    organizationId = resolveSingleOrganizationIdOrDeny(organizationScope, auth)
  } catch (error) {
    if (isCrudHttpError(error)) return simulationError(translate, 'forbidden', 403)
    throw error
  }
  if (!organizationId) return simulationError(translate, 'organization_scope_required', 400)
  const scope: SimulationRunScope = { tenantId: auth.tenantId.toLowerCase(), organizationId: organizationId.toLowerCase() }
  const em = (container.resolve('em') as EntityManager).fork()
  if (!(await isOrganizationInTenant(em, scope))) return simulationError(translate, 'organization_scope_required', 400)
  return {
    container,
    auth,
    userId: auth.sub.toLowerCase(),
    scope,
    translate,
    commandContext: {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
      request: req,
    },
  }
}

/** Reads a dynamic route segment (plain params or a promise). */
export async function readSimulationRouteParam(context: SimulationRouteParams, name: string): Promise<string | null> {
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

export async function runAfterSuccessSafely(guarded: RouteMutationGuardPassed, route: string): Promise<void> {
  try {
    await guarded.runAfterSuccess()
  } catch (error) {
    logger.error('[internal] Simulation mutation guard after-success callback failed', { route, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_guard_after_success_failed', attributes: { route } })
  }
}

/**
 * Maps a failure of a simulation route to a response: command errors (`CrudHttpError`, translated)
 * and interceptor rejections keep their status; anything else is logged, reported and answered
 * with a translated 500 (`internal_error`) that never carries the cause.
 */
export async function simulationRouteFailure(error: unknown, route: string, translate: TranslateFn | null): Promise<NextResponse> {
  if (isCrudHttpError(error)) {
    const { translate: translateWithFallback } = await resolveTranslations()
    return NextResponse.json(translateCrudErrorBody(error.body, translateWithFallback), { status: error.status })
  }
  const rejection = getCommandInterceptorHttpRejection(error)
  if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
  logger.error('[internal] Simulation request failed', { route, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_route_failed', attributes: { route } })
  let message = 'internal_error'
  try {
    const t = translate ?? (await resolveTranslations()).t
    message = t('insights.simulation.errors.internal_error')
  } catch (translationError) {
    logger.warn('[internal] Could not translate the simulation internal error', { route, err: translationError })
  }
  return simulationJson({ error: message, code: 'internal_error' }, 500)
}
