import type { IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export type AddressPolicyFixture = {
  addressEntity: string
  otherEntity: string
  tenantId: string
  organizationId: string
  startedAt: Date
  backupId: string | null
  parentPolicies: Array<{ id: string; fields_json: unknown }>
  createdOtherMap: boolean
  restoredOtherMap: { id: string; deletedAt: string | Date } | null
}

export async function cleanupAddressPolicyFixture(
  client: IntegrationDbClient,
  fixture: AddressPolicyFixture,
  deleteCompany: () => Promise<void>,
): Promise<void> {
  try {
    await deleteCompany()
  } finally {
    await client.query('BEGIN')
    try {
      for (const parent of fixture.parentPolicies) {
        await client.query('update encryption_maps set fields_json = $2::jsonb, updated_at = now() where id = $1', [parent.id, JSON.stringify(parent.fields_json)])
      }
      await client.query(
        `delete from encryption_maps
          where entity_id = $1 and tenant_id = $2 and organization_id = $3
            and created_at >= $4 and ($5::uuid is null or id <> $5::uuid)`,
        [fixture.addressEntity, fixture.tenantId, fixture.organizationId, fixture.startedAt, fixture.backupId],
      )
      if (fixture.backupId) {
        await client.query('update encryption_maps set deleted_at = null where id = $1', [fixture.backupId])
      }
      if (fixture.createdOtherMap) {
        await client.query(
          `delete from encryption_maps
            where entity_id = $1 and tenant_id = $2 and organization_id = $3 and created_at >= $4`,
          [fixture.otherEntity, fixture.tenantId, fixture.organizationId, fixture.startedAt],
        )
      } else if (fixture.restoredOtherMap) {
        await client.query('update encryption_maps set deleted_at = $2 where id = $1', [fixture.restoredOtherMap.id, fixture.restoredOtherMap.deletedAt])
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
}
