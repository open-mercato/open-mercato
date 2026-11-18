import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * Test-only hard purge of the property records a spec created, straight through the database.
 *
 * The API cleanup cannot finish everything: deleting a lease records `recurrence_cancel`
 * operations that stay pending until sales ships `sales.orders.recurrence.cancel`, so the lease
 * (and with it the building) is kept. This removes the given buildings and every row that hangs
 * off them — floors, spaces, common areas, units and their product periods, opening hours,
 * managers, closures, bookings, leases with their versions, proposals and sales operations — plus
 * their query-index and search-token rows, the staff and portal notifications and audit-log entries
 * about those records, and the product-use flags of the catalog products the spec created. Every statement is scoped to the building rows' own organization and tenant, and
 * only ids the spec created are passed in. Sales documents are left alone: orders are never deleted
 * by this module.
 */

type BuildingScopeRow = { id: string; organization_id: string; tenant_id: string }
type IdRow = { id: string }

const BUILDING_TABLES = [
  'property_management_bookings',
  'property_management_unavailabilities',
  'property_management_common_areas',
  'property_management_units',
  'property_management_spaces',
  'property_management_opening_hours',
  'property_management_building_managers',
  'property_management_floors',
] as const

async function tableExists(client: IntegrationDbClient, table: string): Promise<boolean> {
  const result = await client.query<{ name: string | null }>('select to_regclass($1)::text as name', [table])
  return Boolean(result.rows[0]?.name)
}

async function purgeRecordTrail(
  client: IntegrationDbClient,
  scope: { organizationId: string; tenantId: string },
  notified: { leaseIds: string[]; bookingIds: string[] },
  loggedIds: string[],
): Promise<void> {
  if (await tableExists(client, 'notifications')) {
    await client.query(
      `delete from notifications
        where tenant_id = $1 and (organization_id = $2 or organization_id is null)
          and ((source_entity_type = 'property_management:lease' and source_entity_id = any($3::uuid[]))
            or (source_entity_type = 'property_management:booking' and source_entity_id = any($4::uuid[])))`,
      [scope.tenantId, scope.organizationId, notified.leaseIds, notified.bookingIds],
    )
  }
  if (await tableExists(client, 'action_logs')) {
    await client.query(
      `delete from action_logs
        where tenant_id = $1 and organization_id = $2 and resource_kind like 'property_management.%' and resource_id = any($3::text[])`,
      [scope.tenantId, scope.organizationId, loggedIds],
    )
  }
}

async function selectIds(client: IntegrationDbClient, sql: string, values: readonly unknown[]): Promise<string[]> {
  const result = await client.query<IdRow>(sql, values)
  return result.rows.map((row) => String(row.id))
}

async function purgeScope(
  client: IntegrationDbClient,
  scope: { organizationId: string; tenantId: string },
  buildingIds: string[],
  productIds: string[],
): Promise<void> {
  const org = scope.organizationId
  const tenant = scope.tenantId
  const byBuilding = (table: string) =>
    selectIds(client, `select id from ${table} where organization_id = $1 and tenant_id = $2 and building_id = any($3::uuid[])`, [org, tenant, buildingIds])
  const leaseIds = await byBuilding('property_management_leases')
  const bookingIds = await byBuilding('property_management_bookings')
  const unitIds = await byBuilding('property_management_units')
  const floorIds = await byBuilding('property_management_floors')
  const spaceIds = await byBuilding('property_management_spaces')
  const areaIds = await byBuilding('property_management_common_areas')
  const closureIds = await byBuilding('property_management_unavailabilities')
  const versionIds = await selectIds(
    client,
    'select id from property_management_lease_versions where organization_id = $1 and tenant_id = $2 and lease_id = any($3::uuid[])',
    [org, tenant, leaseIds],
  )
  const proposalIds = await selectIds(
    client,
    'select id from property_management_lease_proposals where organization_id = $1 and tenant_id = $2 and lease_id = any($3::uuid[])',
    [org, tenant, leaseIds],
  )
  const targetIds = [...leaseIds, ...bookingIds, ...versionIds, ...proposalIds]
  await client.query(
    `delete from property_management_sales_operations
      where organization_id = $1 and tenant_id = $2 and (lease_id = any($3::uuid[]) or target_id = any($4::uuid[]))`,
    [org, tenant, leaseIds, targetIds],
  )
  for (const table of ['property_management_lease_proposals', 'property_management_lease_versions']) {
    await client.query(`delete from ${table} where organization_id = $1 and tenant_id = $2 and lease_id = any($3::uuid[])`, [org, tenant, leaseIds])
  }
  await client.query('delete from property_management_leases where organization_id = $1 and tenant_id = $2 and id = any($3::uuid[])', [org, tenant, leaseIds])
  await client.query(
    'delete from property_management_unit_product_periods where organization_id = $1 and tenant_id = $2 and unit_id = any($3::uuid[])',
    [org, tenant, unitIds],
  )
  for (const table of BUILDING_TABLES) {
    await client.query(`delete from ${table} where organization_id = $1 and tenant_id = $2 and building_id = any($3::uuid[])`, [org, tenant, buildingIds])
  }
  await client.query('delete from property_management_buildings where organization_id = $1 and tenant_id = $2 and id = any($3::uuid[])', [org, tenant, buildingIds])
  await client.query(
    'delete from property_management_product_uses where organization_id = $1 and tenant_id = $2 and catalog_product_id = any($3::uuid[])',
    [org, tenant, productIds],
  )
  const indexedIds = [...buildingIds, ...floorIds, ...spaceIds, ...areaIds, ...unitIds, ...closureIds, ...bookingIds, ...leaseIds]
  await purgeRecordTrail(client, scope, { leaseIds, bookingIds }, indexedIds)
  for (const table of ['entity_indexes', 'search_tokens']) {
    await client.query(
      `delete from ${table} where organization_id = $1 and entity_type like 'property_management:%' and entity_id = any($2::text[])`,
      [org, indexedIds],
    )
  }
}

function presentIds(values: ReadonlyArray<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((id): id is string => typeof id === 'string' && id.length > 0)))
}

export async function purgeBuildingsInDb(
  buildingIds: ReadonlyArray<string | null | undefined>,
  options: { productIds?: ReadonlyArray<string | null | undefined> } = {},
): Promise<void> {
  const ids = presentIds(buildingIds)
  if (!ids.length) return
  const productIds = presentIds(options.productIds ?? [])
  await withClient(async (client) => {
    const buildings = await client.query<BuildingScopeRow>(
      'select id, organization_id, tenant_id from property_management_buildings where id = any($1::uuid[])',
      [ids],
    )
    const scopes = new Map<string, { organizationId: string; tenantId: string; buildingIds: string[] }>()
    for (const row of buildings.rows) {
      const key = `${row.tenant_id}:${row.organization_id}`
      const entry = scopes.get(key) ?? { organizationId: row.organization_id, tenantId: row.tenant_id, buildingIds: [] }
      entry.buildingIds.push(row.id)
      scopes.set(key, entry)
    }
    if (!scopes.size) return
    await client.query('begin')
    try {
      for (const scope of scopes.values()) await purgeScope(client, scope, scope.buildingIds, productIds)
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    }
  })
}
