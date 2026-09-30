import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'forms.errors.tenant_required', fallback: 'Tenant context is required' },
    organizationRequired: { key: 'forms.errors.organization_required', fallback: 'Organization context is required' },
  },
})

export { withScopedPayload }

/**
 * Build the per-request CommandRuntimeContext used by every forms admin route.
 *
 * Throws `CrudHttpError(401)` when authentication is missing — translated to
 * `forms.errors.unauthorized` so the client surface stays consistent.
 */
export async function buildFormsRouteContext(req: Request): Promise<{
  ctx: CommandRuntimeContext
  organizationId: string | null
  tenantId: string | null
  translate: (key: string, fallback?: string) => string
}> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) {
    throw new CrudHttpError(401, {
      error: translate('forms.errors.unauthorized', 'Unauthorized'),
    })
  }
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
  return { ctx, organizationId, tenantId, translate: translate as (key: string, fallback?: string) => string }
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status })
}

export function handleRouteError(scope: string, error: unknown): NextResponse {
  if (isCrudHttpError(error)) {
    return NextResponse.json(error.body, { status: error.status })
  }
  console.error(`[forms.api.${scope}] failed`, error)
  return NextResponse.json({ error: 'forms.errors.internal' }, { status: 500 })
}

export function attachOperationMetadata(
  response: NextResponse,
  logEntry: {
    id?: string | null
    undoToken?: string | null
    commandId?: string | null
    actionLabel?: string | null
    resourceKind?: string | null
    resourceId?: string | null
    createdAt?: Date | string | null
  } | null | undefined,
  fallbackResourceKind: string,
  fallbackResourceId: string | null,
): NextResponse {
  const id = logEntry?.id
  const undoToken = logEntry?.undoToken
  const commandId = logEntry?.commandId
  if (!undoToken || !id || !commandId) return response
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id,
      undoToken,
      commandId,
      actionLabel: logEntry?.actionLabel ?? null,
      resourceKind: logEntry?.resourceKind ?? fallbackResourceKind,
      resourceId: logEntry?.resourceId ?? fallbackResourceId,
      executedAt:
        logEntry?.createdAt instanceof Date
          ? logEntry.createdAt.toISOString()
          : typeof logEntry?.createdAt === 'string'
            ? logEntry.createdAt
            : new Date().toISOString(),
    }),
  )
  return response
}

/**
 * Wrap a non-CRUD mutation handler with the legacy mutation-guard contract.
 * The wrapper aborts with the guard's status/body if the guard rejects, and
 * runs the after-success hook when the operation completes.
 */
export async function withMutationGuard<TResult>(opts: {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string | null
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete' | 'custom'
  request: Request
  payload?: Record<string, unknown> | null
  run: () => Promise<TResult>
}): Promise<TResult> {
  const userId = opts.ctx.auth?.sub ?? null
  if (!userId) {
    throw new CrudHttpError(401, { error: 'forms.errors.unauthorized' })
  }
  const validation = await validateCrudMutationGuard(opts.ctx.container, {
    tenantId: opts.tenantId,
    organizationId: opts.organizationId,
    userId,
    resourceKind: opts.resourceKind,
    resourceId: opts.resourceId,
    operation: opts.operation,
    requestMethod: opts.request.method,
    requestHeaders: opts.request.headers,
    mutationPayload: opts.payload ?? null,
  })
  if (validation && !validation.ok) {
    throw new CrudHttpError(validation.status ?? 422, validation.body)
  }
  const result = await opts.run()
  if (validation?.ok && validation.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(opts.ctx.container, {
      tenantId: opts.tenantId,
      organizationId: opts.organizationId,
      userId,
      resourceKind: opts.resourceKind,
      resourceId: opts.resourceId,
      operation: opts.operation,
      requestMethod: opts.request.method,
      requestHeaders: opts.request.headers,
      metadata: validation.metadata ?? null,
    })
  }
  return result
}
