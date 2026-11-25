import type { EntityManager } from '@mikro-orm/postgresql'

const REFERENCE_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'

export function entityReferenceLockKey(input: {
  entityId: string
  recordId: string
  tenantId: string
  organizationId: string
}): string {
  return `entity-reference:${input.entityId}:${input.tenantId}:${input.organizationId}:${input.recordId}`
}

export async function lockEntityReferences(
  em: EntityManager,
  inputs: Array<{ entityId: string; recordId: string; tenantId: string; organizationId: string }>,
): Promise<void> {
  const keys = [...new Set(inputs.map(entityReferenceLockKey))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const key of keys) await em.execute(REFERENCE_LOCK_SQL, [key])
}
