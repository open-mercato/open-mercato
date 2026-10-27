import type { EntityManager } from '@mikro-orm/core'

type VersionedDocumentEntity = {
  updatedAt: Date
}

/**
 * Allocate a strictly newer optimistic-lock token even when multiple writes
 * happen in one millisecond or the application clock moves backwards.
 */
export function nextDocumentVersion(current: Date, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), current.getTime() + 1))
}

/**
 * MikroORM invokes `onUpdate` after command handlers have assigned fields. Do
 * not replace a command's already-monotonic token with a wall-clock value that
 * could be equal or older. When a write did not assign a token, allocate one
 * from the Unit of Work's persisted snapshot.
 */
export function preserveMonotonicDocumentVersionOnUpdate(
  entity: VersionedDocumentEntity,
  em: EntityManager,
): Date {
  const originalValue = em.getUnitOfWork().getOriginalEntityData(entity)?.updatedAt
  const original = originalValue instanceof Date ? originalValue : entity.updatedAt
  if (entity.updatedAt.getTime() > original.getTime()) return entity.updatedAt
  return nextDocumentVersion(original)
}
