import { withClient } from './dbFixtures';

/**
 * Database fixtures for custom field definitions and values.
 *
 * The definitions API always pins the caller's tenant and organization, so specs that need
 * definitions or values in another scope (tenant-wide, organization-wide, another tenant or
 * organization) insert them directly. Pair every insert with `deleteCustomFieldRowsInDb` in
 * the spec's teardown.
 */

export async function insertCustomFieldDefInDb(input: {
  entityId: string;
  tenantId: string | null;
  organizationId: string | null;
  key: string;
  kind: string;
  configJson: Record<string, unknown>;
}): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into custom_field_defs
         (id, entity_id, organization_id, tenant_id, key, kind, config_json, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, true, now(), now())
       returning id`,
      [
        input.entityId,
        input.organizationId,
        input.tenantId,
        input.key,
        input.kind,
        JSON.stringify(input.configJson),
      ],
    );
    return result.rows[0].id;
  });
}

export async function insertCustomFieldValueInDb(input: {
  entityId: string;
  recordId: string;
  tenantId: string | null;
  organizationId: string | null;
  key: string;
  valueText: string;
}): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into custom_field_values
         (id, entity_id, record_id, organization_id, tenant_id, field_key, value_text, created_at)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
       returning id`,
      [input.entityId, input.recordId, input.organizationId, input.tenantId, input.key, input.valueText],
    );
    return result.rows[0].id;
  });
}

export async function readCustomFieldValuesInDb(
  entityId: string,
  fieldKey: string,
): Promise<Array<{ recordId: string; valueText: string | null }>> {
  return withClient(async (client) => {
    const result = await client.query<{ record_id: string; value_text: string | null }>(
      `select record_id, value_text from custom_field_values
        where entity_id = $1 and field_key = $2 and deleted_at is null`,
      [entityId, fieldKey],
    );
    return result.rows.map((row) => ({ recordId: String(row.record_id), valueText: row.value_text }));
  });
}

export async function deleteCustomFieldRowsInDb(entityId: string, keys: string[]): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from custom_field_values where entity_id = $1 and field_key = any($2)', [
      entityId,
      keys,
    ]);
    await client.query('delete from custom_field_defs where entity_id = $1 and key = any($2)', [entityId, keys]);
  });
}
