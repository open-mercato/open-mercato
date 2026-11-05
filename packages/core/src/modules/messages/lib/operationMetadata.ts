import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

export type OperationLogEntryLike = {
  id?: string | null
  undoToken?: string | null
  commandId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  createdAt?: Date | string | null
}

type OperationFallback = {
  resourceKind?: string | null
  resourceId?: string | null
}

export function attachOperationMetadataHeader(
  response: Response,
  logEntry: OperationLogEntryLike | null | undefined,
  fallback: OperationFallback = {},
) {
  if (!logEntry?.undoToken || !logEntry.id || !logEntry.commandId) return

  const executedAt = logEntry.createdAt instanceof Date
    ? logEntry.createdAt.toISOString()
    : typeof logEntry.createdAt === 'string' && logEntry.createdAt.trim().length > 0
      ? logEntry.createdAt
      : new Date().toISOString()

  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? fallback.resourceKind ?? null,
      resourceId: logEntry.resourceId ?? fallback.resourceId ?? null,
      executedAt,
    }),
  )
}
