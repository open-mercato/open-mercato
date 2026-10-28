import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleEncryptionFieldRule, ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import { forgetEncryptionPolicyMemo } from '@open-mercato/shared/lib/encryption/policyMemo'
import { getDefaultEncryptionMaps, type Module } from '@open-mercato/shared/modules/registry'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

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

export type OrganizationEncryptionMapScope = {
  entityId: string
  tenantId: string
  organizationId: string
}

/**
 * Appends the declared field rules a tenant's organization-level maps for `entityId` lack.
 *
 * Tenant setup seeds a map per organization, and the encryption service prefers an
 * organization map over the tenant map without merging the two. Re-seeding only the tenant map
 * therefore leaves those organizations on their old field list, and a newly declared field is
 * written as plaintext there. Existing rules are never removed or changed: the same contract as
 * `buildEncryptionMapBackfillSql`, so an admin's own additions survive.
 */
export async function appendMissingFieldsToOrganizationMaps(
  em: EntityManager,
  input: { entityId: string; tenantId: string; fields: ModuleEncryptionFieldRule[] },
): Promise<OrganizationEncryptionMapScope[]> {
  const updatedOrganizationIds = new Set<string>()
  for (const rule of input.fields) {
    const field = typeof rule?.field === 'string' ? rule.field.trim() : ''
    if (!field) continue
    const appended = rule.hashField ? { field, hashField: rule.hashField } : { field }
    const rows = await em.execute<Array<{ organization_id: string }>>(
      `
        update "encryption_maps"
        set "fields_json" = coalesce("fields_json", '[]'::jsonb) || ?::jsonb, "updated_at" = now()
        where "entity_id" = ?
          and "tenant_id" = ?
          and "organization_id" is not null
          and "deleted_at" is null
          and jsonb_typeof(coalesce("fields_json", '[]'::jsonb)) = 'array'
          and not exists (
            select 1
            from jsonb_array_elements(case when jsonb_typeof("fields_json") = 'array' then "fields_json" else '[]'::jsonb end) as existing_rule
            where existing_rule->>'field' = ?
          )
        returning "organization_id"
      `,
      [JSON.stringify([appended]), input.entityId, input.tenantId, field],
    )
    for (const row of rows) {
      if (row?.organization_id) updatedOrganizationIds.add(String(row.organization_id))
    }
  }
  if (updatedOrganizationIds.size) forgetEncryptionPolicyMemo(em)
  return Array.from(updatedOrganizationIds, (organizationId) => ({
    entityId: input.entityId,
    tenantId: input.tenantId,
    organizationId,
  }))
}

// Idempotently upsert a specific set of encryption-map specs for one (tenant, org) scope. Exported so
// upgrade actions can backfill a newly-added encrypted entity for pre-existing tenants (whose maps were
// seeded once at tenant creation and never re-run) without depending on the full CLI module registry.
export async function upsertEncryptionMapSpecs(
  em: EntityManager,
  tenantId: string,
  organizationId: string | null,
  specs: ModuleEncryptionMap[],
  logger: (msg: string) => void = () => {},
  onMaterializedScope?: (scope: { entityId: string; tenantId: string; organizationId: string | null }) => void | Promise<void>,
): Promise<Array<{ entityId: string; tenantId: string; organizationId: string | null }>> {
  const materializedScopes: Array<{ entityId: string; tenantId: string; organizationId: string | null }> = []
  for (const spec of specs) {
    if (spec.keyScope === 'system') {
      logger(`Skipping ${spec.entityId}: system-scoped map, resolved from module code rather than a tenant row.`)
      continue
    }
    await upsertCanonicalEncryptionMap(em, {
      entityId: spec.entityId,
      tenantId,
      organizationId,
      fields: spec.fields,
      isActive: true,
    })
    const materializedScope = { entityId: spec.entityId, tenantId, organizationId }
    materializedScopes.push(materializedScope)
    await onMaterializedScope?.(materializedScope)
    logger(`🔒 Seeded encryption map for ${spec.entityId} ✨`)
    if (organizationId !== null) continue
    const organizationScopes = await appendMissingFieldsToOrganizationMaps(em, {
      entityId: spec.entityId,
      tenantId,
      fields: spec.fields,
    })
    for (const organizationScope of organizationScopes) {
      materializedScopes.push(organizationScope)
      await onMaterializedScope?.(organizationScope)
      logger(`🔒 Added missing fields to the ${spec.entityId} map of organization ${organizationScope.organizationId}`)
    }
  }
  return materializedScopes
}

// Exported so other modules (e.g. the directory subscribers that seed maps for a
// newly-created organization) can seed the default module encryption maps for one
// (tenant, org) scope. Callers resolve their own module list: a CLI command uses
// `getCliModules()`/`getModules()` (cli.ts is an allowed CLI-registry entrypoint), a runtime
// subscriber MUST use the app registry (`getModules()`) directly — this lib never reads the
// CLI-only registry itself (`cli-registry-boundary.test.ts` in @open-mercato/shared enforces
// that only `packages/cli/**` or a file literally named `cli.ts` may call `getCliModules()`).
export async function upsertEncryptionMaps(
  em: EntityManager,
  tenantId: string,
  organizationId: string | null,
  modules: Module[],
  logger: (msg: string) => void,
  onMaterializedScope?: (scope: { entityId: string; tenantId: string; organizationId: string | null }) => void | Promise<void>,
) {
  return upsertEncryptionMapSpecs(
    em,
    tenantId,
    organizationId,
    getDefaultEncryptionMaps(modules),
    logger,
    onMaterializedScope,
  )
}

export async function invalidateEncryptionMapScopes(
  encryptionService: Pick<TenantDataEncryptionService, 'invalidateMap'>,
  scopes: ReadonlyArray<{ entityId: string; tenantId: string | null; organizationId: string | null }>,
): Promise<void> {
  const seen = new Set<string>()
  for (const scope of scopes) {
    const key = `${scope.entityId}\u0000${scope.tenantId ?? ''}\u0000${scope.organizationId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    await encryptionService.invalidateMap(scope.entityId, scope.tenantId, scope.organizationId)
  }
}
