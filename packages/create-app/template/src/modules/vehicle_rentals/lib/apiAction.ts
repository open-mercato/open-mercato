import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { createLogger } from '@open-mercato/shared/lib/logger'

/**
 * Shared runner for the vehicle-rental action routes (handover, return,
 * cancel). One path through the mutation guards, the command bus and the error
 * surface, so every action route behaves identically.
 */

const logger = createLogger('vehicle_rentals')

type ActionContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export async function resolveRentalActionContext(req: Request): Promise<ActionContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
  return {
    ctx: {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

export type RentalActionConfig<TResult> = {
  parse: (raw: Record<string, unknown>) => Record<string, unknown>
  resourceKind: string
  resourceId: (input: Record<string, unknown>) => string
  commandId: string
  errorMessageKey: string
  errorFallback: string
  toResponse: (result: TResult, input: Record<string, unknown>) => Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function executeRentalAction<TResult>(
  req: Request,
  config: RentalActionConfig<TResult>,
): Promise<Response> {
  try {
    const context = await resolveRentalActionContext(req)
    const raw = await readJsonSafe(req, {})
    const scoped = withScopedPayload(isRecord(raw) ? raw : {}, context.ctx, context.translate)
    const input = config.parse(scoped)
    const userId = context.ctx.auth?.sub
    if (!userId) throw new CrudHttpError(401, { error: context.translate('errors.unauthorized', 'Unauthorized') })
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: config.resourceKind,
        resourceId: config.resourceId(input),
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload ? config.parse(guarded.modifiedPayload) : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, TResult>(config.commandId, {
      input: commandInput,
      ctx: context.ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, ...config.toResponse(result, commandInput) })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('errors.invalid_input', 'Invalid input'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('vehicle_rentals.action.failed', { err, commandId: config.commandId })
    return NextResponse.json(
      { error: translate(`vehicle_rentals.errors.${config.errorMessageKey}`, config.errorFallback) },
      { status: 400 },
    )
  }
}
