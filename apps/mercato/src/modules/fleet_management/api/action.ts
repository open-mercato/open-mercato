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
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('fleet_management')

type FleetActionOptions<TInput extends object> = {
  req: Request
  schema: z.ZodType<TInput>
  commandId: string
  operation: 'create' | 'update' | 'delete'
  resolveResourceId: (input: TInput) => string
  fallbackError: string
  status?: number
}

/**
 * Fleet vehicle writes go through the transport command bus. The mutation guard
 * runs against the transport vehicle kind, so optimistic locking still compares
 * the version the fleet form sent with the register row.
 */
export async function runFleetAction<TInput extends object>(
  options: FleetActionOptions<TInput>,
): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(options.req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: options.req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    }
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: options.req,
    }
    const rawBody = await readJsonSafe(options.req, {})
    const rawRecord = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody as Record<string, unknown>
      : {}
    // The shared `deleteCrud` helper sends `?id=` with no body; accept both forms.
    const idFromQuery = new URL(options.req.url).searchParams.get('id')
    const raw = idFromQuery ? { id: idFromQuery, ...rawRecord } : rawRecord
    const input = options.schema.parse(raw)
    const userId = auth.sub
    if (!userId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const guarded = await runRouteMutationGuards({
      container,
      req: options.req,
      auth: { userId, tenantId: auth.tenantId, organizationId },
      input: {
        resourceKind: 'transport_operations:transport_vehicle',
        resourceId: options.resolveResourceId(input),
        operation: options.operation,
        mutationPayload: input as Record<string, unknown>,
      },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload
      ? options.schema.parse(guarded.modifiedPayload)
      : input
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<TInput, unknown>(options.commandId, {
      input: commandInput,
      ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json(result, { status: options.status ?? 200 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input'), details: err.issues }, { status: 400 })
    }
    logger.error('fleet_management.action.failed', { err, commandId: options.commandId })
    return NextResponse.json({ error: options.fallbackError }, { status: 400 })
  }
}
