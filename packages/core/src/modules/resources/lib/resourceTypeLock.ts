import type { EntityManager } from '@mikro-orm/postgresql'

const RESOURCE_TYPE_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'

export function resourceTypeLockKey(resourceTypeId: string): string {
  return `resources:resource-type:${resourceTypeId.toLowerCase()}`
}

export async function lockResourceType(em: EntityManager, resourceTypeId: string): Promise<void> {
  if (!em.isInTransaction()) {
    throw new Error('[internal] lockResourceType requires an open transaction')
  }
  await em.execute(RESOURCE_TYPE_LOCK_SQL, [resourceTypeLockKey(resourceTypeId)])
}
