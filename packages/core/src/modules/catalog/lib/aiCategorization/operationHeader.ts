import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

/**
 * Attaches the same `x-om-operation` undo-token header `makeCrudRoute` sets
 * for CRUD writes, so a hand-rolled command route (accept/reject) is undoable
 * through the same `/api/audit_logs/audit-logs/actions/undo` contract.
 */
export function attachOperationHeader(response: Response, logEntry: unknown): Response {
  if (!response || !(logEntry && typeof logEntry === 'object')) return response
  const entry = logEntry as Record<string, unknown>
  const undoToken = typeof entry.undoToken === 'string' ? entry.undoToken : null
  const id = typeof entry.id === 'string' ? entry.id : null
  const commandId = typeof entry.commandId === 'string' ? entry.commandId : null
  if (!undoToken || !id || !commandId) return response
  const actionLabel = typeof entry.actionLabel === 'string' ? entry.actionLabel : null
  const resourceKind = typeof entry.resourceKind === 'string' ? entry.resourceKind : null
  const resourceId = typeof entry.resourceId === 'string' ? entry.resourceId : null
  const createdAt = entry.createdAt instanceof Date
    ? entry.createdAt.toISOString()
    : (typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString())
  const headerValue = serializeOperationMetadata({
    id,
    undoToken,
    commandId,
    actionLabel,
    resourceKind,
    resourceId,
    executedAt: createdAt,
  })
  try {
    response.headers.set('x-om-operation', headerValue)
  } catch {
    // no-op if headers already sent
  }
  return response
}
