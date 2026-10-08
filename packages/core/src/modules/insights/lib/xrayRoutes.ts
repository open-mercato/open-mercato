import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
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

/**
 * Resolves the caller and the single organization an X-Ray route acts on (the selected
 * organization, else the caller's home organization). A caller without a resolved tenant is
 * refused; an explicitly empty organization scope is forbidden; "all organizations" with no
 * home organization asks the caller to select one.
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
  if (!organizationId) return organizationScopeRequiredResponse() as NextResponse
  const scope: ProjectionScope = { tenantId: auth.tenantId, organizationId }
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

export function xrayInternalError(error: unknown, route: string): NextResponse {
  logger.error('[internal] Process X-Ray request failed', { route, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_route_failed', attributes: { route } })
  return xrayJson({ error: 'internal_error' }, 500)
}
