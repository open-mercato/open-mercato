import type { ModuleEncryptionFieldRule, ModuleEncryptionMap } from '../../modules/encryption'

/**
 * Tenant encryption maps are seeded only when a tenant is created (`auth:setup`) or by hand
 * (`mercato entities seed-encryption`). A map entry added to a module after tenants exist therefore
 * never reaches them: `encryptEntityPayload` finds no rule and the column is written as plaintext.
 *
 * `buildEncryptionMapBackfillSql` emits one idempotent statement for a module migration that closes
 * that gap for every pre-existing (tenant, organization) scope with active maps:
 * - inserts the whole map where the scope has no row for the entity yet (`NOT EXISTS` guard);
 * - appends each missing field rule to rows that already exist, leaving other rules untouched.
 *
 * Scopes without active maps (encryption disabled) are skipped, mirroring `seed-encryption`. When the
 * `encryption_maps` table does not exist yet (a fresh database where this module migrates before
 * `entities`), the statement is a no-op: no tenant exists at that point either.
 *
 * Prefer a forward-only migration (`down()` without SQL): deleting by `entity_id` would also remove
 * maps seeded at tenant creation or edited by admins and silently switch encryption off.
 */

const ENTITY_ID_PATTERN = /^[a-z0-9_]+:[a-z0-9_]+$/
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertIdentifier(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`[internal] buildEncryptionMapBackfillSql received an invalid ${label}: ${String(value)}`)
  }
  return value
}

function normalizeRules(map: ModuleEncryptionMap): ModuleEncryptionFieldRule[] {
  if (!Array.isArray(map.fields) || map.fields.length === 0) {
    throw new Error(`[internal] buildEncryptionMapBackfillSql requires at least one field for ${map.entityId}`)
  }
  const rules: ModuleEncryptionFieldRule[] = []
  for (const rule of map.fields) {
    const field = assertIdentifier(rule?.field, FIELD_NAME_PATTERN, 'field name')
    if (rules.some((existing) => existing.field === field)) continue
    const hashField = rule.hashField == null ? null : assertIdentifier(rule.hashField, FIELD_NAME_PATTERN, 'hash field name')
    rules.push(hashField ? { field, hashField } : { field })
  }
  return rules
}

function jsonbLiteral(value: unknown): string {
  return `'${JSON.stringify(value)}'::jsonb`
}

export function buildEncryptionMapBackfillSql(map: ModuleEncryptionMap): string {
  const entityId = assertIdentifier(map?.entityId, ENTITY_ID_PATTERN, 'entity id')
  if (map.keyScope === 'system') {
    throw new Error(`[internal] buildEncryptionMapBackfillSql: ${entityId} is system-scoped and is resolved from module code, not encryption_maps`)
  }
  const rules = normalizeRules(map)
  const appendStatements = rules.map((rule) => `
  update "encryption_maps"
  set "fields_json" = coalesce("fields_json", '[]'::jsonb) || ${jsonbLiteral([rule])}, "updated_at" = now()
  where "entity_id" = '${entityId}'
    and "deleted_at" is null
    and jsonb_typeof(coalesce("fields_json", '[]'::jsonb)) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof("fields_json") = 'array' then "fields_json" else '[]'::jsonb end) as rule
      where rule->>'field' = '${rule.field}'
    );`).join('\n')

  return `do $$
begin
  if to_regclass('encryption_maps') is null then
    return;
  end if;

  insert into "encryption_maps" ("id", "entity_id", "tenant_id", "organization_id", "fields_json", "is_active", "created_at", "updated_at")
  select gen_random_uuid(), '${entityId}', src."tenant_id", src."organization_id", ${jsonbLiteral(rules)}, true, now(), now()
  from (
    select distinct "tenant_id", "organization_id"
    from "encryption_maps"
    where "is_active" = true and "deleted_at" is null
  ) src
  where not exists (
    select 1 from "encryption_maps" existing
    where existing."entity_id" = '${entityId}'
      and existing."tenant_id" is not distinct from src."tenant_id"
      and existing."organization_id" is not distinct from src."organization_id"
      and existing."deleted_at" is null
  );
${appendStatements}
end
$$;`
}
