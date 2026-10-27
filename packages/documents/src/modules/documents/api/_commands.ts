import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { DocumentsRouteContext } from './_shared'

type OperationLogLike = {
  id?: string | null
  undoToken?: string | null
  commandId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  createdAt?: Date | string | null
}

export function resolveDocumentsCommandBus(ctx: DocumentsRouteContext): CommandBus {
  return ctx.container.resolve('commandBus') as CommandBus
}

export function buildDocumentsCommandRuntimeContext(
  ctx: DocumentsRouteContext,
): CommandRuntimeContext {
  return {
    container: ctx.container,
    auth: ctx.auth,
    organizationScope: null,
    selectedOrganizationId: ctx.organizationId,
    organizationIds: [ctx.organizationId],
    request: ctx.request,
  }
}

export function attachDocumentsOperationMetadata(
  response: Response,
  logEntry: OperationLogLike | null | undefined,
  defaults: { resourceKind: string; resourceId?: string | null },
): Response {
  if (!logEntry?.id || !logEntry.undoToken || !logEntry.commandId) return response
  const executedAt = logEntry.createdAt instanceof Date
    ? logEntry.createdAt.toISOString()
    : typeof logEntry.createdAt === 'string' && logEntry.createdAt
      ? logEntry.createdAt
      : new Date().toISOString()
  response.headers.set('x-om-operation', serializeOperationMetadata({
    id: logEntry.id,
    undoToken: logEntry.undoToken,
    commandId: logEntry.commandId,
    actionLabel: logEntry.actionLabel ?? null,
    resourceKind: logEntry.resourceKind ?? defaults.resourceKind,
    resourceId: logEntry.resourceId ?? defaults.resourceId ?? null,
    executedAt,
  }))
  return response
}
