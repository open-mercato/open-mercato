import type { EntityManager } from '@mikro-orm/postgresql'

const REFERENCE_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'

export function entityReferenceLockKey(input: {
  entityId: string
  recordId: string
  tenantId: string
  organizationId: string
}): string {
  return [
    'entity-reference',
    input.entityId,
    input.tenantId.toLowerCase(),
    input.organizationId.toLowerCase(),
    input.recordId.toLowerCase(),
  ].join(':')
}

export async function lockEntityReferences(
  em: EntityManager,
  inputs: Array<{ entityId: string; recordId: string; tenantId: string; organizationId: string }>,
): Promise<void> {
  const keys = [...new Set(inputs.map(entityReferenceLockKey))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const key of keys) await em.execute(REFERENCE_LOCK_SQL, [key])
}

export type EntityReferenceLockInput = {
  entityId: string
  recordId: string
  tenantId: string
  organizationId: string
}

export type EntityReferenceLivenessCheck = (
  em: EntityManager,
  reference: EntityReferenceLockInput,
) => Promise<boolean>

const SQL_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function scopedLiveRecordCheck(tableName: string): EntityReferenceLivenessCheck {
  if (!SQL_IDENTIFIER_PATTERN.test(tableName)) {
    throw new Error(`[internal] invalid table name for live record check: ${tableName}`)
  }
  const sql = `select 1 from ${tableName} where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null limit 1`
  return async (em, reference) => {
    if (!UUID_PATTERN.test(reference.recordId)) return false
    const rows = await em.execute(sql, [reference.recordId, reference.tenantId, reference.organizationId])
    return Array.isArray(rows) && rows.length > 0
  }
}

export async function lockLiveEntityReferences(
  em: EntityManager,
  references: EntityReferenceLockInput[],
  isLive: EntityReferenceLivenessCheck,
): Promise<EntityReferenceLockInput[]> {
  await lockEntityReferences(em, references)
  const missing: EntityReferenceLockInput[] = []
  const checked = new Set<string>()
  for (const reference of references) {
    const key = entityReferenceLockKey(reference)
    if (checked.has(key)) continue
    checked.add(key)
    if (!(await isLive(em, reference))) missing.push(reference)
  }
  return missing
}

export async function lockLiveEntityReference(
  em: EntityManager,
  reference: EntityReferenceLockInput,
  isLive: EntityReferenceLivenessCheck,
): Promise<boolean> {
  const missing = await lockLiveEntityReferences(em, [reference], isLive)
  return missing.length === 0
}
