import type { NextResponse } from 'next/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

export type OperationLogEntry = {
  undoToken?: string | null
  id?: string | null
  commandId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  createdAt?: Date | null
}

export type OperationMetadataFallback = {
  resourceKind: string
  resourceId: string | null
}

export function withOperationMetadata(
  response: NextResponse,
  logEntry: OperationLogEntry | null | undefined,
  fallback: OperationMetadataFallback,
): NextResponse {
  if (!logEntry?.undoToken || !logEntry.id || !logEntry.commandId) return response
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
  return response
}
