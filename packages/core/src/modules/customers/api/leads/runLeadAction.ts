import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { areLeadsEnabled } from '../../commands/settings'
import { withScopedPayload } from '../utils'

const logger = createLogger('customers')

const LEAD_RESOURCE_KIND = 'customers.lead'

type LeadActionOptions<TInput extends { id: string } & Record<string, unknown>> = {
  commandId: string
  schema: z.ZodType<TInput>
  operation?: 'create' | 'update' | 'delete'
  status?: number
}

export type LeadActionContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export async function buildLeadActionContext(
  req: Request,
  options: { requireEnabled?: boolean } = {},
): Promise<LeadActionContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  const tenantId = auth.tenantId ?? null
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(400, {
      error: translate('customers.errors.context_required', 'Organization and tenant context required'),
    })
  }
  if (options.requireEnabled !== false) {
    const em = container.resolve('em') as EntityManager
    const enabled = await areLeadsEnabled(em, { tenantId, organizationId })
    if (!enabled) {
      throw new CrudHttpError(403, {
        error: translate('customers.leads.errors.disabled', 'The lead capability is disabled for this tenant.'),
      })
    }
  }
  return { ctx, tenantId, organizationId, translate }
}

type LeadCommandOptions<TInput extends Record<string, unknown>> = {
  commandId: string
  schema: z.ZodType<TInput>
  resourceKind?: string
  resourceId?: (input: TInput) => string
  operation?: 'create' | 'update' | 'delete'
  status?: number
  requireEnabled?: boolean
}

export async function runLeadCommand<TInput extends Record<string, unknown>>(
  req: Request,
  options: LeadCommandOptions<TInput>,
): Promise<Response> {
  try {
    const { ctx, tenantId, organizationId, translate } = await buildLeadActionContext(req, {
      requireEnabled: options.requireEnabled,
    })
    const body = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(body, ctx, translate)
    const input = options.schema.parse(scoped)
    const operation = options.operation ?? 'update'
    const resourceKind = options.resourceKind ?? LEAD_RESOURCE_KIND
    const resourceId = options.resourceId ? options.resourceId(input) : null

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: ctx.auth!.sub,
      resourceKind,
      resourceId: resourceId ?? organizationId,
      operation,
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute(options.commandId, { input, ctx })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: ctx.auth!.sub,
        resourceKind,
        resourceId: resourceId ?? organizationId,
        operation,
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const payload =
      result && typeof result === 'object'
        ? { ok: true, ...(result as Record<string, unknown>) }
        : { ok: true }
    const response = NextResponse.json(payload, { status: options.status ?? 200 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? resourceKind,
          resourceId: logEntry.resourceId ?? resourceId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        }),
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('customers.leads command failed', { err, commandId: options.commandId })
    return NextResponse.json({ error: 'Lead action failed' }, { status: 400 })
  }
}

export async function runLeadAction<TInput extends { id: string } & Record<string, unknown>>(
  req: Request,
  options: LeadActionOptions<TInput>,
): Promise<Response> {
  return runLeadCommand(req, {
    ...options,
    resourceKind: LEAD_RESOURCE_KIND,
    resourceId: (input) => input.id,
    requireEnabled: true,
  })
}
