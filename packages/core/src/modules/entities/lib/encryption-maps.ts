import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleEncryptionFieldRule } from '@open-mercato/shared/modules/encryption'

export type EncryptionMapLike = {
  id: string
  entityId: string
  tenantId?: string | null
  organizationId?: string | null
  fieldsJson?: ModuleEncryptionFieldRule[] | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
}

export type CanonicalEncryptionMap = EncryptionMapLike & {
  fieldsJson: ModuleEncryptionFieldRule[]
}

export type UpsertCanonicalEncryptionMapInput = {
  entityId: string
  tenantId: string | null
  organizationId: string | null
  fields: ModuleEncryptionFieldRule[]
  isActive: boolean
}

export type UpsertedEncryptionMap = {
  id: string
  updatedAt: Date
}

function orderedMaps<T extends EncryptionMapLike>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const createdDelta = left.createdAt.getTime() - right.createdAt.getTime()
    return createdDelta || left.id.localeCompare(right.id)
  })
}

export function mergeEncryptionMapFields(records: readonly EncryptionMapLike[]): ModuleEncryptionFieldRule[] {
  const merged: ModuleEncryptionFieldRule[] = []
  const byField = new Map<string, ModuleEncryptionFieldRule>()
  for (const record of orderedMaps(records)) {
    for (const rule of record.fieldsJson ?? []) {
      const field = typeof rule?.field === 'string' ? rule.field.trim() : ''
      if (!field) continue
      const existing = byField.get(field)
      if (!existing) {
        const copy = { field, hashField: typeof rule.hashField === 'string' ? rule.hashField : null }
        byField.set(field, copy)
        merged.push(copy)
        continue
      }
      if (!existing.hashField && typeof rule.hashField === 'string' && rule.hashField) {
        existing.hashField = rule.hashField
      }
    }
  }
  return merged
}

export function resolveCanonicalEncryptionMap<T extends EncryptionMapLike>(records: readonly T[]): CanonicalEncryptionMap | null {
  const ordered = orderedMaps(records)
  const canonical = ordered[0]
  if (!canonical) return null
  const active = ordered.filter((record) => record.isActive)
  return {
    ...canonical,
    isActive: active.length > 0,
    fieldsJson: mergeEncryptionMapFields(active.length > 0 ? active : ordered),
  }
}

export async function upsertCanonicalEncryptionMap(
  em: EntityManager,
  input: UpsertCanonicalEncryptionMapInput,
): Promise<UpsertedEncryptionMap> {
  const rows = await em.getConnection().execute<Array<{ id: string; updated_at: Date | string }>>(
    `
      insert into "encryption_maps"
        ("id", "entity_id", "tenant_id", "organization_id", "fields_json", "is_active", "created_at", "updated_at")
      values
        (gen_random_uuid(), ?, ?, ?, ?::jsonb, ?, now(), now())
      on conflict ("entity_id", "tenant_id", "organization_id") where "deleted_at" is null
      do update set
        "fields_json" = excluded."fields_json",
        "is_active" = excluded."is_active",
        "updated_at" = now()
      returning "id", "updated_at"
    `,
    [
      input.entityId,
      input.tenantId,
      input.organizationId,
      JSON.stringify(input.fields),
      input.isActive,
    ],
  )
  const saved = rows[0]
  if (!saved?.id || !saved.updated_at) {
    throw new Error('[internal] Encryption map upsert did not return the canonical row')
  }
  return {
    id: saved.id,
    updatedAt: saved.updated_at instanceof Date ? saved.updated_at : new Date(saved.updated_at),
  }
}
