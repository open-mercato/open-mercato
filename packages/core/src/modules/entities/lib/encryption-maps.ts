import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleEncryptionFieldRule } from '@open-mercato/shared/modules/encryption'
import { forgetEncryptionPolicyMemo } from '@open-mercato/shared/lib/encryption/policyMemo'

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
  /**
   * When set, an existing live row is only updated while its `updated_at` still equals this
   * version (millisecond precision, matching the optimistic-lock token). A concurrent write that
   * moved the version makes the upsert throw {@link EncryptionMapVersionConflictError} instead of
   * overwriting it.
   */
  expectedUpdatedAt?: Date | null
}

export type UpsertedEncryptionMap = {
  id: string
  updatedAt: Date
}

export class EncryptionMapVersionConflictError extends Error {
  constructor(
    readonly expectedUpdatedAt: Date,
    readonly currentUpdatedAt: Date | null,
  ) {
    super('[internal] Encryption map version changed before the conditional update')
    this.name = 'EncryptionMapVersionConflictError'
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
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
  const expectedUpdatedAt = input.expectedUpdatedAt ?? null
  const versionCondition = expectedUpdatedAt
    ? `where date_trunc('milliseconds', "encryption_maps"."updated_at") = date_trunc('milliseconds', ?::timestamptz)`
    : ''
  const params: unknown[] = [
    input.entityId,
    input.tenantId,
    input.organizationId,
    JSON.stringify(input.fields),
    input.isActive,
  ]
  if (expectedUpdatedAt) params.push(expectedUpdatedAt.toISOString())
  const rows = await em.execute<Array<{ id: string; updated_at: Date | string }>>(
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
      ${versionCondition}
      returning "id", "updated_at"
    `,
    params,
  )
  forgetEncryptionPolicyMemo(em)
  const saved = rows[0]
  if (!saved?.id || !saved.updated_at) {
    if (expectedUpdatedAt) {
      throw new EncryptionMapVersionConflictError(
        expectedUpdatedAt,
        await readLiveEncryptionMapVersion(em, input),
      )
    }
    throw new Error('[internal] Encryption map upsert did not return the canonical row')
  }
  return {
    id: saved.id,
    updatedAt: toDate(saved.updated_at),
  }
}

async function readLiveEncryptionMapVersion(
  em: EntityManager,
  input: UpsertCanonicalEncryptionMapInput,
): Promise<Date | null> {
  const rows = await em.execute<Array<{ updated_at: Date | string | null }>>(
    `
      select "updated_at"
      from "encryption_maps"
      where "entity_id" = ?
        and "tenant_id" is not distinct from ?
        and "organization_id" is not distinct from ?
        and "deleted_at" is null
      order by "created_at" asc, "id" asc
      limit 1
    `,
    [input.entityId, input.tenantId, input.organizationId],
  )
  const current = rows[0]?.updated_at
  return current ? toDate(current) : null
}
