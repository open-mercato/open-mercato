import type { Kysely } from 'kysely'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { EncryptionMapEntry } from './field-policy'

type EncryptionMapRow = {
  id?: unknown
  tenant_id?: unknown
  organization_id?: unknown
  fields_json?: unknown
  created_at?: unknown
}

type LegacyEncryptionMapPolicyVersionCache = {
  get(key: string): Promise<unknown | null>
}

function compareNullableScope(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0
  if (left == null) return -1
  if (right == null) return 1
  return String(left).localeCompare(String(right))
}

function compareCreatedAt(left: unknown, right: unknown): number {
  const leftTime = left instanceof Date ? left.getTime() : Date.parse(String(left ?? ''))
  const rightTime = right instanceof Date ? right.getTime() : Date.parse(String(right ?? ''))
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime
  return String(left ?? '').localeCompare(String(right ?? ''))
}

function compareEncryptionMapRows(left: EncryptionMapRow, right: EncryptionMapRow): number {
  return compareNullableScope(left.tenant_id, right.tenant_id)
    || compareNullableScope(left.organization_id, right.organization_id)
    || compareCreatedAt(left.created_at, right.created_at)
    || String(left.id ?? '').localeCompare(String(right.id ?? ''))
}

function parseEncryptionMapFields(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeEncryptionMapEntries(rows: readonly EncryptionMapRow[]): EncryptionMapEntry[] {
  const merged: EncryptionMapEntry[] = []
  const byField = new Map<string, EncryptionMapEntry>()
  for (const row of [...rows].sort(compareEncryptionMapRows)) {
    for (const candidate of parseEncryptionMapFields(row.fields_json)) {
      if (!candidate || typeof candidate !== 'object') continue
      const rule = candidate as { field?: unknown; hashField?: unknown }
      const field = typeof rule.field === 'string' ? rule.field.trim() : ''
      if (!field) continue
      const hashField = typeof rule.hashField === 'string' && rule.hashField.length > 0
        ? rule.hashField
        : null
      const existing = byField.get(field)
      if (!existing) {
        const entry = { field, hashField }
        byField.set(field, entry)
        merged.push(entry)
      } else if (!existing.hashField && hashField) {
        existing.hashField = hashField
      }
    }
  }
  return merged
}

/**
 * Resolve every active live declaration for an entity. Search indexing has no
 * tenant/scope argument at this boundary, so the safe policy is the union of
 * all scopes: over-excluding a field is preferable to publishing plaintext.
 *
 * The legacy version-cache argument remains optional for call-site compatibility but is
 * intentionally ignored. A version publication can fail after the database commit, so neither
 * that channel nor process-local positive memory can authorize reuse of an older policy.
 */
export function createEncryptionMapResolver(
  db: Kysely<any>,
  legacyPolicyVersionCache?: LegacyEncryptionMapPolicyVersionCache,
): (entityId: EntityId) => Promise<EncryptionMapEntry[]> {
  void legacyPolicyVersionCache

  return async (entityId: EntityId): Promise<EncryptionMapEntry[]> => {
    const rows = await db
      .selectFrom('encryption_maps' as any)
      .select([
        'id' as any,
        'tenant_id' as any,
        'organization_id' as any,
        'fields_json' as any,
        'created_at' as any,
      ])
      .where('entity_id' as any, '=', entityId)
      .where('is_active' as any, '=', true)
      .where('deleted_at' as any, 'is', null)
      .orderBy('tenant_id' as any, 'asc')
      .orderBy('organization_id' as any, 'asc')
      .orderBy('created_at' as any, 'asc')
      .orderBy('id' as any, 'asc')
      .execute() as EncryptionMapRow[]

    return mergeEncryptionMapEntries(Array.isArray(rows) ? rows : [])
  }
}
