import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { compareCodeUnits, getProcessRegistry } from './process/registry'
import { isOrganizationInTenant } from './projection/payloads'
import type { ProjectionScope } from './projection/types'

const logger = createLogger('insights').child({ component: 'xray-routes' })

export type XrayRouteContext = {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  scope: ProjectionScope
  commandContext: CommandRuntimeContext
}

export function xrayJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status })
}

/** The shared 400 "select an organization" answer as a `NextResponse` (routes return early on `instanceof NextResponse`). */
async function scopeRequiredResponse(): Promise<NextResponse> {
  const response = organizationScopeRequiredResponse()
  return xrayJson(await response.json(), response.status)
}

type RbacFeatureChecker = {
  userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
}

/**
 * Resolves the caller and the single organization of the caller's tenant an X-Ray route acts on
 * (the selected organization, else the caller's home organization). A caller without a resolved
 * tenant is refused; an explicitly empty organization scope is forbidden; "all organizations"
 * with no home organization asks the caller to select one, and so does an organization that does
 * not belong to the caller's tenant (e.g. a super administrator who selected another tenant;
 * one scoped lookup), before any write.
 */
export async function resolveXrayRouteContext(req: Request): Promise<XrayRouteContext | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return xrayJson({ error: 'unauthorized' }, 401)
  const container = (await createRequestContainer()) as AwilixContainer
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  let organizationId: string | null
  try {
    organizationId = resolveSingleOrganizationIdOrDeny(organizationScope, auth)
  } catch (error) {
    if (isCrudHttpError(error)) return xrayJson({ error: 'forbidden' }, 403)
    throw error
  }
  if (!organizationId) return scopeRequiredResponse()
  const scope: ProjectionScope = { tenantId: auth.tenantId, organizationId }
  const em = (container.resolve('em') as EntityManager).fork()
  if (!(await isOrganizationInTenant(em, scope))) return scopeRequiredResponse()
  return {
    container,
    auth,
    scope,
    commandContext: {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? [organizationId],
      request: req,
    },
  }
}

/**
 * Processes whose declared `requiredFeatures` the caller holds in the route's organization,
 * checked with the wildcard-aware `rbacService.userHasAllFeatures` (one check per distinct
 * feature list). Fails closed: without the RBAC service or a subject nothing is visible.
 */
export async function resolveVisibleXrayProcessKeys(context: XrayRouteContext): Promise<Set<string>> {
  const visible = new Set<string>()
  const userId = context.auth.sub
  if (!userId) return visible
  let rbac: RbacFeatureChecker | null = null
  try {
    rbac = context.container.resolve('rbacService') as RbacFeatureChecker
  } catch {
    rbac = null
  }
  if (!rbac || typeof rbac.userHasAllFeatures !== 'function') return visible
  const checker = rbac
  const checks = new Map<string, Promise<boolean>>()
  for (const process of getProcessRegistry().processes) {
    const features = Array.from(new Set(process.requiredFeatures.filter((feature) => feature.length > 0))).sort(compareCodeUnits)
    if (features.length === 0) continue
    const key = features.join('\u0000')
    let pending = checks.get(key)
    if (!pending) {
      pending = checker.userHasAllFeatures(userId, features, { tenantId: context.scope.tenantId, organizationId: context.scope.organizationId })
      checks.set(key, pending)
    }
    if (await pending) visible.add(process.processKey)
  }
  return visible
}

/**
 * The logged and reported 500 of every X-Ray route, in the standard error shape
 * (`{ error, code: 'internal_error', hint: null }`, translated message); the cause never reaches
 * the body.
 */
export async function xrayInternalError(error: unknown, route: string, translate?: TranslateFn | null): Promise<NextResponse> {
  logger.error('[internal] Process X-Ray request failed', { route, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_route_failed', attributes: { route } })
  let message = 'internal_error'
  try {
    const t = translate ?? (await resolveTranslations()).t
    message = t('insights.xray.errors.internal_error')
  } catch (translationError) {
    logger.warn('[internal] Could not translate the Process X-Ray internal error', { route, err: translationError })
    getTelemetryRuntime()?.reportError(translationError, { module: 'insights', code: 'insights.xray_route_translation_failed', attributes: { route } })
  }
  return xrayJson({ error: message, code: 'internal_error', hint: null }, 500)
}
