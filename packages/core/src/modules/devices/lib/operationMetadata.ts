import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

type OperationLogEntry = {
  id?: string | null
  undoToken?: string | null
  commandId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  createdAt?: Date | null
}

/**
 * Attaches the `x-om-operation` undo header to a response when the command produced an
 * undoable log entry. No-op otherwise.
 */
export function attachOperationMetadataHeader(
  response: Response,
  logEntry: OperationLogEntry | null | undefined,
  fallback: { resourceKind: string; resourceId: string },
): void {
  if (!logEntry?.undoToken || !logEntry.id || !logEntry.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? fallback.resourceKind,
      resourceId: logEntry.resourceId ?? fallback.resourceId,
      executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
    }),
  )
}
