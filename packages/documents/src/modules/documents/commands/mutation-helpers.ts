import { z } from 'zod'
import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
export { nextDocumentVersion } from '../lib/versioning'

export const documentsScopedCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export type VersionedEntitySnapshot = {
  id: string
  updatedAt: string
  deletedAt: string | null
}

export function assertVersionedSnapshot(
  entity: { id: string; updatedAt: Date; deletedAt?: Date | null } | null,
  expected: VersionedEntitySnapshot | null | undefined,
  resourceKind: string,
): void {
  if (!entity || !expected) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  assertOptimisticLock({
    resourceKind,
    resourceId: expected.id,
    current: entity.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  const deletedAt = entity.deletedAt?.toISOString() ?? null
  if (deletedAt !== expected.deletedAt) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(
      entity.updatedAt.toISOString(),
      expected.updatedAt,
    ))
  }
}

export function readCommandRedoInput(logEntry: { commandPayload?: unknown }): unknown {
  const payload = logEntry.commandPayload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return (payload as { __redoInput?: unknown }).__redoInput ?? null
}
