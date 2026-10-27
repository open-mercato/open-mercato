import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { permittedBuildingIds, type PermittedBuildings } from '../lib/buildingAccess'

const logger = createLogger('property_management')

export type TranslateFn = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type StaffRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  tenantId: string
  organizationId: string
  userId: string
  translate: TranslateFn
  permitted: PermittedBuildings
}

export async function resolveStaffContext(req: Request): Promise<StaffRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('property_management.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('property_management.errors.organizationRequired', 'Organization context is required') })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  const permitted = await permittedBuildingIds({ container, auth, tenantId: auth.tenantId, organizationId })
  return {
    ctx,
    em: (container.resolve('em') as EntityManager).fork(),
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    translate,
    permitted,
  }
}

export async function runStaffGuard(
  req: Request,
  context: StaffRouteContext,
  input: { resourceKind: string; resourceId?: string | null; operation: 'create' | 'update' | 'delete' | 'custom'; payload: Record<string, unknown> },
): Promise<RouteMutationGuardResult> {
  return runRouteMutationGuards({
    container: context.ctx.container,
    req,
    auth: { userId: context.userId, tenantId: context.tenantId, organizationId: context.organizationId },
    input: {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId ?? null,
      operation: input.operation,
      mutationPayload: input.payload,
    },
  })
}

export async function readRouteParam(params: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> | undefined, key: string): Promise<string | null> {
  if (!params) return null
  const resolved = await params
  const value = resolved?.[key]
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return null
  const parsed = z.string().uuid().safeParse(raw.trim())
  return parsed.success ? parsed.data : null
}

export async function handleRouteError(err: unknown, code: string): Promise<Response> {
  const { translate } = await resolveTranslations()
  if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
  const interceptorRejection = getCommandInterceptorHttpRejection(err)
  if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: translate('property_management.errors.invalidInput', 'Invalid input'), issues: err.issues },
      { status: 400 },
    )
  }
  logger.error(`${code} failed`, { err })
  getTelemetryRuntime()?.reportError(err, { module: 'property_management', code })
  return NextResponse.json({ error: translate('property_management.errors.unexpected', 'Something went wrong. Please try again.') }, { status: 500 })
}
