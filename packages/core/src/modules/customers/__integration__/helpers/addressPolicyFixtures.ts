import { randomUUID } from 'node:crypto'
import type { IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const addressEntity = 'customers:customer_address'

export async function replaceFixtureAddressPolicy(
  client: IntegrationDbClient,
  tenantId: string,
  organizationId: string | null,
  fields: Array<{ field: string }>,
): Promise<string> {
  const id = randomUUID()
  await client.query('BEGIN')
  try {
    await client.query('delete from encryption_maps where entity_id = $1 and tenant_id = $2 and organization_id is not distinct from $3', [addressEntity, tenantId, organizationId])
    await client.query(`insert into encryption_maps
      (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at)
      values ($1, $2, $3, $4, $5::jsonb, true, now(), now())`, [id, addressEntity, tenantId, organizationId, JSON.stringify(fields)])
    await client.query('COMMIT')
    return id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
