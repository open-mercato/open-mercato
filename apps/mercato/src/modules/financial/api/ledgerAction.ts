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

const logger = createLogger('financial')

export type ActionContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export async function resolveActionContext(req: Request): Promise<ActionContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('errors.organization_required', 'Organization context is required'),
    })
  }
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

type LedgerActionOptions<TInput extends object, TResult> = {
  req: Request
  schema: z.ZodType<TInput>
  commandId: string
  resourceKind: string
  resolveResourceId: (input: TInput) => string
  fallbackError: string
}

/**
 * The shared shape of every financial state transition: one scoped command, the
 * route mutation guards (which carry the optimistic-lock header), the standard
 * shared error contract, and the command-bus round trip. Each route supplies only
 * its metadata, schema and fallback message.
 */
export async function runLedgerAction<TInput extends object, TResult>(
  options: LedgerActionOptions<TInput, TResult>,
): Promise<Response> {
  try {
    const context = await resolveActionContext(options.req)
    const raw = await readJsonSafe(options.req, {})
    const scoped = withScopedPayload(
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {},
      context.ctx,
      context.translate,
    )
    const input = options.schema.parse(scoped)
    const userId = context.ctx.auth?.sub
    if (!userId) throw new CrudHttpError(401, { error: context.translate('errors.unauthorized', 'Unauthorized') })
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req: options.req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: options.resourceKind,
        resourceId: options.resolveResourceId(input),
        operation: 'update',
        mutationPayload: input as Record<string, unknown>,
      },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload
      ? options.schema.parse(guarded.modifiedPayload)
      : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<TInput, TResult>(options.commandId, {
      input: commandInput,
      ctx: context.ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    }
    logger.error('financial.ledger_action.failed', { err, commandId: options.commandId })
    return NextResponse.json({ error: translate('financial.errors.action_failed', options.fallbackError) }, { status: 400 })
  }
}
